import { and, eq, sql } from "drizzle-orm";
import {
    db,
    siteNetworks,
    siteResources,
    targets,
    type SiteResource,
    type Transaction
} from "@server/db";
import {
    performDeleteResources,
    runResourceDeleteSideEffects,
    type DeleteResourceResult
} from "@server/lib/deleteResource";
import {
    performDeleteSiteResources,
    runSiteResourceDeleteSideEffects
} from "@server/lib/deleteSiteResource";
import logger from "@server/logger";

export const MAX_SITE_ASSOCIATED_RESOURCES_FOR_BULK_DELETE = 250;

export type DeleteSiteAssociatedResourcesSideEffects = {
    resources: DeleteResourceResult[];
    siteResources: SiteResource[];
};

export async function getResourceIdsForSite(
    siteId: number,
    trx: Transaction | typeof db = db
): Promise<number[]> {
    const rows = await trx
        .selectDistinct({ resourceId: targets.resourceId })
        .from(targets)
        .where(eq(targets.siteId, siteId));

    return rows.map((row) => row.resourceId);
}

export async function getSiteResourceIdsForSite(
    siteId: number,
    orgId: string,
    trx: Transaction | typeof db = db
): Promise<number[]> {
    const rows = await trx
        .selectDistinct({ siteResourceId: siteResources.siteResourceId })
        .from(siteNetworks)
        .innerJoin(
            siteResources,
            eq(siteResources.networkId, siteNetworks.networkId)
        )
        .where(
            and(eq(siteNetworks.siteId, siteId), eq(siteResources.orgId, orgId))
        );

    return rows.map((row) => row.siteResourceId);
}

export async function getAssociatedResourceCountForSite(
    siteId: number,
    orgId: string,
    trx: Transaction | typeof db = db
): Promise<number> {
    const [publicCountResult, privateCountResult] = await Promise.all([
        trx
            .select({
                count: sql<number>`count(distinct ${targets.resourceId})`
            })
            .from(targets)
            .where(eq(targets.siteId, siteId)),
        trx
            .select({
                count: sql<number>`count(distinct ${siteResources.siteResourceId})`
            })
            .from(siteNetworks)
            .innerJoin(
                siteResources,
                eq(siteResources.networkId, siteNetworks.networkId)
            )
            .where(
                and(
                    eq(siteNetworks.siteId, siteId),
                    eq(siteResources.orgId, orgId)
                )
            )
    ]);

    return (
        Number(publicCountResult[0]?.count ?? 0) +
        Number(privateCountResult[0]?.count ?? 0)
    );
}

export function exceedsSiteAssociatedResourceDeleteLimit(
    resourceCount: number
): boolean {
    return resourceCount > MAX_SITE_ASSOCIATED_RESOURCES_FOR_BULK_DELETE;
}

export async function deleteAssociatedResourcesForSite(
    siteId: number,
    orgId: string,
    trx: Transaction | typeof db = db
): Promise<DeleteSiteAssociatedResourcesSideEffects> {
    const resourceIds = await getResourceIdsForSite(siteId, trx);
    const siteResourceIds = await getSiteResourceIdsForSite(siteId, orgId, trx);

    const [resources, siteResourcesDeleted] = await Promise.all([
        performDeleteResources(resourceIds, trx),
        performDeleteSiteResources(siteResourceIds, trx)
    ]);

    return { resources, siteResources: siteResourcesDeleted };
}

export async function runDeleteSiteAssociatedResourcesSideEffects(
    sideEffects: DeleteSiteAssociatedResourcesSideEffects
): Promise<void> {
    for (const result of sideEffects.resources) {
        await runResourceDeleteSideEffects(result);
    }

    for (const removed of sideEffects.siteResources) {
        runSiteResourceDeleteSideEffects(removed);
    }
}
