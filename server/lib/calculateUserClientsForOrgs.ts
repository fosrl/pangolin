import { listExitNodes } from "#dynamic/lib/exitNodes";
import { build } from "@server/build";
import {
    approvals,
    clients,
    db,
    olms,
    orgs,
    primaryDb,
    roleClients,
    roles,
    Transaction,
    userClients,
    userOrgRoles,
    userOrgs
} from "@server/db";
import { getUniqueClientName } from "@server/db/names";
import { getNextAvailableClientSubnet } from "@server/lib/ip";
import { isLicensedOrSubscribed } from "#dynamic/lib/isLicencedOrSubscribed";
import logger from "@server/logger";
import { sendTerminateClient } from "@server/routers/client/terminate";
import { and, eq, notInArray, type InferInsertModel } from "drizzle-orm";
import { rebuildClientAssociationsFromClient } from "./rebuildClientAssociations";
import { OlmErrorCodes } from "@server/routers/olm/error";
import { tierMatrix } from "./billing/tierMatrix";

type ClientRow = typeof clients.$inferSelect;

function runQueuedClientAssociationRebuilds(
    userId: string,
    queuedClients: ClientRow[]
) {
    if (queuedClients.length === 0) {
        return;
    }

    const uniqueClientsById = new Map<number, ClientRow>();
    for (const client of queuedClients) {
        uniqueClientsById.set(client.clientId, client);
    }

    for (const client of uniqueClientsById.values()) {
        rebuildClientAssociationsFromClient(client).catch((error) => {
            logger.error(
                `Error rebuilding client associations for client ${client.clientId} (user ${userId}): ${String(
                    error
                )}`
            );
        });
    }

    logger.debug(
        `Queued association rebuild completed for ${uniqueClientsById.size} client(s) (user ${userId})`
    );
}

export async function calculateUserClientsForOrgs(
    userId: string
): Promise<void> {
    const trx = primaryDb;

    const queuedAssociationRebuilds: ClientRow[] = [];
    const orgCache = new Map<string, typeof orgs.$inferSelect | null>();
    const adminRoleCache = new Map<string, typeof roles.$inferSelect | null>();
    const exitNodesCache = new Map<
        string,
        Awaited<ReturnType<typeof listExitNodes>>
    >();
    const isOrgLicensedCache = new Map<string, boolean>();
    const existingClientCache = new Map<
        string,
        typeof clients.$inferSelect | null
    >();
    const roleClientAccessCache = new Map<string, boolean>();
    const userClientAccessCache = new Map<string, boolean>();

    const getOrgOlmKey = (orgId: string, olmId: string) => `${orgId}:${olmId}`;
    const getRoleClientKey = (roleId: number, clientId: number) =>
        `${roleId}:${clientId}`;
    const getUserClientKey = (cachedUserId: string, clientId: number) =>
        `${cachedUserId}:${clientId}`;

    const getOrg = async (orgId: string) => {
        if (orgCache.has(orgId)) {
            return orgCache.get(orgId) ?? null;
        }

        const [org] = await trx
            .select()
            .from(orgs)
            .where(eq(orgs.orgId, orgId));
        orgCache.set(orgId, org ?? null);

        return org ?? null;
    };

    const getAdminRole = async (orgId: string) => {
        if (adminRoleCache.has(orgId)) {
            return adminRoleCache.get(orgId) ?? null;
        }

        const [adminRole] = await trx
            .select()
            .from(roles)
            .where(and(eq(roles.isAdmin, true), eq(roles.orgId, orgId)))
            .limit(1);
        adminRoleCache.set(orgId, adminRole ?? null);

        return adminRole ?? null;
    };

    const getExitNodes = async (orgId: string) => {
        if (exitNodesCache.has(orgId)) {
            return exitNodesCache.get(orgId)!;
        }

        const exitNodes = await listExitNodes(orgId);
        exitNodesCache.set(orgId, exitNodes);

        return exitNodes;
    };

    const getIsOrgLicensed = async (orgId: string) => {
        if (isOrgLicensedCache.has(orgId)) {
            return isOrgLicensedCache.get(orgId)!;
        }

        const isOrgLicensed = await isLicensedOrSubscribed(
            orgId,
            tierMatrix.deviceApprovals
        );
        isOrgLicensedCache.set(orgId, isOrgLicensed);

        return isOrgLicensed;
    };

    const getExistingClient = async (orgId: string, olmId: string) => {
        const key = getOrgOlmKey(orgId, olmId);
        if (existingClientCache.has(key)) {
            return existingClientCache.get(key) ?? null;
        }

        const [existingClient] = await trx
            .select()
            .from(clients)
            .where(
                and(
                    eq(clients.userId, userId),
                    eq(clients.orgId, orgId),
                    eq(clients.olmId, olmId)
                )
            )
            .limit(1);

        existingClientCache.set(key, existingClient ?? null);

        return existingClient ?? null;
    };

    const hasRoleClientAccess = async (roleId: number, clientId: number) => {
        const key = getRoleClientKey(roleId, clientId);
        if (roleClientAccessCache.has(key)) {
            return roleClientAccessCache.get(key)!;
        }

        const [existingRoleClient] = await trx
            .select()
            .from(roleClients)
            .where(
                and(
                    eq(roleClients.roleId, roleId),
                    eq(roleClients.clientId, clientId)
                )
            )
            .limit(1);

        const hasAccess = Boolean(existingRoleClient);
        roleClientAccessCache.set(key, hasAccess);

        return hasAccess;
    };

    const hasUserClientAccess = async (
        cachedUserId: string,
        clientId: number
    ) => {
        const key = getUserClientKey(cachedUserId, clientId);
        if (userClientAccessCache.has(key)) {
            return userClientAccessCache.get(key)!;
        }

        const [existingUserClient] = await trx
            .select()
            .from(userClients)
            .where(
                and(
                    eq(userClients.userId, cachedUserId),
                    eq(userClients.clientId, clientId)
                )
            )
            .limit(1);

        const hasAccess = Boolean(existingUserClient);
        userClientAccessCache.set(key, hasAccess);

        return hasAccess;
    };

    // Get all OLMs for this user
    const userOlms = await trx
        .select()
        .from(olms)
        .where(eq(olms.userId, userId));

    if (userOlms.length === 0) {
        // No OLMs for this user, but we should still clean up any orphaned clients
        await cleanupOrphanedClients(
            userId,
            trx,
            [],
            queuedAssociationRebuilds
        );
        return;
    }

    // Get all user orgs with all roles (for org list and role-based logic)
    const userOrgRoleRows = await trx
        .select()
        .from(userOrgs)
        .innerJoin(
            userOrgRoles,
            and(
                eq(userOrgs.userId, userOrgRoles.userId),
                eq(userOrgs.orgId, userOrgRoles.orgId)
            )
        )
        .innerJoin(roles, eq(userOrgRoles.roleId, roles.roleId))
        .where(eq(userOrgs.userId, userId));

    const userOrgIds = [
        ...new Set(userOrgRoleRows.map((r) => r.userOrgs.orgId))
    ];
    const orgIdToRoleRows = new Map<string, (typeof userOrgRoleRows)[0][]>();
    for (const r of userOrgRoleRows) {
        const list = orgIdToRoleRows.get(r.userOrgs.orgId) ?? [];
        list.push(r);
        orgIdToRoleRows.set(r.userOrgs.orgId, list);
    }
    const orgRequiresDeviceApprovalRole = new Map<string, boolean>();
    for (const [orgId, roleRowsForOrg] of orgIdToRoleRows.entries()) {
        orgRequiresDeviceApprovalRole.set(
            orgId,
            roleRowsForOrg.some((r) => r.roles.requireDeviceApproval)
        );
    }

    // For each OLM, ensure there's a client in each org the user is in
    for (const olm of userOlms) {
        for (const orgId of orgIdToRoleRows.keys()) {
            const roleRowsForOrg = orgIdToRoleRows.get(orgId)!;
            const userOrg = roleRowsForOrg[0].userOrgs;

            const org = await getOrg(orgId);

            if (!org) {
                logger.warn(
                    `Skipping org ${orgId} for OLM ${olm.olmId} (user ${userId}): org not found`
                );
                continue;
            }

            if (!org.subnet) {
                logger.warn(
                    `Skipping org ${orgId} for OLM ${olm.olmId} (user ${userId}): org has no subnet configured`
                );
                continue;
            }

            // Get admin role for this org (needed for access grants)
            const adminRole = await getAdminRole(orgId);

            if (!adminRole) {
                logger.warn(
                    `Skipping org ${orgId} for OLM ${olm.olmId} (user ${userId}): no admin role found`
                );
                continue;
            }

            // Check if a client already exists for this OLM+user+org combination
            const existingClient = await getExistingClient(orgId, olm.olmId);

            if (existingClient) {
                // Ensure admin role has access to the client
                const hasRoleAccess = await hasRoleClientAccess(
                    adminRole.roleId,
                    existingClient.clientId
                );

                if (!hasRoleAccess) {
                    await trx.insert(roleClients).values({
                        roleId: adminRole.roleId,
                        clientId: existingClient.clientId
                    });
                    roleClientAccessCache.set(
                        getRoleClientKey(
                            adminRole.roleId,
                            existingClient.clientId
                        ),
                        true
                    );
                    logger.debug(
                        `Granted admin role access to existing client ${existingClient.clientId} for OLM ${olm.olmId} in org ${orgId} (user ${userId})`
                    );
                }

                // Ensure user has access to the client
                const hasUserAccess = await hasUserClientAccess(
                    userId,
                    existingClient.clientId
                );

                if (!hasUserAccess) {
                    await trx.insert(userClients).values({
                        userId,
                        clientId: existingClient.clientId
                    });
                    userClientAccessCache.set(
                        getUserClientKey(userId, existingClient.clientId),
                        true
                    );
                    logger.debug(
                        `Granted user access to existing client ${existingClient.clientId} for OLM ${olm.olmId} in org ${orgId} (user ${userId})`
                    );
                }

                logger.debug(
                    `Client already exists for OLM ${olm.olmId} in org ${orgId} (user ${userId}), skipping creation`
                );
                continue;
            }

            // Get exit nodes for this org
            const exitNodesList = await getExitNodes(orgId);

            if (exitNodesList.length === 0) {
                logger.warn(
                    `Skipping org ${orgId} for OLM ${olm.olmId} (user ${userId}): no exit nodes found`
                );
                continue;
            }

            const randomExitNode =
                exitNodesList[Math.floor(Math.random() * exitNodesList.length)];

            // Get next available subnet
            const { value: newSubnet, release: releaseSubnetLock } =
                await getNextAvailableClientSubnet(orgId, trx);

            const subnet = newSubnet.split("/")[0];
            const updatedSubnet = `${subnet}/${org.subnet.split("/")[1]}`;

            const niceId = await getUniqueClientName(orgId);

            const isOrgLicensed = await getIsOrgLicensed(userOrg.orgId);
            const requireApproval =
                build !== "oss" &&
                isOrgLicensed &&
                orgRequiresDeviceApprovalRole.get(orgId) === true;

            const newClientData: InferInsertModel<typeof clients> = {
                userId,
                orgId: userOrg.orgId,
                exitNodeId: randomExitNode.exitNodeId,
                name: olm.name || "User Client",
                subnet: updatedSubnet,
                olmId: olm.olmId,
                type: "olm",
                niceId,
                approvalState: requireApproval ? "pending" : null
            };

            // Create the client
            const [newClient] = await trx
                .insert(clients)
                .values(newClientData)
                .returning();
            await releaseSubnetLock();
            existingClientCache.set(getOrgOlmKey(orgId, olm.olmId), newClient);

            // create approval request
            if (requireApproval) {
                await trx
                    .insert(approvals)
                    .values({
                        timestamp: Math.floor(new Date().getTime() / 1000),
                        orgId: userOrg.orgId,
                        clientId: newClient.clientId,
                        userId,
                        type: "user_device"
                    })
                    .returning();
            }

            queuedAssociationRebuilds.push(newClient);

            // Grant admin role access to the client
            await trx.insert(roleClients).values({
                roleId: adminRole.roleId,
                clientId: newClient.clientId
            });
            roleClientAccessCache.set(
                getRoleClientKey(adminRole.roleId, newClient.clientId),
                true
            );

            // Grant user access to the client
            await trx.insert(userClients).values({
                userId,
                clientId: newClient.clientId
            });
            userClientAccessCache.set(
                getUserClientKey(userId, newClient.clientId),
                true
            );

            logger.debug(
                `Created client for OLM ${olm.olmId} in org ${orgId} (user ${userId}) with access granted to admin role and user`
            );
        }
    }

    // Clean up clients in orgs the user is no longer in
    await cleanupOrphanedClients(
        userId,
        trx,
        userOrgIds,
        queuedAssociationRebuilds
    );

    runQueuedClientAssociationRebuilds(userId, queuedAssociationRebuilds);
}

async function cleanupOrphanedClients(
    userId: string,
    trx: Transaction | typeof db,
    userOrgIds: string[] = [],
    queuedAssociationRebuilds: ClientRow[] = []
): Promise<void> {
    // Find all OLM clients for this user that should be deleted
    // If userOrgIds is empty, delete all OLM clients (user has no orgs)
    // If userOrgIds has values, delete clients in orgs they're not in
    const clientsToDelete = await trx
        .select({ clientId: clients.clientId })
        .from(clients)
        .where(
            userOrgIds.length > 0
                ? and(
                      eq(clients.userId, userId),
                      notInArray(clients.orgId, userOrgIds)
                  )
                : and(eq(clients.userId, userId))
        );

    if (clientsToDelete.length > 0) {
        const deletedClients = await trx
            .delete(clients)
            .where(
                userOrgIds.length > 0
                    ? and(
                          eq(clients.userId, userId),
                          notInArray(clients.orgId, userOrgIds)
                      )
                    : and(eq(clients.userId, userId))
            )
            .returning();

        // Queue deleted clients for post-trx association cleanup.
        for (const deletedClient of deletedClients) {
            queuedAssociationRebuilds.push(deletedClient);

            if (deletedClient.olmId) {
                await sendTerminateClient(
                    deletedClient.clientId,
                    OlmErrorCodes.TERMINATED_DELETED,
                    deletedClient.olmId
                );
            }
        }

        if (userOrgIds.length === 0) {
            logger.debug(
                `Deleted all ${clientsToDelete.length} OLM client(s) for user ${userId} (user has no orgs)`
            );
        } else {
            logger.debug(
                `Deleted ${clientsToDelete.length} orphaned OLM client(s) for user ${userId} in orgs they're no longer in`
            );
        }
    }
}
