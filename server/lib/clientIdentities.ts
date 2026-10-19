import {
    clientOrgRoles,
    clients,
    clientSiteResourcesAssociationsCache,
    db,
    newts,
    roles,
    siteNetworks,
    siteResources,
    Transaction,
    userOrgRoles,
    users
} from "@server/db";
import { and, eq, inArray } from "drizzle-orm";
import { sendToClientsBatch } from "#dynamic/routers/ws";
import {
    canCompress,
    supportsClientIdentities
} from "@server/lib/clientVersionChecks";
import logger from "@server/logger";

// Keeps IN (...) lists well under the bound-parameter limits of both
// Postgres and SQLite when an org has thousands of clients.
const ID_CHUNK_SIZE = 1000;

function chunk<T>(items: T[]): T[][] {
    const chunks: T[][] = [];
    for (let i = 0; i < items.length; i += ID_CHUNK_SIZE) {
        chunks.push(items.slice(i, i + ID_CHUNK_SIZE));
    }
    return chunks;
}

/**
 * Identity of a client as seen by newt's HTTP proxy, which turns it into the
 * same Remote-* headers that Badger sets for public resources. Keyed by the
 * client's tunnel IP since that is the source address newt sees on requests.
 * User clients carry the owning user's details; machine clients (no user)
 * carry the client's name and its machine roles.
 */
export type ClientIdentity = {
    ip: string;
    userId?: string;
    username?: string;
    email?: string;
    name?: string;
    role?: string;
};

/**
 * Builds the identity for each of the given clients, keyed by clientId.
 * Clients without a subnet are omitted since newt could never match them.
 */
export async function getClientIdentities(
    clientIds: Iterable<number>,
    trx: Transaction | typeof db = db
): Promise<Map<number, ClientIdentity>> {
    const identities = new Map<number, ClientIdentity>();
    const uniqueClientIds = Array.from(new Set(clientIds));
    if (uniqueClientIds.length === 0) {
        return identities;
    }

    const clientRows = (
        await Promise.all(
            chunk(uniqueClientIds).map((ids) =>
                trx
                    .select({
                        clientId: clients.clientId,
                        orgId: clients.orgId,
                        subnet: clients.subnet,
                        clientName: clients.name,
                        userId: users.userId,
                        username: users.username,
                        email: users.email,
                        userName: users.name
                    })
                    .from(clients)
                    .leftJoin(users, eq(clients.userId, users.userId))
                    .where(inArray(clients.clientId, ids))
            )
        )
    ).flat();

    // Roles only matter in the client's own org, so restrict the role
    // lookups to those orgs rather than every org the users belong to.
    const orgIds = Array.from(new Set(clientRows.map((c) => c.orgId)));
    const userIds = Array.from(
        new Set(
            clientRows
                .map((c) => c.userId)
                .filter((id): id is string => id !== null)
        )
    );
    const machineClientIds = clientRows
        .filter((c) => c.userId === null)
        .map((c) => c.clientId);

    const [userRoleRows, clientRoleRows] = await Promise.all([
        Promise.all(
            chunk(userIds).map((ids) =>
                trx
                    .select({
                        userId: userOrgRoles.userId,
                        orgId: userOrgRoles.orgId,
                        roleName: roles.name
                    })
                    .from(userOrgRoles)
                    .innerJoin(roles, eq(userOrgRoles.roleId, roles.roleId))
                    .where(
                        and(
                            inArray(userOrgRoles.userId, ids),
                            inArray(userOrgRoles.orgId, orgIds)
                        )
                    )
            )
        ).then((rows) => rows.flat()),
        Promise.all(
            chunk(machineClientIds).map((ids) =>
                trx
                    .select({
                        clientId: clientOrgRoles.clientId,
                        orgId: clientOrgRoles.orgId,
                        roleName: roles.name
                    })
                    .from(clientOrgRoles)
                    .innerJoin(roles, eq(clientOrgRoles.roleId, roles.roleId))
                    .where(inArray(clientOrgRoles.clientId, ids))
            )
        ).then((rows) => rows.flat())
    ]);

    const rolesByUserOrg = new Map<string, string[]>();
    for (const row of userRoleRows) {
        const key = `${row.userId}:${row.orgId}`;
        const list = rolesByUserOrg.get(key) ?? [];
        list.push(row.roleName);
        rolesByUserOrg.set(key, list);
    }
    const rolesByClientOrg = new Map<string, string[]>();
    for (const row of clientRoleRows) {
        const key = `${row.clientId}:${row.orgId}`;
        const list = rolesByClientOrg.get(key) ?? [];
        list.push(row.roleName);
        rolesByClientOrg.set(key, list);
    }

    for (const row of clientRows) {
        if (!row.subnet) {
            continue;
        }
        const ip = row.subnet.split("/")[0];

        if (row.userId) {
            const roleNames = rolesByUserOrg.get(`${row.userId}:${row.orgId}`);
            identities.set(row.clientId, {
                ip,
                userId: row.userId,
                username: row.username ?? undefined,
                email: row.email ?? undefined,
                name: row.userName ?? undefined,
                role: roleNames?.length ? roleNames.join(", ") : undefined
            });
        } else {
            const roleNames = rolesByClientOrg.get(
                `${row.clientId}:${row.orgId}`
            );
            identities.set(row.clientId, {
                ip,
                name: row.clientName,
                role: roleNames?.length ? roleNames.join(", ") : undefined
            });
        }
    }

    return identities;
}

/**
 * Upserts the identities of the given clients on each newt, outside of a full
 * newt/sync or newt/wg/receive-config. Send this before (or alongside) any
 * HTTP subnet proxy targets that reference the clients so that the first
 * proxied request already carries the Remote-* headers.
 */
export async function sendClientIdentitiesAdd(
    entries: {
        newtId: string;
        version?: string | null;
        clientIds: number[];
    }[],
    trx: Transaction | typeof db = db
) {
    const supported = entries.filter(
        (e) => e.clientIds.length > 0 && supportsClientIdentities(e.version)
    );
    if (supported.length === 0) {
        return;
    }

    // Fetched once for all newts; the same clients usually span many sites.
    const identities = await getClientIdentities(
        supported.flatMap((e) => e.clientIds),
        trx
    );

    const messages = supported
        .map((entry) => ({
            entry,
            data: Array.from(new Set(entry.clientIds))
                .map((id) => identities.get(id))
                .filter((i): i is ClientIdentity => i !== undefined)
        }))
        .filter(({ data }) => data.length > 0)
        .map(({ entry, data }) => ({
            clientId: entry.newtId,
            message: {
                type: "newt/wg/client-identities/add",
                data
            },
            options: {
                incrementConfigVersion: true,
                compress: canCompress(entry.version, "newt")
            }
        }));

    if (messages.length === 0) {
        return;
    }

    await sendToClientsBatch(messages).catch((error) => {
        logger.warn(`Error sending client identities to newts:`, error);
    });
}

/**
 * Re-pushes the identities of the given clients to the newt of every site
 * where they can reach an enabled HTTP resource, e.g. after the owning user's
 * name, email or roles change. Sites where a client only has non-HTTP access
 * never see its traffic in the HTTP proxy, so they are skipped. Relies on
 * clientSiteResourcesAssociationsCache being current.
 */
export async function pushClientIdentitiesToSites(
    clientIds: number[],
    trx: Transaction | typeof db = db
) {
    const uniqueClientIds = Array.from(new Set(clientIds));
    if (uniqueClientIds.length === 0) {
        return;
    }

    const rows = (
        await Promise.all(
            chunk(uniqueClientIds).map((ids) =>
                trx
                    .selectDistinct({
                        clientId: clientSiteResourcesAssociationsCache.clientId,
                        newtId: newts.newtId,
                        version: newts.version
                    })
                    .from(clientSiteResourcesAssociationsCache)
                    .innerJoin(
                        siteResources,
                        eq(
                            siteResources.siteResourceId,
                            clientSiteResourcesAssociationsCache.siteResourceId
                        )
                    )
                    .innerJoin(
                        siteNetworks,
                        eq(siteNetworks.networkId, siteResources.networkId)
                    )
                    .innerJoin(newts, eq(newts.siteId, siteNetworks.siteId))
                    .where(
                        and(
                            inArray(
                                clientSiteResourcesAssociationsCache.clientId,
                                ids
                            ),
                            eq(siteResources.mode, "http"),
                            eq(siteResources.enabled, true)
                        )
                    )
            )
        )
    ).flat();

    const byNewt = new Map<
        string,
        { newtId: string; version: string | null; clientIds: number[] }
    >();
    for (const row of rows) {
        let entry = byNewt.get(row.newtId);
        if (!entry) {
            entry = { newtId: row.newtId, version: row.version, clientIds: [] };
            byNewt.set(row.newtId, entry);
        }
        entry.clientIds.push(row.clientId);
    }

    await sendClientIdentitiesAdd(Array.from(byNewt.values()), trx);
}

/**
 * Re-pushes the identities of every client owned by the user, e.g. after an
 * IdP login updates their name or email.
 */
export async function pushClientIdentitiesForUser(
    userId: string,
    trx: Transaction | typeof db = db
) {
    const userClients = await trx
        .select({ clientId: clients.clientId })
        .from(clients)
        .where(eq(clients.userId, userId));

    await pushClientIdentitiesToSites(
        userClients.map((c) => c.clientId),
        trx
    );
}

/**
 * Re-pushes the identities of every client holding the role, either through
 * the owning user or directly as a machine client, e.g. after a role rename.
 */
export async function pushClientIdentitiesForRole(
    roleId: number,
    orgId: string,
    trx: Transaction | typeof db = db
) {
    const [userClients, machineClients] = await Promise.all([
        // Driven from the org's clients so the join can use userOrgRoles'
        // (userId, orgId, roleId) unique index; userOrgRoles has no index on
        // roleId alone.
        trx
            .select({ clientId: clients.clientId })
            .from(clients)
            .innerJoin(
                userOrgRoles,
                and(
                    eq(userOrgRoles.userId, clients.userId),
                    eq(userOrgRoles.orgId, clients.orgId),
                    eq(userOrgRoles.roleId, roleId)
                )
            )
            .where(eq(clients.orgId, orgId)),
        trx
            .select({ clientId: clientOrgRoles.clientId })
            .from(clientOrgRoles)
            .where(eq(clientOrgRoles.roleId, roleId))
    ]);

    await pushClientIdentitiesToSites(
        [...userClients, ...machineClients].map((c) => c.clientId),
        trx
    );
}
