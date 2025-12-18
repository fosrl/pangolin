import {
    clients,
    clientSiteResources,
    roles,
    roleSiteResources,
    SiteResource,
    siteResources,
    Transaction,
    userOrgs,
    users,
    userSiteResources
} from "@server/db";
import { sites } from "@server/db";
import { eq, and, ne, inArray } from "drizzle-orm";
import { Config } from "./types";
import logger from "@server/logger";
import { getNextAvailableAliasAddress } from "../ip";

export type ClientResourcesResults = {
    newSiteResource: SiteResource;
    oldSiteResource?: SiteResource;
}[];

export async function updateClientResources(
    orgId: string,
    config: Config,
    trx: Transaction,
    siteId?: number
): Promise<ClientResourcesResults> {
    const results: ClientResourcesResults = [];

    for (const [resourceNiceId, resourceData] of Object.entries(
        config["client-resources"]
    )) {
        const [existingResource] = await trx
            .select()
            .from(siteResources)
            .where(
                and(
                    eq(siteResources.orgId, orgId),
                    eq(siteResources.niceId, resourceNiceId)
                )
            )
            .limit(1);

        const resourceSiteId = resourceData.site;
        let site;

        if (resourceSiteId) {
            // Look up site by niceId
            [site] = await trx
                .select({ siteId: sites.siteId })
                .from(sites)
                .where(
                    and(
                        eq(sites.niceId, resourceSiteId),
                        eq(sites.orgId, orgId)
                    )
                )
                .limit(1);
        } else if (siteId) {
            // Use the provided siteId directly, but verify it belongs to the org
            [site] = await trx
                .select({ siteId: sites.siteId })
                .from(sites)
                .where(and(eq(sites.siteId, siteId), eq(sites.orgId, orgId)))
                .limit(1);
        } else {
            throw new Error(`Target site is required`);
        }

        if (!site) {
            throw new Error(
                `Site not found: ${resourceSiteId} in org ${orgId}`
            );
        }

        if (existingResource) {
            // Update existing resource
            const [updatedResource] = await trx
                .update(siteResources)
                .set({
                    name: resourceData.name || resourceNiceId,
                    siteId: site.siteId,
                    mode: resourceData.mode,
                    destination: resourceData.destination,
                    enabled: true, // hardcoded for now
                    // enabled: resourceData.enabled ?? true,
                    alias: resourceData.alias || null,
                    disableIcmp: resourceData["disable-icmp"],
                    tcpPortRangeString: resourceData["tcp-ports"],
                    udpPortRangeString: resourceData["udp-ports"]
                })
                .where(
                    eq(
                        siteResources.siteResourceId,
                        existingResource.siteResourceId
                    )
                )
                .returning();

            const siteResourceId = existingResource.siteResourceId;
            const orgId = existingResource.orgId;

            await trx
                .delete(clientSiteResources)
                .where(eq(clientSiteResources.siteResourceId, siteResourceId));

            if (resourceData.machines.length > 0) {
                // get clientIds from niceIds
                const clientsToUpdate = await trx
                    .select()
                    .from(clients)
                    .where(
                        and(
                            inArray(clients.niceId, resourceData.machines),
                            eq(clients.orgId, orgId)
                        )
                    );

                const clientIds = clientsToUpdate.map(
                    (client) => client.clientId
                );

                await trx.insert(clientSiteResources).values(
                    clientIds.map((clientId) => ({
                        clientId,
                        siteResourceId
                    }))
                );
            }

            await trx
                .delete(userSiteResources)
                .where(eq(userSiteResources.siteResourceId, siteResourceId));

            if (resourceData.users.length > 0) {
                // get userIds from username
                const usersToUpdate = await trx
                    .select()
                    .from(users)
                    .innerJoin(userOrgs, eq(users.userId, userOrgs.userId))
                    .where(
                        and(
                            inArray(users.username, resourceData.users),
                            eq(userOrgs.orgId, orgId)
                        )
                    );

                const userIds = usersToUpdate.map((user) => user.user.userId);

                await trx
                    .insert(userSiteResources)
                    .values(
                        userIds.map((userId) => ({ userId, siteResourceId }))
                    );
            }

            // Get all admin role IDs for this org to exclude from deletion
            const adminRoles = await trx
                .select()
                .from(roles)
                .where(and(eq(roles.isAdmin, true), eq(roles.orgId, orgId)));
            const adminRoleIds = adminRoles.map((role) => role.roleId);

            if (adminRoleIds.length > 0) {
                await trx.delete(roleSiteResources).where(
                    and(
                        eq(roleSiteResources.siteResourceId, siteResourceId),
                        ne(roleSiteResources.roleId, adminRoleIds[0]) // delete all but the admin role
                    )
                );
            } else {
                await trx
                    .delete(roleSiteResources)
                    .where(
                        eq(roleSiteResources.siteResourceId, siteResourceId)
                    );
            }

            if (resourceData.roles.length > 0) {
                // Re-add specified roles but we need to get the roleIds from the role name in the array
                const rolesToUpdate = await trx
                    .select()
                    .from(roles)
                    .where(
                        and(
                            eq(roles.orgId, orgId),
                            inArray(roles.name, resourceData.roles)
                        )
                    );

                const roleIds = rolesToUpdate.map((role) => role.roleId);

                await trx
                    .insert(roleSiteResources)
                    .values(
                        roleIds.map((roleId) => ({ roleId, siteResourceId }))
                    );
            }

            results.push({
                newSiteResource: updatedResource,
                oldSiteResource: existingResource
            });
        } else {
            let aliasAddress: string | null = null;
            if (resourceData.mode == "host") {
                // we can only have an alias on a host
                aliasAddress = await getNextAvailableAliasAddress(orgId);
            }

            // Create new resource
            const [newResource] = await trx
                .insert(siteResources)
                .values({
                    orgId: orgId,
                    siteId: site.siteId,
                    niceId: resourceNiceId,
                    name: resourceData.name || resourceNiceId,
                    mode: resourceData.mode,
                    destination: resourceData.destination,
                    enabled: true, // hardcoded for now
                    // enabled: resourceData.enabled ?? true,
                    alias: resourceData.alias || null,
                    aliasAddress: aliasAddress,
                    disableIcmp: resourceData["disable-icmp"],
                    tcpPortRangeString: resourceData["tcp-ports"],
                    udpPortRangeString: resourceData["udp-ports"]
                })
                .returning();

            const siteResourceId = newResource.siteResourceId;

            const [adminRole] = await trx
                .select()
                .from(roles)
                .where(and(eq(roles.isAdmin, true), eq(roles.orgId, orgId)))
                .limit(1);

            if (!adminRole) {
                throw new Error(`Admin role not found for org ${orgId}`);
            }

            await trx.insert(roleSiteResources).values({
                roleId: adminRole.roleId,
                siteResourceId: siteResourceId
            });

            if (resourceData.roles.length > 0) {
                // get roleIds from role names
                const rolesToUpdate = await trx
                    .select()
                    .from(roles)
                    .where(
                        and(
                            eq(roles.orgId, orgId),
                            inArray(roles.name, resourceData.roles)
                        )
                    );

                const roleIds = rolesToUpdate.map((role) => role.roleId);

                await trx
                    .insert(roleSiteResources)
                    .values(
                        roleIds.map((roleId) => ({ roleId, siteResourceId }))
                    );
            }

            if (resourceData.users.length > 0) {
                // get userIds from username
                const usersToUpdate = await trx
                    .select()
                    .from(users)
                    .innerJoin(userOrgs, eq(users.userId, userOrgs.userId))
                    .where(
                        and(
                            inArray(users.username, resourceData.users),
                            eq(userOrgs.orgId, orgId)
                        )
                    );

                const userIds = usersToUpdate.map((user) => user.user.userId);

                await trx
                    .insert(userSiteResources)
                    .values(
                        userIds.map((userId) => ({ userId, siteResourceId }))
                    );
            }

            if (resourceData.machines.length > 0) {
                // get clientIds from niceIds
                const clientsToUpdate = await trx
                    .select()
                    .from(clients)
                    .where(
                        and(
                            inArray(clients.niceId, resourceData.machines),
                            eq(clients.orgId, orgId)
                        )
                    );

                const clientIds = clientsToUpdate.map(
                    (client) => client.clientId
                );

                await trx.insert(clientSiteResources).values(
                    clientIds.map((clientId) => ({
                        clientId,
                        siteResourceId
                    }))
                );
            }

            logger.info(
                `Created new client resource ${newResource.name} (${newResource.siteResourceId}) for org ${orgId}`
            );

            results.push({ newSiteResource: newResource });
        }
    }

    return results;
}
