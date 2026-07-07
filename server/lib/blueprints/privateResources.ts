import {
    clients,
    clientSiteResources,
    domains,
    orgDomains,
    roleActions,
    roles,
    roleSiteResources,
    Site,
    SiteResource,
    siteNetworks,
    siteResources,
    Transaction,
    userOrgs,
    users,
    userSiteResources,
    networks
} from "@server/db";
import { sites } from "@server/db";
import { eq, and, ne, inArray, or, isNotNull } from "drizzle-orm";
import { Config } from "./types";
import logger from "@server/logger";
import { defaultRoleAllowedActions } from "@server/routers/role/createRole";
import { getNextAvailableAliasAddress } from "../ip";
import { createCertificate } from "#dynamic/routers/certificates/createCertificate";
import { isLicensedOrSubscribed } from "#dynamic/lib/isLicencedOrSubscribed";
import { tierMatrix } from "../billing/tierMatrix";
import { build } from "@server/build";
import HttpCode from "@server/types/HttpCode";
import createHttpError from "http-errors";
import next from "next";
import { LimitId } from "../billing";
import { usageService } from "../billing/usageService";

async function getDomainForSiteResource(
    siteResourceId: number | undefined,
    fullDomain: string,
    orgId: string,
    trx: Transaction
): Promise<{ subdomain: string | null; domainId: string }> {
    const [fullDomainExists] = await trx
        .select({ siteResourceId: siteResources.siteResourceId })
        .from(siteResources)
        .where(
            and(
                eq(siteResources.fullDomain, fullDomain),
                eq(siteResources.orgId, orgId),
                siteResourceId
                    ? ne(siteResources.siteResourceId, siteResourceId)
                    : isNotNull(siteResources.siteResourceId)
            )
        )
        .limit(1);

    if (fullDomainExists) {
        throw new Error(
            `Site resource already exists with domain: ${fullDomain} in org ${orgId}`
        );
    }

    const possibleDomains = await trx
        .select()
        .from(domains)
        .innerJoin(orgDomains, eq(domains.domainId, orgDomains.domainId))
        .where(and(eq(orgDomains.orgId, orgId), eq(domains.verified, true)))
        .execute();

    if (possibleDomains.length === 0) {
        throw new Error(
            `Domain not found for full-domain: ${fullDomain} in org ${orgId}`
        );
    }

    const validDomains = possibleDomains.filter((domain) => {
        if (domain.domains.type == "ns" || domain.domains.type == "wildcard") {
            return (
                fullDomain === domain.domains.baseDomain ||
                fullDomain.endsWith(`.${domain.domains.baseDomain}`)
            );
        } else if (domain.domains.type == "cname") {
            return fullDomain === domain.domains.baseDomain;
        }
    });

    if (validDomains.length === 0) {
        throw new Error(
            `Domain not found for full-domain: ${fullDomain} in org ${orgId}`
        );
    }

    const domainSelection = validDomains[0].domains;
    const baseDomain = domainSelection.baseDomain;

    let subdomain: string | null = null;
    if (fullDomain !== baseDomain) {
        subdomain = fullDomain.replace(`.${baseDomain}`, "");
    }

    await createCertificate(domainSelection.domainId, fullDomain, trx);

    return {
        subdomain,
        domainId: domainSelection.domainId
    };
}

export type ClientResourcesResults = {
    newSiteResource: SiteResource;
    oldSiteResource?: SiteResource;
    newSites: { siteId: number }[];
    oldSites: { siteId: number }[];
}[];

export async function updatePrivateResources(
    orgId: string,
    config: Config,
    trx: Transaction,
    siteId?: number
): Promise<ClientResourcesResults> {
    const results: ClientResourcesResults = [];

    for (const [resourceNiceId, resourceData] of Object.entries(
        config["client-resources"]
    )) {
        if (resourceData.mode === "http") {
            const hasHttpFeature = await isLicensedOrSubscribed(
                orgId,
                tierMatrix.advancedPrivateResources
            );
            if (!hasHttpFeature) {
                throw new Error(
                    "HTTP private resources are not included in your current plan. Please upgrade."
                );
            }
        }

        if (resourceData.mode === "ssh") {
            const hasSshFeature = await isLicensedOrSubscribed(
                orgId,
                tierMatrix.advancedPrivateResources
            );
            if (!hasSshFeature) {
                throw new Error(
                    "SSH private resources are not included in your current plan. Please upgrade."
                );
            }
        }

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

        const existingSiteIds = existingResource?.networkId
            ? await trx
                  .select({ siteId: siteNetworks.siteId })
                  .from(siteNetworks)
                  .where(eq(siteNetworks.networkId, existingResource.networkId))
            : [];

        const allSites: { siteId: number }[] = [];

        if (resourceData.site) {
            // Look up site by niceId
            const [siteSingle] = await trx
                .select({ siteId: sites.siteId })
                .from(sites)
                .where(
                    and(
                        eq(sites.niceId, resourceData.site),
                        eq(sites.orgId, orgId)
                    )
                )
                .limit(1);
            if (siteSingle) {
                allSites.push(siteSingle);
            }
        }

        if (resourceData.sites) {
            for (const siteNiceId of resourceData.sites) {
                const [site] = await trx
                    .select({ siteId: sites.siteId })
                    .from(sites)
                    .where(
                        and(
                            eq(sites.niceId, siteNiceId),
                            eq(sites.orgId, orgId)
                        )
                    )
                    .limit(1);
                if (site) {
                    allSites.push(site);
                }
            }
        }

        if (siteId && allSites.length === 0) {
            // only add if there are not provided sites
            // Use the provided siteId directly, but verify it belongs to the org
            const [siteSingle] = await trx
                .select({ siteId: sites.siteId })
                .from(sites)
                .where(and(eq(sites.siteId, siteId), eq(sites.orgId, orgId)))
                .limit(1);
            if (siteSingle) {
                allSites.push(siteSingle);
            }
        }

        if (allSites.length === 0) {
            throw new Error(
                `No valid sites found for private private resource ${resourceNiceId} in org ${orgId}`
            );
        }

        if (existingResource) {
            let domainInfo:
                | { subdomain: string | null; domainId: string }
                | undefined;
            if (resourceData["full-domain"] && resourceData.mode === "http") {
                domainInfo = await getDomainForSiteResource(
                    existingResource.siteResourceId,
                    resourceData["full-domain"],
                    orgId,
                    trx
                );
            }

            // Update existing resource
            const [updatedResource] = await trx
                .update(siteResources)
                .set({
                    name: resourceData.name || resourceNiceId,
                    mode: resourceData.mode,
                    ssl: resourceData.ssl,
                    scheme: resourceData.scheme,
                    destination: resourceData.destination,
                    destinationPort: resourceData["destination-port"],
                    enabled: true, // hardcoded for now
                    // enabled: resourceData.enabled ?? true,
                    alias: resourceData.alias || null,
                    disableIcmp:
                        resourceData["disable-icmp"] ||
                        (resourceData.mode == "http" ? true : false), // default to true for http resources, otherwise false
                    tcpPortRangeString:
                        resourceData.mode == "http"
                            ? "443,80"
                            : resourceData["tcp-ports"],
                    udpPortRangeString:
                        resourceData.mode == "http"
                            ? ""
                            : resourceData["udp-ports"],
                    fullDomain: resourceData["full-domain"] || null,
                    subdomain: domainInfo ? domainInfo.subdomain : null,
                    domainId: domainInfo ? domainInfo.domainId : null,
                    pamMode: resourceData["auth-daemon"]?.pam || "passthrough",
                    authDaemonMode:
                        resourceData["auth-daemon"]?.mode || "native",
                    authDaemonPort: resourceData["auth-daemon"]?.port || 22123
                })
                .where(
                    eq(
                        siteResources.siteResourceId,
                        existingResource.siteResourceId
                    )
                )
                .returning();

            const siteResourceId = existingResource.siteResourceId;

            if (updatedResource.networkId) {
                await trx
                    .delete(siteNetworks)
                    .where(
                        eq(siteNetworks.networkId, updatedResource.networkId)
                    );

                for (const site of allSites) {
                    await trx.insert(siteNetworks).values({
                        siteId: site.siteId,
                        networkId: updatedResource.networkId
                    });
                }
            }

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
                            or(
                                inArray(users.username, resourceData.users),
                                inArray(users.email, resourceData.users)
                            ),
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
                const existingRoles = await trx
                    .select()
                    .from(roles)
                    .where(
                        and(
                            eq(roles.orgId, orgId),
                            inArray(roles.name, resourceData.roles)
                        )
                    );

                const foundNames = new Set(existingRoles.map((r) => r.name));
                const missingNames = resourceData.roles.filter(
                    (n) => !foundNames.has(n)
                );

                for (const name of missingNames) {
                    const [created] = await trx
                        .insert(roles)
                        .values({ name, orgId })
                        .returning();
                    await trx.insert(roleActions).values(
                        defaultRoleAllowedActions.map((action) => ({
                            roleId: created.roleId,
                            actionId: action,
                            orgId
                        }))
                    );
                    existingRoles.push(created);
                    logger.info(
                        `Auto-created role "${name}" in org ${orgId} from blueprint`
                    );
                }

                const roleIds = existingRoles.map((role) => role.roleId);

                await trx
                    .insert(roleSiteResources)
                    .values(
                        roleIds.map((roleId) => ({ roleId, siteResourceId }))
                    );
            }

            results.push({
                newSiteResource: updatedResource,
                oldSiteResource: existingResource,
                newSites: allSites,
                oldSites: existingSiteIds
            });
        } else {
            // create a brand new resource

            if (build == "saas") {
                const usage = await usageService.getUsage(
                    orgId,
                    LimitId.PRIVATE_RESOURCES
                );
                if (!usage) {
                    throw new Error(
                        `Usage data not found for org ${orgId} and limit ${LimitId.PRIVATE_RESOURCES}`
                    );
                }
                const rejectResource = await usageService.checkLimitSet(
                    orgId,

                    LimitId.PRIVATE_RESOURCES,
                    {
                        ...usage,
                        instantaneousValue: (usage.instantaneousValue || 0) + 1
                    } // We need to add one to know if we are violating the limit
                );
                if (rejectResource) {
                    throw new Error(
                        "Private resource limit exceeded. Please upgrade your plan."
                    );
                }
            }

            let aliasAddress: string | null = null;
            let releaseAliasLock: (() => Promise<void>) | null = null;
            if (
                resourceData.mode === "host" ||
                resourceData.mode === "http" ||
                resourceData.mode === "ssh"
            ) {
                const { value, release } = await getNextAvailableAliasAddress(
                    orgId,
                    trx
                );
                aliasAddress = value;
                releaseAliasLock = release;
            }

            let domainInfo:
                | { subdomain: string | null; domainId: string }
                | undefined;
            if (resourceData["full-domain"] && resourceData.mode === "http") {
                domainInfo = await getDomainForSiteResource(
                    undefined,
                    resourceData["full-domain"],
                    orgId,
                    trx
                );
            }

            const [network] = await trx
                .insert(networks)
                .values({
                    scope: "resource",
                    orgId: orgId
                })
                .returning();

            // Create new resource
            const [newResource] = await trx
                .insert(siteResources)
                .values({
                    orgId: orgId,
                    niceId: resourceNiceId,
                    networkId: network.networkId,
                    defaultNetworkId: network.networkId,
                    name: resourceData.name || resourceNiceId,
                    mode: resourceData.mode,
                    ssl: resourceData.ssl,
                    scheme: resourceData.scheme,
                    destination: resourceData.destination,
                    destinationPort: resourceData["destination-port"],
                    enabled: true, // hardcoded for now
                    // enabled: resourceData.enabled ?? true,
                    alias: resourceData.alias || null,
                    aliasAddress: aliasAddress,
                    disableIcmp:
                        resourceData["disable-icmp"] ||
                        (resourceData.mode == "http" ? true : false), // default to true for http resources, otherwise false
                    tcpPortRangeString:
                        resourceData.mode == "http"
                            ? "443,80"
                            : resourceData["tcp-ports"],
                    udpPortRangeString:
                        resourceData.mode == "http"
                            ? ""
                            : resourceData["udp-ports"],
                    fullDomain: resourceData["full-domain"] || null,
                    subdomain: domainInfo ? domainInfo.subdomain : null,
                    domainId: domainInfo ? domainInfo.domainId : null,
                    pamMode: resourceData["auth-daemon"]?.pam || "passthrough",
                    authDaemonMode:
                        resourceData["auth-daemon"]?.mode || "native",
                    authDaemonPort: resourceData["auth-daemon"]?.port || 22123
                })
                .returning();

            await releaseAliasLock?.();

            const siteResourceId = newResource.siteResourceId;

            for (const site of allSites) {
                await trx.insert(siteNetworks).values({
                    siteId: site.siteId,
                    networkId: network.networkId
                });
            }

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
                const existingRoles = await trx
                    .select()
                    .from(roles)
                    .where(
                        and(
                            eq(roles.orgId, orgId),
                            inArray(roles.name, resourceData.roles)
                        )
                    );

                const foundNames = new Set(existingRoles.map((r) => r.name));
                const missingNames = resourceData.roles.filter(
                    (n) => !foundNames.has(n)
                );

                for (const name of missingNames) {
                    const [created] = await trx
                        .insert(roles)
                        .values({ name, orgId })
                        .returning();
                    await trx.insert(roleActions).values(
                        defaultRoleAllowedActions.map((action) => ({
                            roleId: created.roleId,
                            actionId: action,
                            orgId
                        }))
                    );
                    existingRoles.push(created);
                    logger.info(
                        `Auto-created role "${name}" in org ${orgId} from blueprint`
                    );
                }

                const roleIds = existingRoles.map((role) => role.roleId);

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
                            or(
                                inArray(users.username, resourceData.users),
                                inArray(users.email, resourceData.users)
                            ),
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

            await usageService.add(orgId, LimitId.PRIVATE_RESOURCES, 1, trx);

            results.push({
                newSiteResource: newResource,
                newSites: allSites,
                oldSites: existingSiteIds
            });
        }
    }

    return results;
}
