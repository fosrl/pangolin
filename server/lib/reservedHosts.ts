import { and, eq, like, ne, sql } from "drizzle-orm";
import {
    db,
    domains,
    loginPage,
    redirects,
    resources,
    Transaction
} from "@server/db";
import config from "@server/lib/config";
import { build } from "@server/build";

type Tx = Transaction | typeof db;

/**
 * Whether a resource host serves the candidate host. "*.example.com" serves
 * every single label under example.com, but not example.com itself or deeper
 * names.
 */
export function hostCovers(host: string, candidate: string): boolean {
    const h = host.toLowerCase();
    const c = candidate.toLowerCase();
    if (!h.startsWith("*.")) {
        return h === c;
    }
    const suffix = h.slice(1); // ".example.com"
    if (!c.endsWith(suffix)) {
        return false;
    }
    const label = c.slice(0, -suffix.length);
    return label.length > 0 && !label.includes(".");
}

// The hostname the dashboard is served on, if configured.
export function getDashboardHost(): string | null {
    const dashboardUrl = config.getRawConfig().app.dashboard_url;
    if (!dashboardUrl) {
        return null;
    }
    try {
        return new URL(dashboardUrl).hostname.toLowerCase();
    } catch {
        return null;
    }
}

/**
 * Hosts no org may serve its own routes on: the dashboard host and any
 * login page domain. Returns an error message, or null if the host is free.
 */
export async function checkReservedHost(
    fullDomain: string,
    trx: Tx = db,
    matchBaseDomain: boolean = false
): Promise<string | null> {
    const host = fullDomain.toLowerCase();

    // A wildcard that also matches its base domain serves that host too
    if (matchBaseDomain && host.startsWith("*.")) {
        const baseError = await checkReservedHost(host.slice(2), trx);
        if (baseError) {
            return baseError;
        }
    }

    const covers = (candidate: string) => hostCovers(host, candidate);

    const dashboardHost = getDashboardHost();
    if (dashboardHost && covers(dashboardHost)) {
        return "Domain cannot be the same as the dashboard domain";
    }

    if (build != "oss") {
        const loginPages = await trx
            .select({ fullDomain: loginPage.fullDomain })
            .from(loginPage)
            .where(
                host.startsWith("*.")
                    ? like(loginPage.fullDomain, `%${host.slice(1)}`)
                    : eq(loginPage.fullDomain, host)
            );
        if (loginPages.some((p) => p.fullDomain && covers(p.fullDomain))) {
            return "Login page with that domain already exists";
        }
    }

    return null;
}

/**
 * A domain-attached redirect is answered before any auth and outranks
 * resource routers, so its host must not belong to anyone else: not the
 * dashboard, a login page, another org's resource or another org's redirect.
 * Resources in the same org may share the host (documented behaviour).
 */
export async function checkRedirectHostAvailable(
    fullDomain: string,
    orgId: string,
    excludeRedirectId?: number,
    trx: Tx = db
): Promise<string | null> {
    const host = fullDomain.toLowerCase();

    const reserved = await checkReservedHost(host, trx);
    if (reserved) {
        return reserved;
    }

    const [otherOrgResource] = await trx
        .select({ resourceId: resources.resourceId })
        .from(resources)
        .where(and(eq(resources.fullDomain, host), ne(resources.orgId, orgId)))
        .limit(1);
    if (otherOrgResource) {
        return "That domain is already in use by another organization";
    }

    const redirectHost = sql`lower(coalesce(${redirects.subdomain} || '.', '') || ${domains.baseDomain})`;
    const [otherOrgRedirect] = await trx
        .select({ redirectId: redirects.redirectId })
        .from(redirects)
        .innerJoin(domains, eq(domains.domainId, redirects.domainId))
        .where(
            and(
                ne(redirects.orgId, orgId),
                sql`${redirectHost} = ${host}`,
                excludeRedirectId !== undefined
                    ? ne(redirects.redirectId, excludeRedirectId)
                    : undefined
            )
        )
        .limit(1);
    if (otherOrgRedirect) {
        return "That domain is already in use by another organization";
    }

    return null;
}
