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
import { getDnsBlockEntitlements } from "#dynamic/lib/dnsBlocklist/entitlements";
import { getCustomListsForRoles } from "#dynamic/lib/dnsBlocklist/customLists";
import {
    DnsBlockCategory,
    getBlocklistSource,
    isDnsBlockCategory
} from "./source";

const zlibDeflate = promisify(deflate);

/** A blocklist ready to send to olm. */
export type ResolvedBlocklist = {
    /**
     * Identifies what olm should be running: the domain set plus whether it
     * reports blocks. "" for an empty list.
     */
    version: string;
    /** base64(zlib(newline separated domains)); "" for an empty list. */
    compressed: string;
    domainCount: number;
    /** Whether olm should report blocked requests for the DNS block log. */
    logBlocks: boolean;
};

export const EMPTY_BLOCKLIST: ResolvedBlocklist = {
    version: "",
    compressed: "",
    domainCount: 0,
    logBlocks: false
};

// Building and compressing a list of 100k+ domains is not free and many olms
// in the same org share the same list, so keep recent results. The key covers
// everything the result depends on, so entries are never stale.
const RESULT_CACHE_MAX = 50;
type CachedList = { version: string; compressed: string; domainCount: number };
const resultCache = new Map<string, CachedList>();

function cacheResult(key: string, value: CachedList) {
    resultCache.set(key, value);
    if (resultCache.size > RESULT_CACHE_MAX) {
        const oldest = resultCache.keys().next().value;
        if (oldest !== undefined) resultCache.delete(oldest);
    }
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

    const source = getBlocklistSource();
    const sortedCategories = [...categories].sort();
    const key = [
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
        for (const category of sortedCategories) {
            for (const d of await source.getCategoryDomains(category)) {
                domains.add(d);
            }
        }
        for (const customList of customLists) {
            for (const d of customList.domains) domains.add(d);
        }

        if (domains.size === 0) return EMPTY_BLOCKLIST;

        const sorted = [...domains].sort();
        const plain = Buffer.from(sorted.join("\n"), "utf-8");
        list = {
            version: createHash("sha256")
                .update(plain)
                .digest("hex")
                .slice(0, 16),
            compressed: (await zlibDeflate(plain)).toString("base64"),
            domainCount: sorted.length
        };
        cacheResult(key, list);
    }

    logger.debug(
        `Resolved DNS blocklist for olm ${olm.olmId}: ${list.domainCount} domains (${list.compressed.length} bytes compressed)`
    );

    // The block log setting is not part of the cached list, but it is part of
    // the version, so turning it on or off is pushed to devices.
    const logBlocks = entitlements.blockLog;
    return {
        ...list,
        version: logBlocks ? `${list.version}:log` : list.version,
        logBlocks
    };
}
