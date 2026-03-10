import {
    clients,
    clientSiteResourcesAssociationsCache,
    clientSitesAssociationsCache,
    db,
    domains,
    exitNodeOrgs,
    exitNodes,
    olms,
    orgDomains,
    orgs,
    remoteExitNodes,
    resources,
    sites,
    userOrgs
} from "@server/db";
import { newts, newtSessions } from "@server/db";
import { eq, and, inArray, sql, count, countDistinct } from "drizzle-orm";
import HttpCode from "@server/types/HttpCode";
import createHttpError from "http-errors";
import logger from "@server/logger";
import { sendToClient } from "#dynamic/routers/ws";
import { deletePeer } from "@server/routers/gerbil/peers";
import { OlmErrorCodes } from "@server/routers/olm/error";
import { sendTerminateClient } from "@server/routers/client/terminate";
import { usageService } from "./billing/usageService";
import { FeatureId } from "./billing";

export type DeleteOrgByIdResult = {
    deletedNewtIds: string[];
    olmsToTerminate: string[];
};

/**
 * Deletes one organization and its related data. Returns ids for termination
 * messages; caller should call sendTerminationMessages with the result.
 * Throws if org not found.
 */
export async function deleteOrgById(
    orgId: string
): Promise<DeleteOrgByIdResult> {
    const [org] = await db
        .select()
        .from(orgs)
        .where(eq(orgs.orgId, orgId))
        .limit(1);

    if (!org) {
        throw createHttpError(
            HttpCode.NOT_FOUND,
            `Organization with ID ${orgId} not found`
        );
    }

    const orgSites = await db
        .select()
        .from(sites)
        .where(eq(sites.orgId, orgId))
        .limit(1);

    const orgClients = await db
        .select()
        .from(clients)
        .where(eq(clients.orgId, orgId));

    const deletedNewtIds: string[] = [];
    const olmsToTerminate: string[] = [];

    let domainCount: number | null = null;
    let siteCount: number | null = null;
    let userCount: number | null = null;
    let remoteExitNodeCount: number | null = null;

    await db.transaction(async (trx) => {
        for (const site of orgSites) {
            if (site.pubKey) {
                if (site.type == "wireguard") {
                    await deletePeer(site.exitNodeId!, site.pubKey);
                } else if (site.type == "newt") {
                    const [deletedNewt] = await trx
                        .delete(newts)
                        .where(eq(newts.siteId, site.siteId))
                        .returning();
                    if (deletedNewt) {
                        deletedNewtIds.push(deletedNewt.newtId);
                        await trx
                            .delete(newtSessions)
                            .where(eq(newtSessions.newtId, deletedNewt.newtId));
                    }
                }
            }
            logger.info(`Deleting site ${site.siteId}`);
            await trx.delete(sites).where(eq(sites.siteId, site.siteId));
        }
        for (const client of orgClients) {
            const [olm] = await trx
                .select()
                .from(olms)
                .where(eq(olms.clientId, client.clientId))
                .limit(1);
            if (olm) {
                olmsToTerminate.push(olm.olmId);
            }
            logger.info(`Deleting client ${client.clientId}`);
            await trx
                .delete(clients)
                .where(eq(clients.clientId, client.clientId));
            await trx
                .delete(clientSiteResourcesAssociationsCache)
                .where(
                    eq(
                        clientSiteResourcesAssociationsCache.clientId,
                        client.clientId
                    )
                );
            await trx
                .delete(clientSitesAssociationsCache)
                .where(
                    eq(clientSitesAssociationsCache.clientId, client.clientId)
                );
        }

        await trx.delete(resources).where(eq(resources.orgId, orgId));

        const allOrgDomains = await trx
            .select()
            .from(orgDomains)
            .innerJoin(domains, eq(orgDomains.domainId, domains.domainId))
            .where(
                and(
                    eq(orgDomains.orgId, orgId),
                    eq(domains.configManaged, false)
                )
            );
        logger.info(`Found ${allOrgDomains.length} domains to delete`);
        const domainIdsToDelete: string[] = [];
        for (const orgDomain of allOrgDomains) {
            const domainId = orgDomain.domains.domainId;
            const [orgCount] = await trx
                .select({ count: count() })
                .from(orgDomains)
                .where(eq(orgDomains.domainId, domainId));
            logger.info(`Found ${orgCount.count} orgs using domain ${domainId}`);
            if (orgCount.count === 1) {
                domainIdsToDelete.push(domainId);
            }
        }
        logger.info(`Found ${domainIdsToDelete.length} domains to delete`);
        if (domainIdsToDelete.length > 0) {
            await trx
                .delete(domains)
                .where(inArray(domains.domainId, domainIdsToDelete));
        }

        await usageService.add(orgId, FeatureId.ORGINIZATIONS, -1, trx); // here we are decreasing the org count BEFORE deleting the org because we need to still be able to get the org to get the billing org inside of here

        await trx.delete(orgs).where(eq(orgs.orgId, orgId));

        if (org.billingOrgId) {
            const billingOrgs = await trx
                .select()
                .from(orgs)
                .where(eq(orgs.billingOrgId, org.billingOrgId));

            if (billingOrgs.length > 0) {
                const billingOrgIds = billingOrgs.map((org) => org.orgId);

                const [domainCountRes] = await trx
                    .select({ count: count() })
                    .from(orgDomains)
                    .where(inArray(orgDomains.orgId, billingOrgIds));

                domainCount = domainCountRes.count;

                const [siteCountRes] = await trx
                    .select({ count: count() })
                    .from(sites)
                    .where(inArray(sites.orgId, billingOrgIds));

                siteCount = siteCountRes.count;

                const [userCountRes] = await trx
                    .select({ count: countDistinct(userOrgs.userId) })
                    .from(userOrgs)
                    .where(inArray(userOrgs.orgId, billingOrgIds));

                userCount = userCountRes.count;

                const [remoteExitNodeCountRes] = await trx
                    .select({ count: countDistinct(exitNodeOrgs.exitNodeId) })
                    .from(exitNodeOrgs)
                    .where(inArray(exitNodeOrgs.orgId, billingOrgIds));

                remoteExitNodeCount = remoteExitNodeCountRes.count;
            }
        }
    });

    if (org.billingOrgId) {
        usageService.updateCount(
            org.billingOrgId,
            FeatureId.DOMAINS,
            domainCount ?? 0
        );
        usageService.updateCount(
            org.billingOrgId,
            FeatureId.SITES,
            siteCount ?? 0
        );
        usageService.updateCount(
            org.billingOrgId,
            FeatureId.USERS,
            userCount ?? 0
        );
        usageService.updateCount(
            org.billingOrgId,
            FeatureId.REMOTE_EXIT_NODES,
            remoteExitNodeCount ?? 0
        );
    }

    return { deletedNewtIds, olmsToTerminate };
}

export function sendTerminationMessages(result: DeleteOrgByIdResult): void {
    for (const newtId of result.deletedNewtIds) {
        sendToClient(newtId, { type: `newt/wg/terminate`, data: {} }).catch(
            (error) => {
                logger.error(
                    "Failed to send termination message to newt:",
                    error
                );
            }
        );
    }
    for (const olmId of result.olmsToTerminate) {
        sendTerminateClient(0, OlmErrorCodes.TERMINATED_REKEYED, olmId).catch(
            (error) => {
                logger.error(
                    "Failed to send termination message to olm:",
                    error
                );
            }
        );
    }
}
