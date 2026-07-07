import {
    Client,
    clients,
    clientSiteResources,
    clientSiteResourcesAssociationsCache,
    clientSitesAssociationsCache,
    db,
    exitNodes,
    newts,
    olms,
    primaryDb,
    roleSiteResources,
    Site,
    SiteResource,
    siteNetworks,
    siteResources,
    sites,
    Transaction,
    userOrgRoles,
    userSiteResources
} from "@server/db";
import { and, count, eq, inArray, ne } from "drizzle-orm";

import { deletePeersBatch as newtDeletePeersBatch } from "@server/routers/newt/peers";
import {
    initPeerAddHandshakeBatch,
    deletePeersBatch as olmDeletePeersBatch
} from "@server/routers/olm/peers";
import { sendToExitNode } from "#dynamic/lib/exitNodes";
import logger from "@server/logger";
import {
    generateAliasConfig,
    generateRemoteSubnets,
    generateSubnetProxyTargetV2,
    parseEndpoint
} from "@server/lib/ip";
import {
    addPeerData,
    addPeerDataBatch,
    addTargetsBatch as addSubnetProxyTargetsBatch,
    removePeerDataBatch,
    removeTargetsBatch as removeSubnetProxyTargetsBatch,
    updatePeerDataBatch,
    updateTargets
} from "@server/routers/client/targets";
import { lockManager } from "#dynamic/lib/lock";
import { rebuildQueue } from "#dynamic/lib/rebuildQueue";
import { withRetry, isTransientError } from "@server/lib/dbRetry";
import {
    checkOrgRebuildRateLimit,
    decrementOrgRebuildCount,
    incrementOrgRebuildCount,
    ORG_REBUILD_CONCURRENCY_LIMIT
} from "#dynamic/lib/orgRebuildCounter";

export { ORG_REBUILD_CONCURRENCY_LIMIT };

// TTL for rebuild-association locks. These functions can fan out into many
// peer/proxy updates, so give them a generous window.
const REBUILD_ASSOCIATIONS_LOCK_TTL_MS = 120000;

export async function isOrgRebuildRateLimited(orgId: string): Promise<boolean> {
    return checkOrgRebuildRateLimit(orgId);
}

const REBUILD_IDLE_POLL_INTERVAL_MS = 300;
const REBUILD_IDLE_DEFAULT_TIMEOUT_MS = 130_000; // slightly longer than lock TTL
const REBUILD_IDLE_HANDLER_TIMEOUT_MS = 5_000;

/**
 * Returns true if a rebuild for the given site resource is currently active
 * (holding the distributed lock) or is pending in the rebuild queue.
 */
export async function hasActiveSiteResourceRebuild(
    siteResourceId: number
): Promise<boolean> {
    const lockKey = `rebuild-client-associations:site-resource:${siteResourceId}`;
    const lockInfo = await lockManager.getLockInfo(lockKey);
    if (lockInfo.exists) return true;
    return rebuildQueue.isQueued({ type: "site-resource", id: siteResourceId });
}

/**
 * Resolves once there is no active or queued rebuild for the given site resource.
 * Logs a warning and resolves early if the timeout is reached.
 */
export async function waitForSiteResourceRebuildIdle(
    siteResourceId: number,
    timeoutMs = REBUILD_IDLE_DEFAULT_TIMEOUT_MS
): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        if (!(await hasActiveSiteResourceRebuild(siteResourceId))) return;
        await new Promise<void>((r) =>
            setTimeout(r, REBUILD_IDLE_POLL_INTERVAL_MS)
        );
    }
    logger.warn(
        `waitForSiteResourceRebuildIdle: timed out after ${timeoutMs}ms waiting for siteResourceId=${siteResourceId}`
    );
}

/**
 * Resolves once there are no active or queued rebuilds for any site resource
 * associated with the given site.
 */
export async function waitForSiteRebuildIdle(
    siteId: number,
    timeoutMs = REBUILD_IDLE_HANDLER_TIMEOUT_MS
): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        const resourceRows = await db
            .select({ siteResourceId: siteResources.siteResourceId })
            .from(siteResources)
            .innerJoin(
                siteNetworks,
                eq(siteNetworks.networkId, siteResources.networkId)
            )
            .where(eq(siteNetworks.siteId, siteId));
        let allIdle = true;
        for (const { siteResourceId } of resourceRows) {
            if (await hasActiveSiteResourceRebuild(siteResourceId)) {
                allIdle = false;
                break;
            }
        }
        if (allIdle) return;
        await new Promise<void>((r) =>
            setTimeout(r, REBUILD_IDLE_POLL_INTERVAL_MS)
        );
    }
    logger.warn(
        `waitForSiteRebuildIdle: timed out after ${timeoutMs}ms waiting for siteId=${siteId}`
    );
}

/**
 * Resolves once there are no active or queued rebuilds for any site resource
 * associated with the given client.
 */
export async function waitForClientRebuildIdle(
    clientId: number,
    timeoutMs = REBUILD_IDLE_HANDLER_TIMEOUT_MS
): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        const resourceRows = await db
            .select({
                siteResourceId:
                    clientSiteResourcesAssociationsCache.siteResourceId
            })
            .from(clientSiteResourcesAssociationsCache)
            .where(eq(clientSiteResourcesAssociationsCache.clientId, clientId));
        let allIdle = true;
        for (const { siteResourceId } of resourceRows) {
            if (await hasActiveSiteResourceRebuild(siteResourceId)) {
                allIdle = false;
                break;
            }
        }
        if (allIdle) return;
        await new Promise<void>((r) =>
            setTimeout(r, REBUILD_IDLE_POLL_INTERVAL_MS)
        );
    }
    logger.warn(
        `waitForClientRebuildIdle: timed out after ${timeoutMs}ms waiting for clientId=${clientId}`
    );
}

export async function getClientSiteResourceAccess(
    siteResource: SiteResource,
    trx: Transaction | typeof db = db
) {
    // get all sites associated with this siteResource via its network
    const sitesList = siteResource.networkId
        ? await trx
              .select()
              .from(sites)
              .innerJoin(siteNetworks, eq(siteNetworks.siteId, sites.siteId))
              .where(eq(siteNetworks.networkId, siteResource.networkId))
              .then((rows) => rows.map((row) => row.sites))
        : [];

    logger.debug(
        `rebuildClientAssociations: [getClientSiteResourceAccess] siteResourceId=${siteResource.siteResourceId} networkId=${siteResource.networkId} siteCount=${sitesList.length} siteIds=[${sitesList.map((s) => s.siteId).join(", ")}]`
    );

    if (sitesList.length === 0) {
        logger.warn(
            `No sites found for siteResource ${siteResource.siteResourceId} with networkId ${siteResource.networkId}`
        );
    }

    const roleIds = await trx
        .select()
        .from(roleSiteResources)
        .where(
            eq(roleSiteResources.siteResourceId, siteResource.siteResourceId)
        )
        .then((rows) => rows.map((row) => row.roleId));

    const directUserIds = await trx
        .select()
        .from(userSiteResources)
        .where(
            eq(userSiteResources.siteResourceId, siteResource.siteResourceId)
        )
        .then((rows) => rows.map((row) => row.userId));

    // get all of the users in these roles
    const userIdsFromRoles = await trx
        .select({
            userId: userOrgRoles.userId
        })
        .from(userOrgRoles)
        .where(inArray(userOrgRoles.roleId, roleIds))
        .then((rows) => rows.map((row) => row.userId));

    const newAllUserIds = Array.from(
        new Set([...directUserIds, ...userIdsFromRoles])
    );

    const newAllClients = await trx
        .select({
            clientId: clients.clientId,
            pubKey: clients.pubKey,
            subnet: clients.subnet
        })
        .from(clients)
        .where(
            and(
                inArray(clients.userId, newAllUserIds),
                eq(clients.orgId, siteResource.orgId) // filter by org to prevent cross-org associations
            )
        );

    const allClientSiteResources = await trx // this is for if a client is directly associated with a resource instead of implicitly via a user
        .select()
        .from(clientSiteResources)
        .where(
            eq(clientSiteResources.siteResourceId, siteResource.siteResourceId)
        );

    const directClientIds = allClientSiteResources.map((row) => row.clientId);

    // Get full client details for directly associated clients
    const directClients =
        directClientIds.length > 0
            ? await trx
                  .select({
                      clientId: clients.clientId,
                      pubKey: clients.pubKey,
                      subnet: clients.subnet
                  })
                  .from(clients)
                  .where(
                      and(
                          inArray(clients.clientId, directClientIds),
                          eq(clients.orgId, siteResource.orgId) // filter by org to prevent cross-org associations
                      )
                  )
            : [];

    // Merge user-based clients with directly associated clients
    const allClientsMap = new Map(
        [...newAllClients, ...directClients].map((c) => [c.clientId, c])
    );
    const mergedAllClients = Array.from(allClientsMap.values());
    const mergedAllClientIds = mergedAllClients.map((c) => c.clientId);

    logger.debug(
        `rebuildClientAssociations: [getClientSiteResourceAccess] siteResourceId=${siteResource.siteResourceId} mergedClientCount=${mergedAllClientIds.length} clientIds=[${mergedAllClientIds.join(", ")}] (userBased=${newAllClients.length} direct=${directClients.length})`
    );

    return {
        sitesList,
        mergedAllClients,
        mergedAllClientIds
    };
}

export async function rebuildClientAssociationsFromSiteResource(
    siteResource: SiteResource
) {
    await incrementOrgRebuildCount(siteResource.orgId);
    try {
        // The whole locked rebuild is idempotent (it diffs full expected vs.
        // actual state each time), so on a transient DB error it's safe to
        // retry the entire thing rather than just the failed query.
        return await withRetry(
            () =>
                lockManager.withLock(
                    `rebuild-client-associations:site-resource:${siteResource.siteResourceId}`,
                    () =>
                        rebuildClientAssociationsFromSiteResourceImpl(
                            siteResource
                        ),
                    REBUILD_ASSOCIATIONS_LOCK_TTL_MS
                ),
            `rebuildClientAssociationsFromSiteResource:${siteResource.siteResourceId}`
        );
    } catch (err: any) {
        if (
            typeof err?.message === "string" &&
            err.message.startsWith("Failed to acquire lock")
        ) {
            logger.warn(
                `rebuildClientAssociations: could not acquire lock for site resource ${siteResource.siteResourceId}, queuing for deferred processing`
            );
            await rebuildQueue.enqueue({
                type: "site-resource",
                id: siteResource.siteResourceId
            });
            return { mergedAllClients: [] };
        }
        if (isTransientError(err)) {
            logger.warn(
                `rebuildClientAssociations: transient DB error rebuilding site resource ${siteResource.siteResourceId} persisted after retries, queuing for deferred processing:`,
                err
            );
            await rebuildQueue.enqueue({
                type: "site-resource",
                id: siteResource.siteResourceId
            });
            return { mergedAllClients: [] };
        }
        throw err;
    } finally {
        await decrementOrgRebuildCount(siteResource.orgId);
    }
}

async function rebuildClientAssociationsFromSiteResourceImpl(
    siteResource: SiteResource
) {
    const trx = primaryDb;

    logger.debug(
        `rebuildClientAssociations: [rebuildClientAssociationsFromSiteResource] START siteResourceId=${siteResource.siteResourceId} networkId=${siteResource.networkId} orgId=${siteResource.orgId}`
    );

    const { sitesList, mergedAllClients, mergedAllClientIds } =
        await getClientSiteResourceAccess(siteResource, trx);

    logger.debug(
        `rebuildClientAssociations: [rebuildClientAssociationsFromSiteResource] access resolved siteResourceId=${siteResource.siteResourceId} siteCount=${sitesList.length} siteIds=[${sitesList.map((s) => s.siteId).join(", ")}] mergedClientCount=${mergedAllClients.length} clientIds=[${mergedAllClientIds.join(", ")}]`
    );

    /////////// process the client-siteResource associations ///////////

    const existingClientSiteResources = await trx
        .select({
            clientId: clientSiteResourcesAssociationsCache.clientId
        })
        .from(clientSiteResourcesAssociationsCache)
        .where(
            eq(
                clientSiteResourcesAssociationsCache.siteResourceId,
                siteResource.siteResourceId
            )
        );

    const existingClientSiteResourceIds = existingClientSiteResources.map(
        (row) => row.clientId
    );

    // get all of the clients associated with other site resources that share
    // any of the same sites as this site resource (via siteNetworks). We can't
    // simply filter by networkId since each site resource has its own network;
    // two site resources serving the same site typically belong to different
    // networks that both happen to include the site through siteNetworks.
    const sitesListSiteIds = sitesList.map((s) => s.siteId);

    // We must also consider sites where these clients are currently cached,
    // otherwise removing a site from this resource can leave stale
    // client-site cache entries behind for the removed site.
    const cachedSiteRowsForResourceClients =
        existingClientSiteResourceIds.length > 0
            ? await trx
                  .select({ siteId: clientSitesAssociationsCache.siteId })
                  .from(clientSitesAssociationsCache)
                  .where(
                      inArray(
                          clientSitesAssociationsCache.clientId,
                          existingClientSiteResourceIds
                      )
                  )
            : [];

    const allCandidateSiteIds = Array.from(
        new Set([
            ...sitesListSiteIds,
            ...cachedSiteRowsForResourceClients.map((r) => r.siteId)
        ])
    );

    const sitesToProcess =
        allCandidateSiteIds.length > 0
            ? await trx
                  .select()
                  .from(sites)
                  .where(inArray(sites.siteId, allCandidateSiteIds))
            : [];
    const currentSiteIdSet = new Set(sitesListSiteIds);
    const allUpdatedClientsFromOtherResourcesOnThisSite =
        allCandidateSiteIds.length > 0
            ? await trx
                  .select({
                      clientId: clientSiteResourcesAssociationsCache.clientId,
                      siteId: siteNetworks.siteId
                  })
                  .from(clientSiteResourcesAssociationsCache)
                  .innerJoin(
                      siteResources,
                      eq(
                          clientSiteResourcesAssociationsCache.siteResourceId,
                          siteResources.siteResourceId
                      )
                  )
                  .innerJoin(
                      siteNetworks,
                      eq(siteNetworks.networkId, siteResources.networkId)
                  )
                  .where(
                      and(
                          inArray(siteNetworks.siteId, allCandidateSiteIds),
                          ne(
                              siteResources.siteResourceId,
                              siteResource.siteResourceId
                          )
                      )
                  )
            : [];

    // Build a per-site map so the loop below can check by siteId rather than
    // across the entire network.
    const clientsFromOtherResourcesBySite = new Map<number, Set<number>>();
    for (const row of allUpdatedClientsFromOtherResourcesOnThisSite) {
        if (!clientsFromOtherResourcesBySite.has(row.siteId)) {
            clientsFromOtherResourcesBySite.set(row.siteId, new Set());
        }
        clientsFromOtherResourcesBySite.get(row.siteId)!.add(row.clientId);
    }

    logger.debug(
        `rebuildClientAssociations: [rebuildClientAssociationsFromSiteResource] siteResourceId=${siteResource.siteResourceId} existingResourceClientIds=[${existingClientSiteResourceIds.join(", ")}]`
    );

    // Get full client details for existing resource clients (needed for sending delete messages)
    const existingResourceClients =
        existingClientSiteResourceIds.length > 0
            ? await trx
                  .select({
                      clientId: clients.clientId,
                      pubKey: clients.pubKey,
                      subnet: clients.subnet
                  })
                  .from(clients)
                  .where(
                      inArray(clients.clientId, existingClientSiteResourceIds)
                  )
            : [];

    const clientSiteResourcesToAdd = mergedAllClientIds.filter(
        (clientId) => !existingClientSiteResourceIds.includes(clientId)
    );

    logger.debug(
        `rebuildClientAssociations: [rebuildClientAssociationsFromSiteResource] siteResourceId=${siteResource.siteResourceId} resourceClients toAdd=[${clientSiteResourcesToAdd.join(", ")}]`
    );

    const clientSiteResourcesToInsert = clientSiteResourcesToAdd.map(
        (clientId) => ({
            clientId,
            siteResourceId: siteResource.siteResourceId
        })
    );

    if (clientSiteResourcesToInsert.length > 0) {
        logger.debug(
            `rebuildClientAssociations: [rebuildClientAssociationsFromSiteResource] siteResourceId=${siteResource.siteResourceId} inserting ${clientSiteResourcesToInsert.length} clientSiteResource association(s)`
        );
        await trx
            .insert(clientSiteResourcesAssociationsCache)
            .values(clientSiteResourcesToInsert)
            .onConflictDoNothing()
            .returning();
        logger.debug(
            `rebuildClientAssociations: [rebuildClientAssociationsFromSiteResource] siteResourceId=${siteResource.siteResourceId} inserted clientSiteResource associations`
        );
    } else {
        logger.debug(
            `rebuildClientAssociations: [rebuildClientAssociationsFromSiteResource] siteResourceId=${siteResource.siteResourceId} no clientSiteResource associations to insert`
        );
    }

    const clientSiteResourcesToRemove = existingClientSiteResourceIds.filter(
        (clientId) => !mergedAllClientIds.includes(clientId)
    );

    logger.debug(
        `rebuildClientAssociations: [rebuildClientAssociationsFromSiteResource] siteResourceId=${siteResource.siteResourceId} resourceClients toRemove=[${clientSiteResourcesToRemove.join(", ")}]`
    );

    if (clientSiteResourcesToRemove.length > 0) {
        logger.debug(
            `rebuildClientAssociations: [rebuildClientAssociationsFromSiteResource] siteResourceId=${siteResource.siteResourceId} deleting ${clientSiteResourcesToRemove.length} clientSiteResource association(s)`
        );
        await trx
            .delete(clientSiteResourcesAssociationsCache)
            .where(
                and(
                    eq(
                        clientSiteResourcesAssociationsCache.siteResourceId,
                        siteResource.siteResourceId
                    ),
                    inArray(
                        clientSiteResourcesAssociationsCache.clientId,
                        clientSiteResourcesToRemove
                    )
                )
            );
    }

    /////////// process the client-site associations ///////////

    logger.debug(
        `rebuildClientAssociations: [rebuildClientAssociationsFromSiteResource] siteResourceId=${siteResource.siteResourceId} beginning client-site association loop over ${sitesToProcess.length} site(s) (current=${sitesList.length})`
    );

    for (const site of sitesToProcess) {
        const siteId = site.siteId;

        try {
            logger.debug(
                `rebuildClientAssociations: [rebuildClientAssociationsFromSiteResource] processing siteId=${siteId} for siteResourceId=${siteResource.siteResourceId}`
            );

            const existingClientSites = await trx
                .select({
                    clientId: clientSitesAssociationsCache.clientId
                })
                .from(clientSitesAssociationsCache)
                .where(eq(clientSitesAssociationsCache.siteId, siteId));

            const existingClientSiteIds = existingClientSites.map(
                (row) => row.clientId
            );

            logger.debug(
                `rebuildClientAssociations: [rebuildClientAssociationsFromSiteResource] siteId=${siteId} existingClientSiteIds=[${existingClientSiteIds.join(", ")}]`
            );

            // Get full client details for existing clients (needed for sending delete messages)
            const existingClients =
                existingClientSiteIds.length > 0
                    ? await trx
                          .select({
                              clientId: clients.clientId,
                              pubKey: clients.pubKey,
                              subnet: clients.subnet
                          })
                          .from(clients)
                          .where(
                              inArray(clients.clientId, existingClientSiteIds)
                          )
                    : [];

            const otherResourceClientIds =
                clientsFromOtherResourcesBySite.get(siteId) ??
                new Set<number>();

            logger.debug(
                `rebuildClientAssociations: [rebuildClientAssociationsFromSiteResource] siteId=${siteId} otherResourceClientIds=[${[...otherResourceClientIds].join(", ")}] mergedAllClientIds=[${mergedAllClientIds.join(", ")}]`
            );

            // Expected clients from this resource are site-scoped: if this site is
            // no longer attached to the resource, the expected set is empty.
            const expectedClientIdsForSite = currentSiteIdSet.has(siteId)
                ? mergedAllClientIds
                : [];

            // Note: we deliberately do NOT exclude clients covered by another
            // site resource here (unlike clientSitesToRemove below). Doing so
            // previously caused a permanent gap: if resource A saw resource B's
            // cache row and skipped adding (assuming B would maintain it), and
            // B's own rebuild made the same assumption about A, the site-level
            // row could end up never inserted by anyone even though both
            // resources' client associations were otherwise correct.
            // onConflictDoNothing makes a redundant insert harmless, so there's
            // no correctness reason to skip here.
            const clientSitesToAdd = expectedClientIdsForSite.filter(
                (clientId) => !existingClientSiteIds.includes(clientId)
            );

            const clientSitesToInsert = clientSitesToAdd.map((clientId) => ({
                clientId,
                siteId
            }));

            logger.debug(
                `rebuildClientAssociations: [rebuildClientAssociationsFromSiteResource] siteId=${siteId} clientSites toAdd=[${clientSitesToAdd.join(", ")}]`
            );

            if (clientSitesToInsert.length > 0) {
                logger.debug(
                    `rebuildClientAssociations: [rebuildClientAssociationsFromSiteResource] siteId=${siteId} inserting ${clientSitesToInsert.length} clientSite association(s)`
                );
                await trx
                    .insert(clientSitesAssociationsCache)
                    .values(clientSitesToInsert)
                    .onConflictDoNothing()
                    .returning();
                logger.debug(
                    `rebuildClientAssociations: [rebuildClientAssociationsFromSiteResource] siteId=${siteId} inserted clientSite associations`
                );
            } else {
                logger.debug(
                    `rebuildClientAssociations: [rebuildClientAssociationsFromSiteResource] siteId=${siteId} no clientSite associations to insert`
                );
            }

            // Now remove any client-site associations that should no longer exist
            const clientSitesToRemove = existingClientSiteIds.filter(
                (clientId) =>
                    !expectedClientIdsForSite.includes(clientId) &&
                    !otherResourceClientIds.has(clientId) // dont remove if there is still another connection for another site resource
            );

            logger.debug(
                `rebuildClientAssociations: [rebuildClientAssociationsFromSiteResource] siteId=${siteId} clientSites toRemove=[${clientSitesToRemove.join(", ")}]`
            );

            if (clientSitesToRemove.length > 0) {
                logger.debug(
                    `rebuildClientAssociations: [rebuildClientAssociationsFromSiteResource] siteId=${siteId} deleting ${clientSitesToRemove.length} clientSite association(s)`
                );
                await trx
                    .delete(clientSitesAssociationsCache)
                    .where(
                        and(
                            eq(clientSitesAssociationsCache.siteId, siteId),
                            inArray(
                                clientSitesAssociationsCache.clientId,
                                clientSitesToRemove
                            )
                        )
                    );
            }

            // Now handle the messages to add/remove peers on both the newt and olm sides
            await handleMessagesForSiteClients(
                site,
                siteId,
                mergedAllClients,
                existingClients,
                clientSitesToAdd,
                clientSitesToRemove,
                trx
            );
        } catch (err) {
            // Don't let a failure on one site abort processing of every
            // other site queued after it in this run. Since we're not
            // re-throwing, the outer wrapper's retry/requeue logic never
            // sees this failure, so explicitly queue this resource for a
            // follow-up pass to reconcile whatever this site didn't get to.
            logger.error(
                `rebuildClientAssociations: [rebuildClientAssociationsFromSiteResource] siteId=${siteId} failed while processing site for siteResourceId=${siteResource.siteResourceId}, continuing with remaining sites and queuing a follow-up pass:`,
                err
            );
            await rebuildQueue.enqueue({
                type: "site-resource",
                id: siteResource.siteResourceId
            });
        }
    }

    // Handle subnet proxy target updates for the resource associations
    await handleSubnetProxyTargetUpdates(
        siteResource,
        sitesList,
        mergedAllClients,
        existingResourceClients,
        clientSiteResourcesToAdd,
        clientSiteResourcesToRemove,
        trx
    );
}

async function handleMessagesForSiteClients(
    site: Site,
    siteId: number,
    allClients: {
        clientId: number;
        pubKey: string | null;
        subnet: string | null;
    }[],
    existingClients: {
        clientId: number;
        pubKey: string | null;
        subnet: string | null;
    }[],
    clientSitesToAdd: number[],
    clientSitesToRemove: number[],
    trx: Transaction | typeof db = db
): Promise<void> {
    if (!site.exitNodeId) {
        logger.debug(
            `Exit node ID not on site ${site.siteId} so there is no reason to update clients because it must be offline`
        );
        return;
    }

    // get the exit node for the site
    const [exitNode] = await trx
        .select()
        .from(exitNodes)
        .where(eq(exitNodes.exitNodeId, site.exitNodeId))
        .limit(1);

    if (!exitNode) {
        logger.debug(
            `Exit node not found for site ${site.siteId} so there is no reason to update clients because it must be offline`
        );
        return;
    }

    if (!site.publicKey) {
        logger.debug(
            `Site publicKey not set for site ${site.siteId} so cannot add peers to clients`
        );
        return;
    }

    const [newt] = await trx
        .select({
            newtId: newts.newtId
        })
        .from(newts)
        .where(eq(newts.siteId, siteId))
        .limit(1);
    if (!newt) {
        logger.debug(
            `Newt not found for site ${siteId} so cannot add peers to clients`
        );
        return;
    }

    const newtJobs: Promise<any>[] = [];
    const olmJobs: Promise<any>[] = [];
    const exitNodeJobs: Promise<any>[] = [];
    const newtPeerDeletes: {
        siteId: number;
        publicKey: string;
        newtId: string;
    }[] = [];
    const olmPeerDeletes: {
        clientId: number;
        siteId: number;
        publicKey: string;
        olmId: string;
    }[] = [];
    const olmPeerAddHandshakes: {
        clientId: number;
        peer: {
            siteId: number;
            exitNode: {
                publicKey: string;
                endpoint: string;
            };
        };
        olmId: string;
    }[] = [];

    // Combine all clients that need processing (those being added or removed)
    const clientsToProcess = new Map<
        number,
        {
            clientId: number;
            pubKey: string | null;
            subnet: string | null;
        }
    >();

    // Add clients that are being added (from newAllClients)
    for (const client of allClients) {
        if (clientSitesToAdd.includes(client.clientId)) {
            clientsToProcess.set(client.clientId, client);
        }
    }

    // Add clients that are being removed (from existingClients)
    for (const client of existingClients) {
        if (clientSitesToRemove.includes(client.clientId)) {
            clientsToProcess.set(client.clientId, client);
        }
    }

    // get the number of sites on each of these clients so we can log it and make decisions about whether to send messages based on it
    const clientSiteCounts: Record<number, number> = {};
    if (clientsToProcess.size > 0) {
        const clientIdsToProcess = Array.from(clientsToProcess.keys());
        const siteCounts = await trx
            .select({
                clientId: clientSitesAssociationsCache.clientId,
                siteCount: count(clientSitesAssociationsCache.siteId)
            })
            .from(clientSitesAssociationsCache)
            .where(
                inArray(
                    clientSitesAssociationsCache.clientId,
                    clientIdsToProcess
                )
            )
            .groupBy(clientSitesAssociationsCache.clientId);

        for (const row of siteCounts) {
            clientSiteCounts[row.clientId] = Number(row.siteCount);
        }
    }

    // Batch-fetch all olm IDs for the clients we need to process
    const clientIdsToProcess = Array.from(clientsToProcess.keys());
    const olmRows =
        clientIdsToProcess.length > 0
            ? await trx
                  .select({ olmId: olms.olmId, clientId: olms.clientId })
                  .from(olms)
                  .where(inArray(olms.clientId, clientIdsToProcess))
            : [];
    const olmByClientId = new Map<number, string>(
        olmRows
            .filter((r) => r.clientId !== null)
            .map((r) => [r.clientId as number, r.olmId])
    );

    for (const client of clientsToProcess.values()) {
        // UPDATE THE NEWT
        if (!client.subnet || !client.pubKey) {
            logger.debug("Client subnet, pubKey or endpoint is not set");
            continue;
        }

        // is this an add or a delete?
        const isAdd = clientSitesToAdd.includes(client.clientId);
        const isDelete = clientSitesToRemove.includes(client.clientId);

        if (!isAdd && !isDelete) {
            // nothing to do for this client
            continue;
        }

        const olmId = olmByClientId.get(client.clientId);
        if (!olmId) {
            logger.warn(
                `Olm not found for client ${client.clientId} so cannot add/delete peers`
            );
            continue;
        }

        if (isDelete) {
            newtPeerDeletes.push({
                siteId,
                publicKey: client.pubKey,
                newtId: newt.newtId
            });
            olmPeerDeletes.push({
                clientId: client.clientId,
                siteId,
                publicKey: site.publicKey,
                olmId
            });
        }

        if (isAdd) {
            if (clientSiteCounts[client.clientId] > 250) {
                // skip adding the peer if we have more than 250 sites because we are in jit mode anyway
                logger.info(
                    `rebuildClientAssociations: Client ${client.clientId} has ${clientSiteCounts[client.clientId]} sites so skipping adding peer to newt and olm because it is likely in jit mode`
                );
                continue;
            }

            olmPeerAddHandshakes.push({
                clientId: client.clientId,
                peer: {
                    siteId,
                    exitNode: {
                        publicKey: exitNode.publicKey,
                        endpoint: exitNode.endpoint
                    }
                },
                olmId
            });
        }

        exitNodeJobs.push(updateClientSiteDestinations(client, trx));
    }

    if (newtPeerDeletes.length > 0) {
        newtJobs.push(newtDeletePeersBatch(newtPeerDeletes));
    }

    if (olmPeerDeletes.length > 0) {
        olmJobs.push(olmDeletePeersBatch(olmPeerDeletes));
    }

    if (olmPeerAddHandshakes.length > 0) {
        olmJobs.push(initPeerAddHandshakeBatch(olmPeerAddHandshakes));
    }

    Promise.all(exitNodeJobs).catch((error) => {
        logger.error(
            `rebuildClientAssociations: Error updating client site destinations for site ${site.siteId}:`,
            error
        );
    });
    Promise.all(newtJobs).catch((error) => {
        logger.error(
            `rebuildClientAssociations: Error updating Newt peers for site ${site.siteId}:`,
            error
        );
    });
    Promise.all(olmJobs).catch((error) => {
        logger.error(
            `rebuildClientAssociations: Error updating Olm peers for site ${site.siteId}:`,
            error
        );
    });
}

interface PeerDestination {
    destinationIP: string;
    destinationPort: number;
}

// this updates the relay destinations for a client to point to all of the new sites
export async function updateClientSiteDestinations(
    client: {
        clientId: number;
        pubKey: string | null;
        subnet: string | null;
    },
    trx: Transaction | typeof db = db
): Promise<void> {
    let exitNodeDestinations: {
        reachableAt: string;
        exitNodeId: number;
        type: string;
        name: string;
        sourceIp: string;
        sourcePort: number;
        destinations: PeerDestination[];
    }[] = [];

    const sitesData = await trx
        .select()
        .from(sites)
        .innerJoin(
            clientSitesAssociationsCache,
            eq(sites.siteId, clientSitesAssociationsCache.siteId)
        )
        .leftJoin(exitNodes, eq(sites.exitNodeId, exitNodes.exitNodeId))
        .where(eq(clientSitesAssociationsCache.clientId, client.clientId));

    for (const site of sitesData) {
        if (!site.sites.subnet) {
            logger.debug(`Site ${site.sites.siteId} has no subnet, skipping`);
            continue;
        }

        if (!site.clientSitesAssociationsCache.endpoint) {
            // if this is a new association the endpoint is not set yet
            continue;
        }

        // Parse the endpoint properly for both IPv4 and IPv6
        const parsedEndpoint = parseEndpoint(
            site.clientSitesAssociationsCache.endpoint
        );
        if (!parsedEndpoint) {
            logger.warn(
                `Failed to parse endpoint ${site.clientSitesAssociationsCache.endpoint}, skipping`
            );
            continue;
        }

        // find the destinations in the array
        let destinations = exitNodeDestinations.find(
            (d) => d.reachableAt === site.exitNodes?.reachableAt
        );

        if (!destinations) {
            destinations = {
                reachableAt: site.exitNodes?.reachableAt || "",
                exitNodeId: site.exitNodes?.exitNodeId || 0,
                type: site.exitNodes?.type || "",
                name: site.exitNodes?.name || "",
                sourceIp: parsedEndpoint.ip,
                sourcePort: parsedEndpoint.port,
                destinations: [
                    {
                        destinationIP: site.sites.subnet.split("/")[0],
                        destinationPort: site.sites.listenPort || 1 // this satisfies gerbil for now but should be reevaluated
                    }
                ]
            };
        } else {
            // add to the existing destinations
            destinations.destinations.push({
                destinationIP: site.sites.subnet.split("/")[0],
                destinationPort: site.sites.listenPort || 1 // this satisfies gerbil for now but should be reevaluated
            });
        }

        // update it in the array
        exitNodeDestinations = exitNodeDestinations.filter(
            (d) => d.reachableAt !== site.exitNodes?.reachableAt
        );
        exitNodeDestinations.push(destinations);
    }

    for (const destination of exitNodeDestinations) {
        logger.info(
            `Updating destinations for exit node at ${destination.reachableAt}`
        );
        const payload = {
            sourceIp: destination.sourceIp,
            sourcePort: destination.sourcePort,
            destinations: destination.destinations
        };
        logger.debug(
            `Payload for update-destinations: ${JSON.stringify(payload, null, 2)}`
        );

        // Create an ExitNode-like object for sendToExitNode
        const exitNodeForComm = {
            exitNodeId: destination.exitNodeId,
            type: destination.type,
            reachableAt: destination.reachableAt,
            name: destination.name
        } as any; // Using 'as any' since we know sendToExitNode will handle this correctly

        await sendToExitNode(exitNodeForComm, {
            remoteType: "remoteExitNode/update-destinations",
            localPath: "/update-destinations",
            method: "POST",
            data: payload
        });
    }
}

async function handleSubnetProxyTargetUpdates(
    siteResource: SiteResource,
    sitesList: Site[],
    allClients: {
        clientId: number;
        pubKey: string | null;
        subnet: string | null;
    }[],
    existingClients: {
        clientId: number;
        pubKey: string | null;
        subnet: string | null;
    }[],
    clientSiteResourcesToAdd: number[],
    clientSiteResourcesToRemove: number[],
    trx: Transaction | typeof db = db
): Promise<void> {
    const proxyJobs: Promise<any>[] = [];
    const olmJobs: Promise<any>[] = [];
    const targetsToAddBatch: {
        newtId: string;
        targets: NonNullable<
            Awaited<ReturnType<typeof generateSubnetProxyTargetV2>>
        >;
        version: string | null;
    }[] = [];
    const targetsToRemoveBatch: {
        newtId: string;
        targets: NonNullable<
            Awaited<ReturnType<typeof generateSubnetProxyTargetV2>>
        >;
        version: string | null;
    }[] = [];

    for (const siteData of sitesList) {
        const siteId = siteData.siteId;

        // Get the newt for this site
        const [newt] = await trx
            .select()
            .from(newts)
            .where(eq(newts.siteId, siteId))
            .limit(1);

        if (!newt) {
            logger.warn(
                `Newt not found for site ${siteId}, skipping subnet proxy target updates`
            );
            continue;
        }

        // Generate targets for added associations
        if (clientSiteResourcesToAdd.length > 0) {
            const addedClients = allClients.filter((client) =>
                clientSiteResourcesToAdd.includes(client.clientId)
            );

            if (addedClients.length > 0) {
                const targetsToAdd = await generateSubnetProxyTargetV2(
                    siteResource,
                    addedClients
                );

                if (targetsToAdd) {
                    targetsToAddBatch.push({
                        newtId: newt.newtId,
                        targets: targetsToAdd,
                        version: newt.version
                    });
                }

                olmJobs.push(
                    addPeerDataBatch(
                        addedClients.map((client) => ({
                            clientId: client.clientId,
                            siteId,
                            remoteSubnets: generateRemoteSubnets([
                                siteResource
                            ]),
                            aliases: generateAliasConfig([siteResource])
                        }))
                    )
                );
            }
        }

        // here we use the existingSiteResource from BEFORE we updated the destination so we dont need to worry about updating destinations here

        // Generate targets for removed associations
        if (clientSiteResourcesToRemove.length > 0) {
            const removedClients = existingClients.filter((client) =>
                clientSiteResourcesToRemove.includes(client.clientId)
            );

            if (removedClients.length > 0) {
                const targetsToRemove = await generateSubnetProxyTargetV2(
                    siteResource,
                    removedClients
                );

                if (targetsToRemove) {
                    targetsToRemoveBatch.push({
                        newtId: newt.newtId,
                        targets: targetsToRemove,
                        version: newt.version
                    });
                }

                const peerDataRemovals: {
                    clientId: number;
                    siteId: number;
                    remoteSubnets: string[];
                    aliases: ReturnType<typeof generateAliasConfig>;
                }[] = [];

                for (const client of removedClients) {
                    if (!siteResource.destination) {
                        continue;
                    }
                    // Check if this client still has access to another resource
                    // on this specific site with the same destination. We scope
                    // by siteId (via siteNetworks) rather than networkId because
                    // removePeerData operates per-site - a resource on a different
                    // site sharing the same network should not block removal here.
                    const destinationStillInUse = await trx
                        .select()
                        .from(siteResources)
                        .innerJoin(
                            clientSiteResourcesAssociationsCache,
                            eq(
                                clientSiteResourcesAssociationsCache.siteResourceId,
                                siteResources.siteResourceId
                            )
                        )
                        .innerJoin(
                            siteNetworks,
                            eq(siteNetworks.networkId, siteResources.networkId)
                        )
                        .where(
                            and(
                                eq(
                                    clientSiteResourcesAssociationsCache.clientId,
                                    client.clientId
                                ),
                                eq(siteNetworks.siteId, siteId),
                                eq(
                                    siteResources.destination,
                                    siteResource.destination
                                ),
                                ne(
                                    siteResources.siteResourceId,
                                    siteResource.siteResourceId
                                )
                            )
                        );

                    // Only remove remote subnet if no other resource uses the same destination
                    const remoteSubnetsToRemove =
                        destinationStillInUse.length > 0
                            ? []
                            : generateRemoteSubnets([siteResource]);

                    peerDataRemovals.push({
                        clientId: client.clientId,
                        siteId,
                        remoteSubnets: remoteSubnetsToRemove,
                        aliases: generateAliasConfig([siteResource])
                    });
                }

                if (peerDataRemovals.length > 0) {
                    olmJobs.push(removePeerDataBatch(peerDataRemovals));
                }
            }
        }
    }

    if (targetsToAddBatch.length > 0) {
        proxyJobs.push(addSubnetProxyTargetsBatch(targetsToAddBatch));
    }

    if (targetsToRemoveBatch.length > 0) {
        proxyJobs.push(removeSubnetProxyTargetsBatch(targetsToRemoveBatch));
    }

    await Promise.all([...proxyJobs, ...olmJobs]);
}

export async function handleMessagingForUpdatedSiteResource(
    existingSiteResource: SiteResource | undefined,
    updatedSiteResource: SiteResource,
    existingSiteIds: number[],
    updatedSiteIds: number[]
) {
    const trx = primaryDb;

    logger.debug(
        `handleMessagingForUpdatedSiteResource: START siteResourceId=${updatedSiteResource.siteResourceId} existingSiteIds=[${existingSiteIds.join(", ")}] updatedSiteIds=[${updatedSiteIds.join(", ")}]`
    );

    logger.debug(
        "handleMessagingForUpdatedSiteResource: existingSiteResource is: ",
        existingSiteResource
    );
    logger.debug(
        "handleMessagingForUpdatedSiteResource: updatedSiteResource is: ",
        updatedSiteResource
    );

    const allSiteIds = [...new Set([...existingSiteIds, ...updatedSiteIds])];

    logger.debug(
        `handleMessagingForUpdatedSiteResource: allSiteIds=[${allSiteIds.join(", ")}] count=${allSiteIds.length}`
    );

    const newtsForSites =
        allSiteIds.length > 0
            ? await trx
                  .select()
                  .from(newts)
                  .where(inArray(newts.siteId, allSiteIds))
            : [];
    const newtBySiteId = new Map(
        newtsForSites.map((newt) => [newt.siteId, newt])
    );

    logger.debug(
        `handleMessagingForUpdatedSiteResource: fetched newts for ${newtsForSites.length}/${allSiteIds.length} site(s)`
    );

    // WARNING: THIS RELIES ON THE CACHE TABLES BEING UP TO DATE, SO CALL THIS AFTER THE ASSOCIATION CACHE IS UPDATED
    const mergedAllClients = await trx
        .select({
            clientId: clientSiteResourcesAssociationsCache.clientId,
            pubKey: clients.pubKey,
            subnet: clients.subnet
        })
        .from(clientSiteResourcesAssociationsCache)
        .innerJoin(
            clients,
            eq(clientSiteResourcesAssociationsCache.clientId, clients.clientId)
        )
        .where(
            eq(
                clientSiteResourcesAssociationsCache.siteResourceId,
                updatedSiteResource.siteResourceId
            )
        );

    logger.debug(
        `handleMessagingForUpdatedSiteResource: resolved merged clients count=${mergedAllClients.length} clientIds=[${mergedAllClients.map((c) => c.clientId).join(", ")}]`
    );

    const targets = await generateSubnetProxyTargetV2(
        updatedSiteResource,
        mergedAllClients
    );

    logger.debug(
        `handleMessagingForUpdatedSiteResource: generated updated targets count=${targets ? targets.length : 0}`
    );

    const oldDestinationStillInUseClientSitePairs = new Set<string>();
    if (
        existingSiteResource?.destination &&
        allSiteIds.length > 0 &&
        mergedAllClients.length > 0
    ) {
        logger.debug(
            `handleMessagingForUpdatedSiteResource: checking old destination reuse destination=${existingSiteResource.destination} across siteCount=${allSiteIds.length} clientCount=${mergedAllClients.length}`
        );

        // we need to do this because the client only knows about peers not resources so we need to make sure that we dont remove it if there is still a another resource
        const oldDestinationStillInUseRows = await trx
            .select({
                clientId: clientSiteResourcesAssociationsCache.clientId,
                siteId: siteNetworks.siteId
            })
            .from(siteResources)
            .innerJoin(
                clientSiteResourcesAssociationsCache,
                eq(
                    clientSiteResourcesAssociationsCache.siteResourceId,
                    siteResources.siteResourceId
                )
            )
            .innerJoin(
                siteNetworks,
                eq(siteNetworks.networkId, siteResources.networkId)
            )
            .where(
                and(
                    inArray(
                        clientSiteResourcesAssociationsCache.clientId,
                        mergedAllClients.map((c) => c.clientId)
                    ),
                    inArray(siteNetworks.siteId, allSiteIds),
                    eq(
                        siteResources.destination,
                        existingSiteResource.destination
                    ),
                    ne(
                        siteResources.siteResourceId,
                        existingSiteResource.siteResourceId
                    )
                )
            );

        for (const row of oldDestinationStillInUseRows) {
            oldDestinationStillInUseClientSitePairs.add(
                `${row.clientId}:${row.siteId}`
            );
        }

        logger.debug(
            `handleMessagingForUpdatedSiteResource: old destination still in use rows=${oldDestinationStillInUseRows.length} uniqueClientSitePairs=${oldDestinationStillInUseClientSitePairs.size}`
        );
    } else {
        logger.debug(
            "handleMessagingForUpdatedSiteResource: skipping old destination reuse check (missing existing destination or no sites/clients)"
        );
    }

    //////////////////////////// FROM HERE DOWN WE ARE DEALING WITH REMOVING SITES
    const removedSiteIds = existingSiteIds.filter(
        (id) => !updatedSiteIds.includes(id)
    );

    logger.debug(
        `handleMessagingForUpdatedSiteResource: removing sites removedSiteIds=[${removedSiteIds.join(", ")}] count=${removedSiteIds.length}`
    );

    const targetsToRemoveBatch: {
        newtId: string;
        targets: any[];
        version: string | null;
    }[] = [];
    const peerDataRemoves: {
        clientId: number;
        siteId: number;
        remoteSubnets: string[];
        aliases: ReturnType<typeof generateAliasConfig>;
    }[] = [];
    if (targets) {
        for (const siteId of removedSiteIds) {
            const newt = newtBySiteId.get(siteId);
            if (!newt) {
                logger.debug(
                    `handleMessagingForUpdatedSiteResource: skipping remove for siteId=${siteId} because no newt found`
                );
                continue;
            }

            logger.debug(
                `handleMessagingForUpdatedSiteResource: preparing remove batches for siteId=${siteId} newtId=${newt.newtId}`
            );

            targetsToRemoveBatch.push({
                newtId: newt.newtId,
                targets: targets,
                version: newt.version
            });
            for (const client of mergedAllClients) {
                // we need to do this because the client only knows about peers not resources so we need to make sure that we dont remove it if there is still a another resource
                const oldDestinationStillInUseBySite =
                    oldDestinationStillInUseClientSitePairs.has(
                        `${client.clientId}:${siteId}`
                    );

                if (existingSiteResource) {
                    peerDataRemoves.push({
                        // this might happen twice after the rebuild function but that is okay
                        clientId: client.clientId,
                        siteId,
                        remoteSubnets: !oldDestinationStillInUseBySite
                            ? generateRemoteSubnets([existingSiteResource])
                            : [],
                        aliases: generateAliasConfig([existingSiteResource])
                    });
                }
            }
        }
    } else {
        logger.debug(
            "handleMessagingForUpdatedSiteResource: skipping removal batch generation because targets were empty"
        );
    }

    logger.debug(
        `handleMessagingForUpdatedSiteResource: remove batches prepared targetBatchCount=${targetsToRemoveBatch.length} peerDataCount=${peerDataRemoves.length}`
    );

    logger.debug(
        "handleMessagingForUpdatedSiteResource: dispatching removeSubnetProxyTargetsBatch"
    );

    removeSubnetProxyTargetsBatch(targetsToRemoveBatch);

    logger.debug(
        "handleMessagingForUpdatedSiteResource: dispatching removePeerDataBatch"
    );

    removePeerDataBatch(peerDataRemoves);

    //////////////////////////// FROM HERE DOWN WE ARE DEALING WITH ADDING NEW SITES
    const addedSiteIds = updatedSiteIds.filter(
        (id) => !existingSiteIds.includes(id)
    );

    logger.debug(
        `handleMessagingForUpdatedSiteResource: adding sites addedSiteIds=[${addedSiteIds.join(", ")}] count=${addedSiteIds.length}`
    );

    const targetsToAddBatch: {
        newtId: string;
        targets: any[];
        version: string | null;
    }[] = [];
    const peerDataAdds: {
        clientId: number;
        siteId: number;
        remoteSubnets: string[];
        aliases: ReturnType<typeof generateAliasConfig>;
    }[] = [];
    if (targets) {
        for (const siteId of addedSiteIds) {
            const newt = newtBySiteId.get(siteId);
            if (!newt) {
                logger.debug(
                    `handleMessagingForUpdatedSiteResource: skipping add for siteId=${siteId} because no newt found`
                );
                continue;
            }

            logger.debug(
                `handleMessagingForUpdatedSiteResource: preparing add batches for siteId=${siteId} newtId=${newt.newtId}`
            );

            targetsToAddBatch.push({
                newtId: newt.newtId,
                targets: targets,
                version: newt.version
            });
            for (const client of mergedAllClients) {
                peerDataAdds.push({
                    clientId: client.clientId,
                    siteId,
                    remoteSubnets: generateRemoteSubnets([updatedSiteResource]),
                    aliases: generateAliasConfig([updatedSiteResource])
                });
            }
        }
    } else {
        logger.debug(
            "handleMessagingForUpdatedSiteResource: skipping add batch generation because targets were empty"
        );
    }

    logger.debug(
        `handleMessagingForUpdatedSiteResource: add batches prepared targetBatchCount=${targetsToAddBatch.length} peerDataCount=${peerDataAdds.length}`
    );

    logger.debug(
        "handleMessagingForUpdatedSiteResource: dispatching addSubnetProxyTargetsBatch"
    );

    addSubnetProxyTargetsBatch(targetsToAddBatch);

    logger.debug(
        "handleMessagingForUpdatedSiteResource: dispatching addPeerDataBatch"
    );

    addPeerDataBatch(peerDataAdds);

    //////////////////////////// FROM HERE DOWN WE ARE DEALING WITH UPDATING THE EXISTING SITES

    const unchangedSiteIds = existingSiteIds.filter((id) =>
        updatedSiteIds.includes(id)
    );

    logger.debug(
        `handleMessagingForUpdatedSiteResource: unchangedSiteIds=[${unchangedSiteIds.join(", ")}] count=${unchangedSiteIds.length}`
    );

    // after everything is rebuilt above we still need to update the targets and remote subnets if the destination changed
    const destinationChanged =
        existingSiteResource &&
        existingSiteResource.destination !== updatedSiteResource.destination;
    const destinationPortChanged =
        existingSiteResource &&
        existingSiteResource.destinationPort !==
            updatedSiteResource.destinationPort;
    const aliasChanged =
        existingSiteResource &&
        existingSiteResource.alias !== updatedSiteResource.alias;
    const fullDomainChanged =
        existingSiteResource &&
        existingSiteResource.fullDomain !== updatedSiteResource.fullDomain;
    const sslChanged =
        existingSiteResource &&
        existingSiteResource.ssl !== updatedSiteResource.ssl;
    const portRangesChanged =
        existingSiteResource &&
        (existingSiteResource.tcpPortRangeString !==
            updatedSiteResource.tcpPortRangeString ||
            existingSiteResource.udpPortRangeString !==
                updatedSiteResource.udpPortRangeString ||
            existingSiteResource.disableIcmp !==
                updatedSiteResource.disableIcmp);

    logger.debug(
        `handleMessagingForUpdatedSiteResource: change flags destinationChanged=${Boolean(destinationChanged)} destinationPortChanged=${Boolean(destinationPortChanged)} aliasChanged=${Boolean(aliasChanged)} fullDomainChanged=${Boolean(fullDomainChanged)} sslChanged=${Boolean(sslChanged)} portRangesChanged=${Boolean(portRangesChanged)}`
    );

    // if the existingSiteResource is undefined (new resource) we don't need to do anything here, the rebuild above handled it all

    if (
        destinationChanged ||
        aliasChanged ||
        fullDomainChanged ||
        sslChanged ||
        portRangesChanged ||
        destinationPortChanged
    ) {
        const shouldUpdateTargets =
            destinationChanged ||
            sslChanged ||
            portRangesChanged ||
            fullDomainChanged ||
            destinationPortChanged;

        logger.debug(
            `handleMessagingForUpdatedSiteResource: entering unchanged-site update path shouldUpdateTargets=${shouldUpdateTargets}`
        );

        const oldTargets = shouldUpdateTargets
            ? await generateSubnetProxyTargetV2(
                  existingSiteResource,
                  mergedAllClients
              )
            : [];
        const newTargets = shouldUpdateTargets
            ? await generateSubnetProxyTargetV2(
                  updatedSiteResource,
                  mergedAllClients
              )
            : [];

        logger.debug(
            `handleMessagingForUpdatedSiteResource: target update payload sizes oldTargets=${oldTargets ? oldTargets.length : 0} newTargets=${newTargets ? newTargets.length : 0}`
        );

        const peerDataUpdateBatch: Parameters<typeof updatePeerDataBatch>[0] =
            [];

        for (const siteId of unchangedSiteIds) {
            const newt = newtBySiteId.get(siteId);

            logger.debug(
                `handleMessagingForUpdatedSiteResource: processing unchanged siteId=${siteId}`
            );

            if (!newt) {
                logger.error(
                    `handleMessagingForUpdatedSiteResource: missing newt for unchanged siteId=${siteId}`
                );
                throw new Error(
                    "Newt not found for site during site resource update"
                );
            }

            // Only update targets on newt if these items change
            if (shouldUpdateTargets) {
                logger.debug(
                    `handleMessagingForUpdatedSiteResource: updating targets for siteId=${siteId} newtId=${newt.newtId}`
                );
                await updateTargets(
                    newt.newtId,
                    {
                        oldTargets: oldTargets ? oldTargets : [],
                        newTargets: newTargets ? newTargets : []
                    },
                    newt.version
                );
            }

            for (const client of mergedAllClients) {
                // does this client have access to another resource on this site that has the same destination still? if so we dont want to remove it from their olm yet
                if (!existingSiteResource.destination) {
                    logger.debug(
                        `handleMessagingForUpdatedSiteResource: skipping peerData update for clientId=${client.clientId} siteId=${siteId} because existing destination is empty`
                    );
                    continue;
                }

                // we need to do this because the client only knows about peers not resources so we need to make sure that we dont remove it if there is still a another resource
                const oldDestinationStillInUseBySite =
                    oldDestinationStillInUseClientSitePairs.has(
                        `${client.clientId}:${siteId}`
                    );

                // we also need to update the remote subnets on the olms for each client that has access to this site
                peerDataUpdateBatch.push({
                    clientId: client.clientId,
                    siteId,
                    remoteSubnets: destinationChanged
                        ? {
                              oldRemoteSubnets: !oldDestinationStillInUseBySite
                                  ? generateRemoteSubnets([
                                        existingSiteResource
                                    ])
                                  : [],
                              newRemoteSubnets: generateRemoteSubnets([
                                  updatedSiteResource
                              ])
                          }
                        : undefined,
                    aliases:
                        aliasChanged || fullDomainChanged // the full domain is sent down as an alias
                            ? {
                                  oldAliases: generateAliasConfig([
                                      existingSiteResource
                                  ]),
                                  newAliases: generateAliasConfig([
                                      updatedSiteResource
                                  ])
                              }
                            : undefined
                });
            }
        }

        logger.debug(
            `handleMessagingForUpdatedSiteResource: dispatching updatePeerDataBatch count=${peerDataUpdateBatch.length}`
        );

        updatePeerDataBatch(peerDataUpdateBatch);
    } else {
        logger.debug(
            "handleMessagingForUpdatedSiteResource: no unchanged-site update required because no relevant fields changed"
        );
    }

    logger.debug(
        `handleMessagingForUpdatedSiteResource: DONE siteResourceId=${updatedSiteResource.siteResourceId}`
    );
}

export async function rebuildClientAssociationsFromClient(
    client: Client
): Promise<void> {
    await incrementOrgRebuildCount(client.orgId);
    try {
        const trx = primaryDb;
        // The whole locked rebuild is idempotent (it diffs full expected vs.
        // actual state each time), so on a transient DB error it's safe to
        // retry the entire thing rather than just the failed query.
        return await withRetry(
            () =>
                lockManager.withLock(
                    `rebuild-client-associations:client:${client.clientId}`,
                    () => rebuildClientAssociationsFromClientImpl(client, trx),
                    REBUILD_ASSOCIATIONS_LOCK_TTL_MS
                ),
            `rebuildClientAssociationsFromClient:${client.clientId}`
        );
    } catch (err: any) {
        if (
            typeof err?.message === "string" &&
            err.message.startsWith("Failed to acquire lock")
        ) {
            logger.warn(
                `rebuildClientAssociations: could not acquire lock for client ${client.clientId}, queuing for deferred processing`
            );
            await rebuildQueue.enqueue({
                type: "client",
                id: client.clientId
            });
            return;
        }
        if (isTransientError(err)) {
            logger.warn(
                `rebuildClientAssociations: transient DB error rebuilding client ${client.clientId} persisted after retries, queuing for deferred processing:`,
                err
            );
            await rebuildQueue.enqueue({
                type: "client",
                id: client.clientId
            });
            return;
        }
        throw err;
    } finally {
        await decrementOrgRebuildCount(client.orgId);
    }
}

async function rebuildClientAssociationsFromClientImpl(
    client: Client,
    trx: Transaction | typeof db = db
): Promise<void> {
    let newSiteResourceIds: number[] = [];

    // 1. Direct client associations
    const directSiteResources = await trx
        .select({ siteResourceId: clientSiteResources.siteResourceId })
        .from(clientSiteResources)
        .innerJoin(
            siteResources,
            eq(siteResources.siteResourceId, clientSiteResources.siteResourceId)
        )
        .where(
            and(
                eq(clientSiteResources.clientId, client.clientId),
                eq(siteResources.orgId, client.orgId) // filter by org to prevent cross-org associations
            )
        );

    newSiteResourceIds.push(
        ...directSiteResources.map((r) => r.siteResourceId)
    );

    // 2. User-based and role-based access (if client has a userId)
    if (client.userId) {
        // Direct user associations
        const userSiteResourceIds = await trx
            .select({ siteResourceId: userSiteResources.siteResourceId })
            .from(userSiteResources)
            .innerJoin(
                siteResources,
                eq(
                    siteResources.siteResourceId,
                    userSiteResources.siteResourceId
                )
            )
            .where(
                and(
                    eq(userSiteResources.userId, client.userId),
                    eq(siteResources.orgId, client.orgId)
                )
            ); // this needs to be locked onto this org or else cross-org access could happen

        newSiteResourceIds.push(
            ...userSiteResourceIds.map((r) => r.siteResourceId)
        );

        // Role-based access
        const roleIds = await trx
            .select({ roleId: userOrgRoles.roleId })
            .from(userOrgRoles)
            .where(
                and(
                    eq(userOrgRoles.userId, client.userId),
                    eq(userOrgRoles.orgId, client.orgId)
                )
            ) // this needs to be locked onto this org or else cross-org access could happen
            .then((rows) => rows.map((row) => row.roleId));

        if (roleIds.length > 0) {
            const roleSiteResourceIds = await trx
                .select({ siteResourceId: roleSiteResources.siteResourceId })
                .from(roleSiteResources)
                .innerJoin(
                    siteResources,
                    eq(
                        siteResources.siteResourceId,
                        roleSiteResources.siteResourceId
                    )
                )
                .where(
                    and(
                        inArray(roleSiteResources.roleId, roleIds),
                        eq(siteResources.orgId, client.orgId) // filter by org to prevent cross-org associations
                    )
                );

            newSiteResourceIds.push(
                ...roleSiteResourceIds.map((r) => r.siteResourceId)
            );
        }
    }

    // Remove duplicates
    newSiteResourceIds = Array.from(new Set(newSiteResourceIds));

    // Get full siteResource details
    const newSiteResources =
        newSiteResourceIds.length > 0
            ? await trx
                  .select()
                  .from(siteResources)
                  .where(
                      inArray(siteResources.siteResourceId, newSiteResourceIds)
                  )
            : [];

    // Group by siteId for site-level associations - look up via siteNetworks since
    // siteResources no longer carries a direct siteId column.
    const networkIds = Array.from(
        new Set(
            newSiteResources
                .map((sr) => sr.networkId)
                .filter((id): id is number => id !== null)
        )
    );
    const newSiteIds =
        networkIds.length > 0
            ? await trx
                  .select({ siteId: siteNetworks.siteId })
                  .from(siteNetworks)
                  .where(inArray(siteNetworks.networkId, networkIds))
                  .then((rows) =>
                      Array.from(new Set(rows.map((r) => r.siteId)))
                  )
            : [];

    /////////// Process client-siteResource associations ///////////

    // Get existing resource associations
    const existingResourceAssociations = await trx
        .select({
            siteResourceId: clientSiteResourcesAssociationsCache.siteResourceId
        })
        .from(clientSiteResourcesAssociationsCache)
        .where(
            eq(clientSiteResourcesAssociationsCache.clientId, client.clientId)
        );

    const existingSiteResourceIds = existingResourceAssociations.map(
        (r) => r.siteResourceId
    );

    const resourcesToAdd = newSiteResourceIds.filter(
        (id) => !existingSiteResourceIds.includes(id)
    );

    const resourcesToRemove = existingSiteResourceIds.filter(
        (id) => !newSiteResourceIds.includes(id)
    );

    // Insert new associations
    if (resourcesToAdd.length > 0) {
        await trx
            .insert(clientSiteResourcesAssociationsCache)
            .values(
                resourcesToAdd.map((siteResourceId) => ({
                    clientId: client.clientId,
                    siteResourceId
                }))
            )
            .onConflictDoNothing();
    }

    // Remove old associations
    if (resourcesToRemove.length > 0) {
        await trx
            .delete(clientSiteResourcesAssociationsCache)
            .where(
                and(
                    eq(
                        clientSiteResourcesAssociationsCache.clientId,
                        client.clientId
                    ),
                    inArray(
                        clientSiteResourcesAssociationsCache.siteResourceId,
                        resourcesToRemove
                    )
                )
            );
    }

    /////////// Process client-site associations ///////////

    // Get existing site associations
    const existingSiteAssociations = await trx
        .select({ siteId: clientSitesAssociationsCache.siteId })
        .from(clientSitesAssociationsCache)
        .where(eq(clientSitesAssociationsCache.clientId, client.clientId));

    const existingSiteIds = existingSiteAssociations.map((s) => s.siteId);

    const sitesToAdd = newSiteIds.filter((id) => !existingSiteIds.includes(id));
    const sitesToRemove = existingSiteIds.filter(
        (id) => !newSiteIds.includes(id)
    );

    // Insert new site associations
    if (sitesToAdd.length > 0) {
        await trx
            .insert(clientSitesAssociationsCache)
            .values(
                sitesToAdd.map((siteId) => ({
                    clientId: client.clientId,
                    siteId
                }))
            )
            .onConflictDoNothing();
    }

    // Remove old site associations
    if (sitesToRemove.length > 0) {
        await trx
            .delete(clientSitesAssociationsCache)
            .where(
                and(
                    eq(clientSitesAssociationsCache.clientId, client.clientId),
                    inArray(clientSitesAssociationsCache.siteId, sitesToRemove)
                )
            );
    }

    /////////// Send messages ///////////

    // Handle messages for sites being added
    await handleMessagesForClientSites(client, sitesToAdd, sitesToRemove, trx);

    // Handle subnet proxy target updates for resources
    await handleMessagesForClientResources(
        client,
        newSiteResources,
        resourcesToAdd,
        resourcesToRemove,
        trx
    );
}

async function handleMessagesForClientSites(
    client: {
        clientId: number;
        pubKey: string | null;
        subnet: string | null;
        userId: string | null;
        orgId: string;
    },
    sitesToAdd: number[],
    sitesToRemove: number[],
    trx: Transaction | typeof db = db
): Promise<void> {
    // Get the olm for this client
    const [olm] = await trx
        .select({ olmId: olms.olmId })
        .from(olms)
        .where(eq(olms.clientId, client.clientId))
        .limit(1);

    if (!olm) {
        logger.warn(
            `Olm not found for client ${client.clientId}, skipping peer updates`
        );
        return;
    }

    const olmId = olm.olmId;

    if (!client.subnet || !client.pubKey) {
        logger.warn(
            `Client ${client.clientId} missing subnet or pubKey, skipping peer updates`
        );
        return;
    }

    const allSiteIds = [...sitesToAdd, ...sitesToRemove];
    if (allSiteIds.length === 0) {
        return;
    }

    // Get site details for all affected sites
    const sitesData = await trx
        .select()
        .from(sites)
        .leftJoin(exitNodes, eq(sites.exitNodeId, exitNodes.exitNodeId))
        .leftJoin(newts, eq(sites.siteId, newts.siteId))
        .where(inArray(sites.siteId, allSiteIds));

    const newtJobs: Promise<any>[] = [];
    const olmJobs: Promise<any>[] = [];
    const exitNodeJobs: Promise<any>[] = [];
    const newtPeerDeletes: {
        siteId: number;
        publicKey: string;
        newtId: string;
    }[] = [];
    const olmPeerDeletes: {
        clientId: number;
        siteId: number;
        publicKey: string;
        olmId: string;
    }[] = [];
    const olmPeerAddHandshakes: {
        clientId: number;
        peer: {
            siteId: number;
            exitNode: {
                publicKey: string;
                endpoint: string;
            };
        };
        olmId: string;
    }[] = [];

    const totalSitesOnClient = await trx
        .select({ count: count(clientSitesAssociationsCache.siteId) })
        .from(clientSitesAssociationsCache)
        .where(eq(clientSitesAssociationsCache.clientId, client.clientId))
        .then((rows) => Number(rows[0].count));

    for (const siteData of sitesData) {
        const site = siteData.sites;
        const exitNode = siteData.exitNodes;
        const newt = siteData.newt;

        if (!site.publicKey) {
            logger.warn(
                `Site ${site.siteId} missing publicKey, skipping peer updates`
            );
            continue;
        }

        if (!newt) {
            logger.warn(
                `Newt not found for site ${site.siteId}, skipping peer updates`
            );
            continue;
        }

        const isAdd = sitesToAdd.includes(site.siteId);
        const isRemove = sitesToRemove.includes(site.siteId);

        if (isRemove) {
            // Remove peer from newt
            newtPeerDeletes.push({
                siteId: site.siteId,
                publicKey: client.pubKey,
                newtId: newt.newtId
            });
            try {
                // Remove peer from olm
                olmPeerDeletes.push({
                    clientId: client.clientId,
                    siteId: site.siteId,
                    publicKey: site.publicKey,
                    olmId
                });
            } catch (error) {
                // if the error includes not found then its just because the olm does not exist anymore or yet and its fine if we dont send
                if (
                    error instanceof Error &&
                    error.message.includes("not found")
                ) {
                    logger.debug(
                        `Olm data not found for client ${client.clientId}, skipping removal`
                    );
                } else {
                    throw error;
                }
            }
        }

        if (isAdd) {
            if (!exitNode) {
                logger.warn(
                    `Exit node not found for site ${site.siteId}, skipping peer add`
                );
                continue;
            }

            if (totalSitesOnClient > 250) {
                // skip adding the site if we have more than 250 because we are in jit mode anyway
                logger.info(
                    `rebuildClientAssociations: Client ${client.clientId} has ${totalSitesOnClient} sites so skipping adding peer to newt and olm because it is likely in jit mode`
                );
                continue;
            }

            olmPeerAddHandshakes.push({
                clientId: client.clientId,
                peer: {
                    siteId: site.siteId,
                    exitNode: {
                        publicKey: exitNode.publicKey,
                        endpoint: exitNode.endpoint
                    }
                },
                olmId
            });
        }

        // Update exit node destinations
        exitNodeJobs.push(
            updateClientSiteDestinations(
                {
                    clientId: client.clientId,
                    pubKey: client.pubKey,
                    subnet: client.subnet
                },
                trx
            )
        );
    }

    if (newtPeerDeletes.length > 0) {
        newtJobs.push(newtDeletePeersBatch(newtPeerDeletes));
    }

    if (olmPeerDeletes.length > 0) {
        olmJobs.push(olmDeletePeersBatch(olmPeerDeletes));
    }

    if (olmPeerAddHandshakes.length > 0) {
        olmJobs.push(initPeerAddHandshakeBatch(olmPeerAddHandshakes));
    }

    Promise.all(exitNodeJobs).catch((error) => {
        logger.error(
            `rebuildClientAssociations: Error updating client site destinations for client ${client.clientId}:`,
            error
        );
    });
    Promise.all(newtJobs).catch((error) => {
        logger.error(
            `rebuildClientAssociations: Error updating Newt peers for client ${client.clientId}:`,
            error
        );
    });
    Promise.all(olmJobs).catch((error) => {
        logger.error(
            `rebuildClientAssociations: Error updating Olm peers for client ${client.clientId}:`,
            error
        );
    });
}

async function handleMessagesForClientResources(
    client: {
        clientId: number;
        pubKey: string | null;
        subnet: string | null;
        userId: string | null;
        orgId: string;
    },
    allNewResources: SiteResource[],
    resourcesToAdd: number[],
    resourcesToRemove: number[],
    trx: Transaction | typeof db = db
): Promise<void> {
    const proxyJobs: Promise<any>[] = [];
    const olmJobs: Promise<any>[] = [];

    // Handle additions
    if (resourcesToAdd.length > 0) {
        const addedResources = allNewResources.filter((r) =>
            resourcesToAdd.includes(r.siteResourceId)
        );

        // Build (resource, siteId) pairs by looking up siteNetworks for each resource's networkId
        const addedNetworkIds = Array.from(
            new Set(
                addedResources
                    .map((r) => r.networkId)
                    .filter((id): id is number => id !== null)
            )
        );
        const addedSiteNetworkRows =
            addedNetworkIds.length > 0
                ? await trx
                      .select({
                          networkId: siteNetworks.networkId,
                          siteId: siteNetworks.siteId
                      })
                      .from(siteNetworks)
                      .where(inArray(siteNetworks.networkId, addedNetworkIds))
                : [];
        const addedNetworkToSites = new Map<number, number[]>();
        for (const row of addedSiteNetworkRows) {
            if (!addedNetworkToSites.has(row.networkId)) {
                addedNetworkToSites.set(row.networkId, []);
            }
            addedNetworkToSites.get(row.networkId)!.push(row.siteId);
        }

        // Group by site for proxy updates
        const addedBySite = new Map<number, SiteResource[]>();
        for (const resource of addedResources) {
            const siteIds =
                resource.networkId != null
                    ? (addedNetworkToSites.get(resource.networkId) ?? [])
                    : [];
            for (const siteId of siteIds) {
                if (!addedBySite.has(siteId)) {
                    addedBySite.set(siteId, []);
                }
                addedBySite.get(siteId)!.push(resource);
            }
        }

        // Add subnet proxy targets for each site
        for (const [siteId, resources] of addedBySite.entries()) {
            const [newt] = await trx
                .select({ newtId: newts.newtId, version: newts.version })
                .from(newts)
                .where(eq(newts.siteId, siteId))
                .limit(1);

            if (!newt) {
                logger.warn(
                    `Newt not found for site ${siteId}, skipping proxy updates`
                );
                continue;
            }

            const targetsToAddBatch: {
                newtId: string;
                targets: NonNullable<
                    Awaited<ReturnType<typeof generateSubnetProxyTargetV2>>
                >;
                version: string | null;
            }[] = [];
            const peerDataAdds: {
                clientId: number;
                siteId: number;
                remoteSubnets: string[];
                aliases: ReturnType<typeof generateAliasConfig>;
            }[] = [];

            for (const resource of resources) {
                const targets = await generateSubnetProxyTargetV2(resource, [
                    {
                        clientId: client.clientId,
                        pubKey: client.pubKey,
                        subnet: client.subnet
                    }
                ]);

                if (targets) {
                    targetsToAddBatch.push({
                        newtId: newt.newtId,
                        targets,
                        version: newt.version
                    });
                }

                try {
                    // Add peer data to olm
                    peerDataAdds.push({
                        clientId: client.clientId,
                        siteId,
                        remoteSubnets: generateRemoteSubnets([resource]),
                        aliases: generateAliasConfig([resource])
                    });
                } catch (error) {
                    // if the error includes not found then its just because the olm does not exist anymore or yet and its fine if we dont send
                    if (
                        error instanceof Error &&
                        error.message.includes("not found")
                    ) {
                        logger.debug(
                            `Olm data not found for client ${client.clientId} and site ${siteId}, skipping addition`
                        );
                    } else {
                        throw error;
                    }
                }
            }

            if (targetsToAddBatch.length > 0) {
                proxyJobs.push(addSubnetProxyTargetsBatch(targetsToAddBatch));
            }

            if (peerDataAdds.length > 0) {
                olmJobs.push(addPeerDataBatch(peerDataAdds));
            }
        }
    }

    // Handle removals
    if (resourcesToRemove.length > 0) {
        const removedResources = await trx
            .select()
            .from(siteResources)
            .where(inArray(siteResources.siteResourceId, resourcesToRemove));

        // Build (resource, siteId) pairs via siteNetworks
        const removedNetworkIds = Array.from(
            new Set(
                removedResources
                    .map((r) => r.networkId)
                    .filter((id): id is number => id !== null)
            )
        );
        const removedSiteNetworkRows =
            removedNetworkIds.length > 0
                ? await trx
                      .select({
                          networkId: siteNetworks.networkId,
                          siteId: siteNetworks.siteId
                      })
                      .from(siteNetworks)
                      .where(inArray(siteNetworks.networkId, removedNetworkIds))
                : [];
        const removedNetworkToSites = new Map<number, number[]>();
        for (const row of removedSiteNetworkRows) {
            if (!removedNetworkToSites.has(row.networkId)) {
                removedNetworkToSites.set(row.networkId, []);
            }
            removedNetworkToSites.get(row.networkId)!.push(row.siteId);
        }

        // Group by site for proxy updates
        const removedBySite = new Map<number, SiteResource[]>();
        for (const resource of removedResources) {
            const siteIds =
                resource.networkId != null
                    ? (removedNetworkToSites.get(resource.networkId) ?? [])
                    : [];
            for (const siteId of siteIds) {
                if (!removedBySite.has(siteId)) {
                    removedBySite.set(siteId, []);
                }
                removedBySite.get(siteId)!.push(resource);
            }
        }

        // Remove subnet proxy targets for each site
        for (const [siteId, resources] of removedBySite.entries()) {
            const [newt] = await trx
                .select({ newtId: newts.newtId, version: newts.version })
                .from(newts)
                .where(eq(newts.siteId, siteId))
                .limit(1);

            if (!newt) {
                logger.warn(
                    `Newt not found for site ${siteId}, skipping proxy updates`
                );
                continue;
            }

            const targetsToRemoveBatch: {
                newtId: string;
                targets: NonNullable<
                    Awaited<ReturnType<typeof generateSubnetProxyTargetV2>>
                >;
                version: string | null;
            }[] = [];
            const peerDataRemovals: {
                clientId: number;
                siteId: number;
                remoteSubnets: string[];
                aliases: ReturnType<typeof generateAliasConfig>;
            }[] = [];

            for (const resource of resources) {
                const targets = await generateSubnetProxyTargetV2(resource, [
                    {
                        clientId: client.clientId,
                        pubKey: client.pubKey,
                        subnet: client.subnet
                    }
                ]);

                if (targets) {
                    targetsToRemoveBatch.push({
                        newtId: newt.newtId,
                        targets,
                        version: newt.version
                    });
                }

                try {
                    if (!resource.destination) {
                        continue;
                    }
                    // Check if this client still has access to another resource
                    // on this specific site with the same destination. We scope
                    // by siteId (via siteNetworks) rather than networkId because
                    // removePeerData operates per-site - a resource on a different
                    // site sharing the same network should not block removal here.
                    const destinationStillInUse = await trx
                        .select()
                        .from(siteResources)
                        .innerJoin(
                            clientSiteResourcesAssociationsCache,
                            eq(
                                clientSiteResourcesAssociationsCache.siteResourceId,
                                siteResources.siteResourceId
                            )
                        )
                        .innerJoin(
                            siteNetworks,
                            eq(siteNetworks.networkId, siteResources.networkId)
                        )
                        .where(
                            and(
                                eq(
                                    clientSiteResourcesAssociationsCache.clientId,
                                    client.clientId
                                ),
                                eq(siteNetworks.siteId, siteId),
                                eq(
                                    siteResources.destination,
                                    resource.destination
                                ),
                                ne(
                                    siteResources.siteResourceId,
                                    resource.siteResourceId
                                )
                            )
                        );

                    // Only remove remote subnet if no other resource uses the same destination on the same site
                    const remoteSubnetsToRemove =
                        destinationStillInUse.length > 0
                            ? []
                            : generateRemoteSubnets([resource]);

                    // Remove peer data from olm
                    peerDataRemovals.push({
                        clientId: client.clientId,
                        siteId,
                        remoteSubnets: remoteSubnetsToRemove,
                        aliases: generateAliasConfig([resource])
                    });
                } catch (error) {
                    // if the error includes not found then its just because the olm does not exist anymore or yet and its fine if we dont send
                    if (
                        error instanceof Error &&
                        error.message.includes("not found")
                    ) {
                        logger.debug(
                            `Olm data not found for client ${client.clientId} and site ${siteId}, skipping removal`
                        );
                    } else {
                        throw error;
                    }
                }
            }

            if (targetsToRemoveBatch.length > 0) {
                proxyJobs.push(
                    removeSubnetProxyTargetsBatch(targetsToRemoveBatch)
                );
            }

            if (peerDataRemovals.length > 0) {
                olmJobs.push(removePeerDataBatch(peerDataRemovals));
            }
        }
    }

    await Promise.all([...proxyJobs, ...olmJobs]);
}

export type ClientAssociationsCacheVerification = {
    clientId: number;
    consistent: boolean;
    // What permissions say the cache should contain
    expectedSiteResourceIds: number[];
    expectedSiteIds: number[];
    // What the cache currently contains
    actualSiteResourceIds: number[];
    actualSiteIds: number[];
    // Diff
    missingSiteResourceIds: number[]; // present in expected, missing from cache
    extraSiteResourceIds: number[]; // present in cache, not in expected
    missingSiteIds: number[];
    extraSiteIds: number[];
};

// verifyClientAssociationsCache walks the same permission-derivation logic as
// rebuildClientAssociationsFromClient but does NOT modify the database. It
// returns the expected vs actual cache contents and a boolean indicating
// whether the cache is in sync with what permissions imply.
export async function verifyClientAssociationsCache(
    client: Client,
    trx: Transaction | typeof db = db
): Promise<ClientAssociationsCacheVerification> {
    let newSiteResourceIds: number[] = [];

    // 1. Direct client associations
    const directSiteResources = await trx
        .select({ siteResourceId: clientSiteResources.siteResourceId })
        .from(clientSiteResources)
        .innerJoin(
            siteResources,
            eq(siteResources.siteResourceId, clientSiteResources.siteResourceId)
        )
        .where(
            and(
                eq(clientSiteResources.clientId, client.clientId),
                eq(siteResources.orgId, client.orgId)
            )
        );

    newSiteResourceIds.push(
        ...directSiteResources.map((r) => r.siteResourceId)
    );

    // 2. User-based and role-based access (if client has a userId)
    if (client.userId) {
        const userSiteResourceIds = await trx
            .select({ siteResourceId: userSiteResources.siteResourceId })
            .from(userSiteResources)
            .innerJoin(
                siteResources,
                eq(
                    siteResources.siteResourceId,
                    userSiteResources.siteResourceId
                )
            )
            .where(
                and(
                    eq(userSiteResources.userId, client.userId),
                    eq(siteResources.orgId, client.orgId)
                )
            );

        newSiteResourceIds.push(
            ...userSiteResourceIds.map((r) => r.siteResourceId)
        );

        const roleIds = await trx
            .select({ roleId: userOrgRoles.roleId })
            .from(userOrgRoles)
            .where(
                and(
                    eq(userOrgRoles.userId, client.userId),
                    eq(userOrgRoles.orgId, client.orgId)
                )
            )
            .then((rows) => rows.map((row) => row.roleId));

        if (roleIds.length > 0) {
            const roleSiteResourceIds = await trx
                .select({ siteResourceId: roleSiteResources.siteResourceId })
                .from(roleSiteResources)
                .innerJoin(
                    siteResources,
                    eq(
                        siteResources.siteResourceId,
                        roleSiteResources.siteResourceId
                    )
                )
                .where(
                    and(
                        inArray(roleSiteResources.roleId, roleIds),
                        eq(siteResources.orgId, client.orgId)
                    )
                );

            newSiteResourceIds.push(
                ...roleSiteResourceIds.map((r) => r.siteResourceId)
            );
        }
    }

    newSiteResourceIds = Array.from(new Set(newSiteResourceIds));

    const newSiteResources =
        newSiteResourceIds.length > 0
            ? await trx
                  .select()
                  .from(siteResources)
                  .where(
                      inArray(siteResources.siteResourceId, newSiteResourceIds)
                  )
            : [];

    const networkIds = Array.from(
        new Set(
            newSiteResources
                .map((sr) => sr.networkId)
                .filter((id): id is number => id !== null)
        )
    );
    const newSiteIds =
        networkIds.length > 0
            ? await trx
                  .select({ siteId: siteNetworks.siteId })
                  .from(siteNetworks)
                  .where(inArray(siteNetworks.networkId, networkIds))
                  .then((rows) =>
                      Array.from(new Set(rows.map((r) => r.siteId)))
                  )
            : [];

    // Read the existing cache state
    const existingResourceAssociations = await trx
        .select({
            siteResourceId: clientSiteResourcesAssociationsCache.siteResourceId
        })
        .from(clientSiteResourcesAssociationsCache)
        .where(
            eq(clientSiteResourcesAssociationsCache.clientId, client.clientId)
        );
    const existingSiteResourceIds = existingResourceAssociations.map(
        (r) => r.siteResourceId
    );

    const existingSiteAssociations = await trx
        .select({ siteId: clientSitesAssociationsCache.siteId })
        .from(clientSitesAssociationsCache)
        .where(eq(clientSitesAssociationsCache.clientId, client.clientId));
    const existingSiteIds = existingSiteAssociations.map((s) => s.siteId);

    const expectedSiteResourceSet = new Set(newSiteResourceIds);
    const actualSiteResourceSet = new Set(existingSiteResourceIds);
    const expectedSiteSet = new Set(newSiteIds);
    const actualSiteSet = new Set(existingSiteIds);

    const missingSiteResourceIds = newSiteResourceIds.filter(
        (id) => !actualSiteResourceSet.has(id)
    );
    const extraSiteResourceIds = existingSiteResourceIds.filter(
        (id) => !expectedSiteResourceSet.has(id)
    );
    const missingSiteIds = newSiteIds.filter((id) => !actualSiteSet.has(id));
    const extraSiteIds = existingSiteIds.filter(
        (id) => !expectedSiteSet.has(id)
    );

    const consistent =
        missingSiteResourceIds.length === 0 &&
        extraSiteResourceIds.length === 0 &&
        missingSiteIds.length === 0 &&
        extraSiteIds.length === 0;

    return {
        clientId: client.clientId,
        consistent,
        expectedSiteResourceIds: Array.from(expectedSiteResourceSet).sort(
            (a, b) => a - b
        ),
        expectedSiteIds: Array.from(expectedSiteSet).sort((a, b) => a - b),
        actualSiteResourceIds: Array.from(actualSiteResourceSet).sort(
            (a, b) => a - b
        ),
        actualSiteIds: Array.from(actualSiteSet).sort((a, b) => a - b),
        missingSiteResourceIds: missingSiteResourceIds.sort((a, b) => a - b),
        extraSiteResourceIds: extraSiteResourceIds.sort((a, b) => a - b),
        missingSiteIds: missingSiteIds.sort((a, b) => a - b),
        extraSiteIds: extraSiteIds.sort((a, b) => a - b)
    };
}

// cleanupSiteAssociations efficiently removes all client associations for a
// site that is being deleted. Instead of calling
// rebuildClientAssociationsFromSiteResource once per site resource (which is
// O(resources) in DB round-trips and message fan-out), this function performs
// a single bulk lookup of affected clients and site resources, deletes all
// cache rows at once, and fires all peer/proxy removal messages in parallel.
//
// The caller is responsible for deleting the site row itself (and for sending
// the newt/wg/terminate signal to the newt process).
export async function cleanupSiteAssociations(
    site: Site,
    trx: Transaction | typeof db = db
): Promise<void> {
    const siteId = site.siteId;

    logger.debug(`cleanupSiteAssociations: START siteId=${siteId}`);

    // 1. Find every client currently cached against this site.
    const cachedSiteClientRows = await trx
        .select({ clientId: clientSitesAssociationsCache.clientId })
        .from(clientSitesAssociationsCache)
        .where(eq(clientSitesAssociationsCache.siteId, siteId));

    const cachedClientIds = cachedSiteClientRows.map((r) => r.clientId);

    // 2. Load full client details (needed for WireGuard public-key references).
    const allClients =
        cachedClientIds.length > 0
            ? await trx
                  .select({
                      clientId: clients.clientId,
                      pubKey: clients.pubKey,
                      subnet: clients.subnet
                  })
                  .from(clients)
                  .where(inArray(clients.clientId, cachedClientIds))
            : [];

    // 6. Bulk-delete all cache entries for this site.  Do this before sending
    //    destination-update messages so updateClientSiteDestinations computes
    //    the correct (post-deletion) set of destinations.
    await trx
        .delete(clientSitesAssociationsCache)
        .where(eq(clientSitesAssociationsCache.siteId, siteId));

    logger.debug(
        `cleanupSiteAssociations: siteId=${siteId} cache cleared. clients=${allClients.length}`
    );

    // 7. Fire all removal messages in parallel.
    const jobs: Promise<any>[] = [];
    const olmPeerDeletes: {
        clientId: number;
        siteId: number;
        publicKey: string;
    }[] = [];

    for (const client of allClients) {
        // Tell each olm to drop the site's WireGuard peer.
        if (site.publicKey) {
            olmPeerDeletes.push({
                clientId: client.clientId,
                siteId,
                publicKey: site.publicKey
            });
        }

        // Recompute and push updated relay destinations (now excluding this site).
        if (client.pubKey && client.subnet) {
            jobs.push(updateClientSiteDestinations(client, trx));
        }
    }

    if (olmPeerDeletes.length > 0) {
        jobs.push(olmDeletePeersBatch(olmPeerDeletes));
    }

    await Promise.all(jobs).catch((error) => {
        logger.error(
            `cleanupSiteAssociations: error sending cleanup messages for siteId=${siteId}:`,
            error
        );
    });

    logger.debug(`cleanupSiteAssociations: DONE siteId=${siteId}`);
}

/**
 * Start the background rebuild queue processor. This should be called once
 * during server startup. Only one server instance at a time will actively
 * consume the queue (enforced via a distributed Redis lock); all other
 * instances will poll and wait until the lock becomes available.
 */
export function startRebuildQueueProcessor(): void {
    rebuildQueue.startProcessing({
        onSiteResource: async (siteResourceId: number) => {
            const [siteResource] = await primaryDb
                .select()
                .from(siteResources)
                .where(eq(siteResources.siteResourceId, siteResourceId));

            if (!siteResource) {
                logger.warn(
                    `Rebuild queue: site resource ${siteResourceId} not found, skipping`
                );
                return;
            }

            await rebuildClientAssociationsFromSiteResource(siteResource);
        },
        onClient: async (clientId: number) => {
            const [client] = await primaryDb
                .select()
                .from(clients)
                .where(eq(clients.clientId, clientId));

            if (!client) {
                logger.warn(
                    `Rebuild queue: client ${clientId} not found, skipping`
                );
                return;
            }

            await rebuildClientAssociationsFromClient(client);
        }
    });
}
