import { inArray } from "drizzle-orm";
import {
    db,
    siteResources,
    type SiteResource,
    type Transaction
} from "@server/db";
import logger from "@server/logger";
import { rebuildClientAssociationsFromSiteResource } from "@server/lib/rebuildClientAssociations";

export async function performDeleteSiteResources(
    siteResourceIds: number[],
    trx: Transaction | typeof db = db
): Promise<SiteResource[]> {
    if (siteResourceIds.length === 0) {
        return [];
    }

    const removedSiteResources = await trx
        .delete(siteResources)
        .where(inArray(siteResources.siteResourceId, siteResourceIds))
        .returning();

    if (removedSiteResources.length > 0) {
        logger.debug(`Deleted ${removedSiteResources.length} site resources`);
    }

    return removedSiteResources;
}

export async function performDeleteSiteResource(
    siteResourceId: number,
    trx: Transaction | typeof db = db
): Promise<SiteResource | null> {
    const [removedSiteResource] = await performDeleteSiteResources(
        [siteResourceId],
        trx
    );
    return removedSiteResource ?? null;
}

export function runSiteResourceDeleteSideEffects(
    removedSiteResource: SiteResource
): void {
    rebuildClientAssociationsFromSiteResource(removedSiteResource).catch(
        (err) => {
            logger.error(
                `Error rebuilding client associations for site resource ${removedSiteResource.siteResourceId}:`,
                err
            );
        }
    );
}
