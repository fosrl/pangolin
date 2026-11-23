import {
    clientOrgRoles,
    clients,
    db,
    Olm,
    roleDnsBlocking,
    userOrgRoles
} from "@server/db";
import { and, eq, inArray } from "drizzle-orm";
import { createHash } from "crypto";
import { deflate } from "zlib";
import { promisify } from "util";
import logger from "@server/logger";
import config from "@server/lib/config";
import { supportsDnsBlockPage } from "@server/lib/clientVersionChecks";
import { getDnsBlockEntitlements } from "#dynamic/lib/dnsBlocklist/entitlements";
import { getCustomListsForRoles } from "#dynamic/lib/dnsBlocklist/customLists";
import {
    categoryShowsBlockPage,
    DnsBlockCategory,
    getBlocklistSource,
    isDnsBlockCategory
} from "./source";

const zlibDeflate = promisify(deflate);

/** A blocklist ready to send to olm. */
export type ResolvedBlocklist = {
    /**
     * Identifies what olm should be running: the domain sets, the block page
     * URL and whether it reports blocks. "" for an empty list.
     */
    version: string;
    /**
     * base64(zlib(newline separated domains)); "" for an empty list. Lookups
     * of these domains fail. For olms that support the block page this leaves
     * out the domains in pageCompressed; for older olms it is every domain.
     */
    compressed: string;
    domainCount: number;
    /**
     * Same encoding: the domains that olm sends browsers to the block page for
     * (when it can, otherwise their lookups fail too). Always "" for olms that
     * do not support the block page.
     */
    pageCompressed: string;
    pageDomainCount: number;
    /** Block page olm redirects to, without the domain parameter. */
    pageUrl: string;
    /** Whether olm should report blocked requests for the DNS block log. */
    logBlocks: boolean;
};

export const EMPTY_BLOCKLIST: ResolvedBlocklist = {
    version: "",
    compressed: "",
    domainCount: 0,
    pageCompressed: "",
    pageDomainCount: 0,
    pageUrl: "",
    logBlocks: false
};

// Building and compressing a list of 100k+ domains is not free and many olms
// in the same org share the same list, so keep recent results. The key covers
// everything the result depends on, so entries are never stale.
const RESULT_CACHE_MAX = 50;
type CachedList = {
    version: string;
    compressed: string;
    domainCount: number;
    pageCompressed: string;
    pageDomainCount: number;
};
const resultCache = new Map<string, CachedList>();

function cacheResult(key: string, value: CachedList) {
    resultCache.set(key, value);
    if (resultCache.size > RESULT_CACHE_MAX) {
        const oldest = resultCache.keys().next().value;
        if (oldest !== undefined) resultCache.delete(oldest);
    }
}

async function encodeDomains(
    domains: Iterable<string>
): Promise<{ plain: Buffer; compressed: string; count: number }> {
    const sorted = [...domains].sort();
    if (sorted.length === 0) {
        return { plain: Buffer.alloc(0), compressed: "", count: 0 };
    }
    const plain = Buffer.from(sorted.join("\n"), "utf-8");
    return {
        plain,
        compressed: (await zlibDeflate(plain)).toString("base64"),
        count: sorted.length
    };
}

/**
 * The block page of an org, or "" when the server has no dashboard URL to
 * point browsers at. olm appends "?domain=<blocked domain>".
 */
function getBlockPageUrl(orgId: string): string {
    const base = config.getRawConfig().app.dashboard_url;
    if (!base) return "";
    return `${base.replace(/\/+$/, "")}/blocked/${encodeURIComponent(orgId)}`;
}

export function parseCategories(value: string | null | undefined): string[] {
    if (!value) return [];
    try {
        const parsed = JSON.parse(value);
        return Array.isArray(parsed)
            ? parsed.filter(
                  (c): c is string =>
                      typeof c === "string" && isDnsBlockCategory(c)
              )
            : [];
    } catch {
        return [];
    }
}

// The roles a device gets its blocklist from: a user's roles in the org for a
// user device, or the machine client's roles otherwise.
async function getRoleIdsForOlm(olm: Olm, orgId: string): Promise<number[]> {
    if (olm.userId) {
        const rows = await db
            .select({ roleId: userOrgRoles.roleId })
            .from(userOrgRoles)
            .where(
                and(
                    eq(userOrgRoles.userId, olm.userId),
                    eq(userOrgRoles.orgId, orgId)
                )
            );
        return rows.map((r) => r.roleId);
    }

    if (olm.clientId) {
        const rows = await db
            .select({ roleId: clientOrgRoles.roleId })
            .from(clientOrgRoles)
            .where(eq(clientOrgRoles.clientId, olm.clientId));
        return rows.map((r) => r.roleId);
    }

    return [];
}

/**
 * Computes the blocklist an olm should enforce: the union of everything the
 * enabled DNS blocking configs of its roles select, limited to what the org may
 * use. Without a license that is the ads category only. Returns an empty list
 * when no role blocks anything.
 */
export async function resolveBlocklistForOlm(
    olm: Olm
): Promise<ResolvedBlocklist> {
    if (!olm.clientId) return EMPTY_BLOCKLIST;

    const [client] = await db
        .select({ orgId: clients.orgId })
        .from(clients)
        .where(eq(clients.clientId, olm.clientId))
        .limit(1);
    if (!client) return EMPTY_BLOCKLIST;
    const orgId = client.orgId;

    const roleIds = await getRoleIdsForOlm(olm, orgId);
    if (roleIds.length === 0) return EMPTY_BLOCKLIST;

    const configs = await db
        .select()
        .from(roleDnsBlocking)
        .where(
            and(
                inArray(roleDnsBlocking.roleId, roleIds),
                eq(roleDnsBlocking.enabled, true)
            )
        );
    if (configs.length === 0) return EMPTY_BLOCKLIST;

    const entitlements = await getDnsBlockEntitlements(orgId);

    const categories = new Set<DnsBlockCategory>();
    for (const config of configs) {
        for (const category of parseCategories(config.categories)) {
            // Ads is a community feature; the rest need a license.
            if (category === "ads" || entitlements.allCategories) {
                categories.add(category as DnsBlockCategory);
            }
        }
    }

    const customLists = entitlements.customLists
        ? await getCustomListsForRoles(
              orgId,
              configs.map((c) => c.roleId)
          )
        : [];

    if (categories.size === 0 && customLists.length === 0) {
        return EMPTY_BLOCKLIST;
    }

    // Older olms only know one list. Newer ones get the domains that show
    // the block page separately, unless there is no page to send them to.
    const pageUrl = supportsDnsBlockPage(olm.version)
        ? getBlockPageUrl(orgId)
        : "";
    const split = pageUrl !== "";

    const source = getBlocklistSource();
    const sortedCategories = [...categories].sort();
    const key = [
        split ? "split" : "merged",
        sortedCategories.join(","),
        customLists
            .map((l) => l.key)
            .sort()
            .join(","),
        await source.getVersion()
    ].join("|");

    let list = resultCache.get(key);
    if (!list) {
        const domains = new Set<string>();
        const pageDomains = new Set<string>();
        for (const category of sortedCategories) {
            const target =
                split && categoryShowsBlockPage(category)
                    ? pageDomains
                    : domains;
            for (const d of await source.getCategoryDomains(category)) {
                target.add(d);
            }
        }
        for (const customList of customLists) {
            const target =
                split && customList.showBlockPage ? pageDomains : domains;
            for (const d of customList.domains) target.add(d);
        }
        // A domain on both kinds of list shows the page.
        for (const d of pageDomains) domains.delete(d);

        if (domains.size === 0 && pageDomains.size === 0) {
            return EMPTY_BLOCKLIST;
        }

        const failing = await encodeDomains(domains);
        const page = await encodeDomains(pageDomains);
        const hash = createHash("sha256").update(failing.plain);
        if (split) {
            hash.update("\0page\0").update(page.plain);
        }
        list = {
            version: hash.digest("hex").slice(0, 16),
            compressed: failing.compressed,
            domainCount: failing.count,
            pageCompressed: page.compressed,
            pageDomainCount: page.count
        };
        cacheResult(key, list);
    }

    logger.debug(
        `Resolved DNS blocklist for olm ${olm.olmId}: ${list.domainCount} domains, ${list.pageDomainCount} with block page (${list.compressed.length + list.pageCompressed.length} bytes compressed)`
    );

    // The block log setting and page URL are not part of the cached list, but
    // they are part of the version, so changing them is pushed to devices.
    const logBlocks = entitlements.blockLog;
    let version = list.version;
    if (list.pageCompressed) {
        version += `:${createHash("sha256").update(pageUrl).digest("hex").slice(0, 8)}`;
    }
    if (logBlocks) version += ":log";
    return {
        ...list,
        version,
        pageUrl: list.pageCompressed ? pageUrl : "",
        logBlocks
    };
}
