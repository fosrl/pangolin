import { and, eq, inArray, isNotNull } from "drizzle-orm";
import {
    primaryDb,
    redirects,
    resources,
    siteNetworks,
    siteResources,
    sites,
    targets
} from "@server/db";
import logger from "@server/logger";
import { publishTraefikConfigUpdate } from "#dynamic/lib/traefik/configUpdateTransport";

/**
 * Which exit nodes need to reload their traefik config after a change.
 * Mirrors how getTraefikConfig picks what goes onto each node:
 *  - resources go to the exit nodes of the sites their targets are on
 *  - local sites without an exit node are served by every node
 *  - inference resources, redirects and resources with redirects attached
 *    are emitted on every node
 *  - site resource (alias) placeholders go to the exit nodes of the sites
 *    in their network
 *  - login pages go to the exit node stored on the login page
 *
 * The resolvers below read from the primary because they usually run
 * right after the write that triggered them. They never throw: if the
 * lookup fails they fall back to "all", which is always safe.
 */
export type ExitNodeScope = "all" | Set<number>;

export function mergeExitNodeScopes(...scopes: ExitNodeScope[]): ExitNodeScope {
    const merged = new Set<number>();
    for (const scope of scopes) {
        if (scope === "all") return "all";
        scope.forEach((id) => merged.add(id));
    }
    return merged;
}

export function exitNodeScopeOf(
    ...exitNodeIds: (number | null | undefined)[]
): ExitNodeScope {
    return new Set(exitNodeIds.filter((id): id is number => id != null));
}

async function resolveSafely(
    label: string,
    resolve: () => Promise<ExitNodeScope>
): Promise<ExitNodeScope> {
    try {
        return await resolve();
    } catch (error) {
        logger.warn(
            `Failed to resolve exit nodes for ${label}, signalling all exit nodes:`,
            error
        );
        return "all";
    }
}

function scopeFromSiteRows(
    rows: { exitNodeId: number | null; type: string }[]
): ExitNodeScope {
    const ids = new Set<number>();
    for (const row of rows) {
        if (row.exitNodeId == null) {
            // local sites with no exit node are picked up by every exit
            // node that has "local" in traefik.site_types
            if (row.type === "local") return "all";
            continue;
        }
        ids.add(row.exitNodeId);
    }
    return ids;
}

export function getExitNodeScopeForSites(
    siteIds: number[]
): Promise<ExitNodeScope> {
    return resolveSafely(`sites ${siteIds.join(",")}`, async () => {
        if (siteIds.length === 0) return new Set();
        const rows = await primaryDb
            .select({ exitNodeId: sites.exitNodeId, type: sites.type })
            .from(sites)
            .where(inArray(sites.siteId, siteIds));
        return scopeFromSiteRows(rows);
    });
}

export function getExitNodeScopeForResources(
    resourceIds: number[]
): Promise<ExitNodeScope> {
    return resolveSafely(`resources ${resourceIds.join(",")}`, async () => {
        if (resourceIds.length === 0) return new Set();

        const resourceRows = await primaryDb
            .select({ mode: resources.mode })
            .from(resources)
            .where(inArray(resources.resourceId, resourceIds));
        if (resourceRows.some((r) => r.mode === "inference")) {
            return "all";
        }

        // redirects attached to a resource share its host and are emitted
        // on every exit node
        const [attachedRedirect] = await primaryDb
            .select({ redirectId: redirects.redirectId })
            .from(redirects)
            .where(inArray(redirects.resourceId, resourceIds))
            .limit(1);
        if (attachedRedirect) {
            return "all";
        }

        const siteRows = await primaryDb
            .selectDistinct({
                exitNodeId: sites.exitNodeId,
                type: sites.type
            })
            .from(targets)
            .innerJoin(sites, eq(sites.siteId, targets.siteId))
            .where(inArray(targets.resourceId, resourceIds));
        return scopeFromSiteRows(siteRows);
    });
}

export function getExitNodeScopeForSiteResources(
    siteResourceIds: number[]
): Promise<ExitNodeScope> {
    return resolveSafely(
        `site resources ${siteResourceIds.join(",")}`,
        async () => {
            if (siteResourceIds.length === 0) return new Set();

            const rows = await primaryDb
                .select({
                    mode: siteResources.mode,
                    networkId: siteResources.networkId
                })
                .from(siteResources)
                .where(
                    and(
                        inArray(siteResources.siteResourceId, siteResourceIds),
                        isNotNull(siteResources.fullDomain)
                    )
                );

            // site resources only reach traefik through a fullDomain:
            // inference ones on every node, http ones as cert placeholders
            if (rows.some((r) => r.mode === "inference")) {
                return "all";
            }

            const networkIds = rows
                .filter((r) => r.mode === "http" && r.networkId != null)
                .map((r) => r.networkId!);
            if (networkIds.length === 0) return new Set();

            const siteRows = await primaryDb
                .selectDistinct({
                    exitNodeId: sites.exitNodeId,
                    type: sites.type
                })
                .from(siteNetworks)
                .innerJoin(sites, eq(sites.siteId, siteNetworks.siteId))
                .where(inArray(siteNetworks.networkId, networkIds));
            return scopeFromSiteRows(siteRows);
        }
    );
}

/**
 * Every exit node any site in the org is on. Used when a change can touch
 * many of an org's resources at once (blueprints).
 */
export function getExitNodeScopeForOrg(orgId: string): Promise<ExitNodeScope> {
    return resolveSafely(`org ${orgId}`, async () => {
        const rows = await primaryDb
            .selectDistinct({
                exitNodeId: sites.exitNodeId,
                type: sites.type
            })
            .from(sites)
            .where(eq(sites.orgId, orgId));
        return scopeFromSiteRows(rows);
    });
}

/**
 * Tell the affected exit nodes to pull their traefik config now instead of
 * waiting for the next poll. Fire-and-forget: it never throws or delays the
 * caller, and a lost signal only means the node catches up on its next
 * regular poll. Call it after the change has been committed.
 */
export function notifyTraefikConfigChanged(
    scope: ExitNodeScope | Promise<ExitNodeScope>,
    reason: string
): void {
    void (async () => {
        try {
            const resolved = await scope;
            const channels =
                resolved === "all" ? ["all" as const] : [...resolved];
            if (channels.length === 0) return;

            logger.debug(
                `Signalling traefik config update (${reason}) to exit nodes: ${channels.join(", ")}`
            );
            await publishTraefikConfigUpdate(channels, reason);
        } catch (error) {
            logger.warn(
                `Failed to signal traefik config update (${reason}):`,
                error
            );
        }
    })();
}
