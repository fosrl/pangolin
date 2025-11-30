import {
    domains,
    orgDomains,
    Resource,
    resourceHeaderAuth,
    resourcePincode,
    resourceRules,
    resourceWhitelist,
    roleResources,
    roles,
    Target,
    TargetHealthCheck,
    targetHealthCheck,
    Transaction,
    userOrgs,
    userResources,
    users
} from "@server/db";
import { resources, targets, sites } from "@server/db";
import { eq, and, asc, or, ne, count, isNotNull } from "drizzle-orm";
import {
    Config,
    ConfigSchema,
    isTargetsOnlyResource,
    TargetData
} from "./types";
import logger from "@server/logger";
import { createCertificate } from "#dynamic/routers/certificates/createCertificate";
import { pickPort } from "@server/routers/target/helpers";
import { resourcePassword } from "@server/db";
import { hashPassword } from "@server/auth/password";
import { isValidCIDR, isValidIP, isValidUrlGlobPattern } from "../validators";
import { get } from "http";

export type ProxyResourcesResults = {
    proxyResource: Resource;
    targetsToUpdate: Target[];
    healthchecksToUpdate: TargetHealthCheck[];
}[];

export async function updateProxyResources(
    orgId: string,
    config: Config,
    trx: Transaction,
    siteId?: number
): Promise<ProxyResourcesResults> {
    const results: ProxyResourcesResults = [];

    for (const [resourceNiceId, resourceData] of Object.entries(
        config["proxy-resources"]
    )) {
        const targetsToUpdate: Target[] = [];
        const healthchecksToUpdate: TargetHealthCheck[] = [];
        let resource: Resource;

        async function createTarget( // reusable function to create a target
            resourceId: number,
            targetData: TargetData
        ) {
            const targetSiteId = targetData.site;
            let site;

            if (targetSiteId) {
                // Look up site by niceId
                [site] = await trx
                    .select({ siteId: sites.siteId })
                    .from(sites)
                    .where(
                        and(
                            eq(sites.niceId, targetSiteId),
                            eq(sites.orgId, orgId)
                        )
                    )
                    .limit(1);
            } else if (siteId) {
                // Use the provided siteId directly, but verify it belongs to the org
                [site] = await trx
                    .select({ siteId: sites.siteId })
                    .from(sites)
                    .where(
                        and(eq(sites.siteId, siteId), eq(sites.orgId, orgId))
                    )
                    .limit(1);
            } else {
                throw new Error(`Target site is required`);
            }

            if (!site) {
                throw new Error(
                    `Site not found: ${targetSiteId} in org ${orgId}`
                );
            }

            let internalPortToCreate;
            if (!targetData["internal-port"]) {
                const { internalPort, targetIps } = await pickPort(
                    site.siteId!,
                    trx
                );
                internalPortToCreate = internalPort;
            } else {
                internalPortToCreate = targetData["internal-port"];
            }

            // Create target
            const [newTarget] = await trx
                .insert(targets)
                .values({
                    resourceId: resourceId,
                    siteId: site.siteId,
                    ip: targetData.hostname,
                    method: targetData.method,
                    port: targetData.port,
                    enabled: targetData.enabled,
                    internalPort: internalPortToCreate,
                    path: targetData.path,
                    pathMatchType: targetData["path-match"],
                    rewritePath:
                        targetData.rewritePath ||
                        targetData["rewrite-path"] ||
                        (targetData["rewrite-match"] === "stripPrefix"
                            ? "/"
                            : undefined),
                    rewritePathType: targetData["rewrite-match"],
                    priority: targetData.priority
                })
                .returning();

            targetsToUpdate.push(newTarget);

            const healthcheckData = targetData.healthcheck;

            const hcHeaders = healthcheckData?.headers
                ? JSON.stringify(healthcheckData.headers)
                : null;

            const [newHealthcheck] = await trx
                .insert(targetHealthCheck)
                .values({
                    targetId: newTarget.targetId,
                    hcEnabled: healthcheckData?.enabled || false,
                    hcPath: healthcheckData?.path,
                    hcScheme: healthcheckData?.scheme,
                    hcMode: healthcheckData?.mode,
                    hcHostname: healthcheckData?.hostname,
                    hcPort: healthcheckData?.port,
                    hcInterval: healthcheckData?.interval,
                    hcUnhealthyInterval:
                        healthcheckData?.unhealthyInterval ||
                        healthcheckData?.["unhealthy-interval"],
                    hcTimeout: healthcheckData?.timeout,
                    hcHeaders: hcHeaders,
                    hcFollowRedirects:
                        healthcheckData?.followRedirects ||
                        healthcheckData?.["follow-redirects"],
                    hcMethod: healthcheckData?.method,
                    hcStatus: healthcheckData?.status,
                    hcHealth: "unknown"
                })
                .returning();

            healthchecksToUpdate.push(newHealthcheck);
        }

        // Find existing resource by niceId and orgId
        const [existingResource] = await trx
            .select()
            .from(resources)
            .where(
                and(
                    eq(resources.niceId, resourceNiceId),
                    eq(resources.orgId, orgId)
                )
            )
            .limit(1);

        const http = resourceData.protocol == "http";
        const protocol =
            resourceData.protocol == "http" ? "tcp" : resourceData.protocol;
        const resourceEnabled =
            resourceData.enabled == undefined || resourceData.enabled == null
                ? true
                : resourceData.enabled;
        const resourceSsl =
            resourceData.ssl == undefined || resourceData.ssl == null
                ? true
                : resourceData.ssl;
        let headers = "";
        if (resourceData.headers) {
            headers = JSON.stringify(resourceData.headers);
        }

        if (existingResource) {
            let domain;
            if (http) {
                domain = await getDomain(
                    existingResource.resourceId,
                    resourceData["full-domain"]!,
                    orgId,
                    trx
                );
            }

            // check if the only key in the resource is targets, if so, skip the update
            if (isTargetsOnlyResource(resourceData)) {
                logger.debug(
                    `Skipping update for resource ${existingResource.resourceId} as only targets are provided`
                );
                resource = existingResource;
            } else {
                // Update existing resource
                [resource] = await trx
                    .update(resources)
                    .set({
                        name: resourceData.name || "Unnamed Resource",
                        protocol: protocol || "tcp",
                        http: http,
                        proxyPort: http ? null : resourceData["proxy-port"],
                        fullDomain: http ? resourceData["full-domain"] : null,
                        subdomain: domain ? domain.subdomain : null,
                        domainId: domain ? domain.domainId : null,
                        enabled: resourceEnabled,
                        sso: resourceData.auth?.["sso-enabled"] || false,
                        skipToIdpId: resourceData.auth?.["auto-login-idp"] || null,
                        ssl: resourceSsl,
                        setHostHeader: resourceData["host-header"] || null,
                        tlsServerName: resourceData["tls-server-name"] || null,
                        emailWhitelistEnabled: resourceData.auth?.[
                            "whitelist-users"
                        ]
                            ? resourceData.auth["whitelist-users"].length > 0
                            : false,
                        headers: headers || null,
                        applyRules:
                            resourceData.rules && resourceData.rules.length > 0
                    })
                    .where(
                        eq(resources.resourceId, existingResource.resourceId)
                    )
                    .returning();

                await trx
                    .delete(resourcePassword)
                    .where(
                        eq(
                            resourcePassword.resourceId,
                            existingResource.resourceId
                        )
                    );
                if (resourceData.auth?.password) {
                    const passwordHash = await hashPassword(
                        resourceData.auth.password
                    );

                    await trx.insert(resourcePassword).values({
                        resourceId: existingResource.resourceId,
                        passwordHash
                    });
                }

                await trx
                    .delete(resourcePincode)
                    .where(
                        eq(
                            resourcePincode.resourceId,
                            existingResource.resourceId
                        )
                    );
                if (resourceData.auth?.pincode) {
                    const pincodeHash = await hashPassword(
                        resourceData.auth.pincode.toString()
                    );

                    await trx.insert(resourcePincode).values({
                        resourceId: existingResource.resourceId,
                        pincodeHash,
                        digitLength: 6
                    });
                }

                await trx
                    .delete(resourceHeaderAuth)
                    .where(
                        eq(
                            resourceHeaderAuth.resourceId,
                            existingResource.resourceId
                        )
                    );
                if (resourceData.auth?.["basic-auth"]) {
                    const headerAuthUser =
                        resourceData.auth?.["basic-auth"]?.user;
                    const headerAuthPassword =
                        resourceData.auth?.["basic-auth"]?.password;
                    if (headerAuthUser && headerAuthPassword) {
                        const headerAuthHash = await hashPassword(
                            Buffer.from(
                                `${headerAuthUser}:${headerAuthPassword}`
                            ).toString("base64")
                        );
                        await trx.insert(resourceHeaderAuth).values({
                            resourceId: existingResource.resourceId,
                            headerAuthHash
                        });
                    }
                }

                if (resourceData.auth?.["sso-roles"]) {
                    const ssoRoles = resourceData.auth?.["sso-roles"];
                    await syncRoleResources(
                        existingResource.resourceId,
                        ssoRoles,
                        orgId,
                        trx
                    );
                }

                if (resourceData.auth?.["sso-users"]) {
                    const ssoUsers = resourceData.auth?.["sso-users"];
                    await syncUserResources(
                        existingResource.resourceId,
                        ssoUsers,
                        orgId,
                        trx
                    );
                }

                if (resourceData.auth?.["whitelist-users"]) {
                    const whitelistUsers =
                        resourceData.auth?.["whitelist-users"];
                    await syncWhitelistUsers(
                        existingResource.resourceId,
                        whitelistUsers,
                        orgId,
                        trx
                    );
                }
            }

            const existingResourceTargets = await trx
                .select()
                .from(targets)
                .where(eq(targets.resourceId, existingResource.resourceId))
                .orderBy(asc(targets.targetId));

            // Create new targets
            for (const [index, targetData] of resourceData.targets.entries()) {
                if (
                    !targetData ||
                    (typeof targetData === "object" &&
                        Object.keys(targetData).length === 0)
                ) {
                    // If targetData is null or an empty object, we can skip it
                    continue;
                }
                const existingTarget = existingResourceTargets[index];

                if (existingTarget) {
                    const targetSiteId = targetData.site;
                    let site;

                    if (targetSiteId) {
                        // Look up site by niceId
                        [site] = await trx
                            .select({ siteId: sites.siteId })
                            .from(sites)
                            .where(
                                and(
                                    eq(sites.niceId, targetSiteId),
                                    eq(sites.orgId, orgId)
                                )
                            )
                            .limit(1);
                    } else if (siteId) {
                        // Use the provided siteId directly, but verify it belongs to the org
                        [site] = await trx
                            .select({ siteId: sites.siteId })
                            .from(sites)
                            .where(
                                and(
                                    eq(sites.siteId, siteId),
                                    eq(sites.orgId, orgId)
                                )
                            )
                            .limit(1);
                    } else {
                        throw new Error(`Target site is required`);
                    }

                    if (!site) {
                        throw new Error(
                            `Site not found: ${targetSiteId} in org ${orgId}`
                        );
                    }

                    // update this target
                    const [updatedTarget] = await trx
                        .update(targets)
                        .set({
                            siteId: site.siteId,
                            ip: targetData.hostname,
                            method: http ? targetData.method : null,
                            port: targetData.port,
                            enabled: targetData.enabled,
                            path: targetData.path,
                            pathMatchType: targetData["path-match"],
                            rewritePath:
                                targetData.rewritePath ||
                                targetData["rewrite-path"] ||
                                (targetData["rewrite-match"] === "stripPrefix"
                                    ? "/"
                                    : undefined),
                            rewritePathType: targetData["rewrite-match"],
                            priority: targetData.priority
                        })
                        .where(eq(targets.targetId, existingTarget.targetId))
                        .returning();

                    if (checkIfTargetChanged(existingTarget, updatedTarget)) {
                        let internalPortToUpdate;
                        if (!targetData["internal-port"]) {
                            const { internalPort, targetIps } = await pickPort(
                                site.siteId!,
                                trx
                            );
                            internalPortToUpdate = internalPort;
                        } else {
                            internalPortToUpdate = targetData["internal-port"];
                        }

                        const [finalUpdatedTarget] = await trx // this double is so we can check the whole target before and after
                            .update(targets)
                            .set({
                                internalPort: internalPortToUpdate
                            })
                            .where(
                                eq(targets.targetId, existingTarget.targetId)
                            )
                            .returning();

                        targetsToUpdate.push(finalUpdatedTarget);
                    }

                    const healthcheckData = targetData.healthcheck;

                    const [oldHealthcheck] = await trx
                        .select()
                        .from(targetHealthCheck)
                        .where(
                            eq(
                                targetHealthCheck.targetId,
                                existingTarget.targetId
                            )
                        )
                        .limit(1);

                    const hcHeaders = healthcheckData?.headers
                        ? JSON.stringify(healthcheckData.headers)
                        : null;

                    const [newHealthcheck] = await trx
                        .update(targetHealthCheck)
                        .set({
                            hcEnabled: healthcheckData?.enabled || false,
                            hcPath: healthcheckData?.path,
                            hcScheme: healthcheckData?.scheme,
                            hcMode: healthcheckData?.mode,
                            hcHostname: healthcheckData?.hostname,
                            hcPort: healthcheckData?.port,
                            hcInterval: healthcheckData?.interval,
                            hcUnhealthyInterval:
                                healthcheckData?.unhealthyInterval ||
                                healthcheckData?.["unhealthy-interval"],
                            hcTimeout: healthcheckData?.timeout,
                            hcHeaders: hcHeaders,
                            hcFollowRedirects:
                                healthcheckData?.followRedirects ||
                                healthcheckData?.["follow-redirects"],
                            hcMethod: healthcheckData?.method,
                            hcStatus: healthcheckData?.status
                        })
                        .where(
                            eq(
                                targetHealthCheck.targetId,
                                existingTarget.targetId
                            )
                        )
                        .returning();

                    if (
                        checkIfHealthcheckChanged(
                            oldHealthcheck,
                            newHealthcheck
                        )
                    ) {
                        healthchecksToUpdate.push(newHealthcheck);
                        // if the target is not already in the targetsToUpdate array, add it
                        if (
                            !targetsToUpdate.find(
                                (t) => t.targetId === updatedTarget.targetId
                            )
                        ) {
                            targetsToUpdate.push(updatedTarget);
                        }
                    }
                } else {
                    await createTarget(existingResource.resourceId, targetData);
                }
            }

            if (existingResourceTargets.length > resourceData.targets.length) {
                const targetsToDelete = existingResourceTargets.slice(
                    resourceData.targets.length
                );
                logger.debug(
                    `Targets to delete: ${JSON.stringify(targetsToDelete)}`
                );
                for (const target of targetsToDelete) {
                    if (!target) {
                        continue;
                    }
                    if (siteId && target.siteId !== siteId) {
                        logger.debug(
                            `Skipping target ${target.targetId} for deletion. Site ID does not match filter.`
                        );
                        continue; // only delete targets for the specified siteId
                    }
                    logger.debug(`Deleting target ${target.targetId}`);
                    await trx
                        .delete(targets)
                        .where(eq(targets.targetId, target.targetId));
                }
            }

            const existingRules = await trx
                .select()
                .from(resourceRules)
                .where(
                    eq(resourceRules.resourceId, existingResource.resourceId)
                )
                .orderBy(resourceRules.priority);

            // Sync rules
            for (const [index, rule] of resourceData.rules?.entries() || []) {
                const existingRule = existingRules[index];
                if (existingRule) {
                    if (
                        existingRule.action !== getRuleAction(rule.action) ||
                        existingRule.match !== rule.match.toUpperCase() ||
                        existingRule.value !== getRuleValue(rule.match.toUpperCase(), rule.value)
                    ) {
                        validateRule(rule);
                        await trx
                            .update(resourceRules)
                            .set({
                                action: getRuleAction(rule.action),
                                match: rule.match.toUpperCase(),
                                value: getRuleValue(rule.match.toUpperCase(), rule.value),
                            })
                            .where(
                                eq(resourceRules.ruleId, existingRule.ruleId)
                            );
                    }
                } else {
                    validateRule(rule);
                    await trx.insert(resourceRules).values({
                        resourceId: existingResource.resourceId,
                        action: getRuleAction(rule.action),
                        match: rule.match.toUpperCase(),
                        value: getRuleValue(rule.match.toUpperCase(), rule.value),
                        priority: index + 1 // start priorities at 1
                    });
                }
            }

            if (existingRules.length > (resourceData.rules?.length || 0)) {
                const rulesToDelete = existingRules.slice(
                    resourceData.rules?.length || 0
                );
                for (const rule of rulesToDelete) {
                    await trx
                        .delete(resourceRules)
                        .where(eq(resourceRules.ruleId, rule.ruleId));
                }
            }

            logger.debug(`Updated resource ${existingResource.resourceId}`);
        } else {
            // create a brand new resource
            let domain;
            if (http) {
                domain = await getDomain(
                    undefined,
                    resourceData["full-domain"]!,
                    orgId,
                    trx
                );
            }

            // Create new resource
            const [newResource] = await trx
                .insert(resources)
                .values({
                    orgId,
                    niceId: resourceNiceId,
                    name: resourceData.name || "Unnamed Resource",
                    protocol: protocol || "tcp",
                    http: http,
                    proxyPort: http ? null : resourceData["proxy-port"],
                    fullDomain: http ? resourceData["full-domain"] : null,
                    subdomain: domain ? domain.subdomain : null,
                    domainId: domain ? domain.domainId : null,
                    enabled: resourceEnabled,
                    sso: resourceData.auth?.["sso-enabled"] || false,
                    skipToIdpId: resourceData.auth?.["auto-login-idp"] || null,
                    setHostHeader: resourceData["host-header"] || null,
                    tlsServerName: resourceData["tls-server-name"] || null,
                    ssl: resourceSsl,
                    headers: headers || null,
                    applyRules:
                        resourceData.rules && resourceData.rules.length > 0
                })
                .returning();

            if (resourceData.auth?.password) {
                const passwordHash = await hashPassword(
                    resourceData.auth.password
                );

                await trx.insert(resourcePassword).values({
                    resourceId: newResource.resourceId,
                    passwordHash
                });
            }

            if (resourceData.auth?.pincode) {
                const pincodeHash = await hashPassword(
                    resourceData.auth.pincode.toString()
                );

                await trx.insert(resourcePincode).values({
                    resourceId: newResource.resourceId,
                    pincodeHash,
                    digitLength: 6
                });
            }

            if (resourceData.auth?.["basic-auth"]) {
                const headerAuthUser = resourceData.auth?.["basic-auth"]?.user;
                const headerAuthPassword =
                    resourceData.auth?.["basic-auth"]?.password;

                if (headerAuthUser && headerAuthPassword) {
                    const headerAuthHash = await hashPassword(
                        Buffer.from(
                            `${headerAuthUser}:${headerAuthPassword}`
                        ).toString("base64")
                    );

                    await trx.insert(resourceHeaderAuth).values({
                        resourceId: newResource.resourceId,
                        headerAuthHash
                    });
                }
            }

            resource = newResource;

            const [adminRole] = await trx
                .select()
                .from(roles)
                .where(and(eq(roles.isAdmin, true), eq(roles.orgId, orgId)))
                .limit(1);

            if (!adminRole) {
                throw new Error(`Admin role not found`);
            }

            await trx.insert(roleResources).values({
                roleId: adminRole.roleId,
                resourceId: newResource.resourceId
            });

            if (resourceData.auth?.["sso-roles"]) {
                const ssoRoles = resourceData.auth?.["sso-roles"];
                await syncRoleResources(
                    newResource.resourceId,
                    ssoRoles,
                    orgId,
                    trx
                );
            }

            if (resourceData.auth?.["sso-users"]) {
                const ssoUsers = resourceData.auth?.["sso-users"];
                await syncUserResources(
                    newResource.resourceId,
                    ssoUsers,
                    orgId,
                    trx
                );
            }

            if (resourceData.auth?.["whitelist-users"]) {
                const whitelistUsers = resourceData.auth?.["whitelist-users"];
                await syncWhitelistUsers(
                    newResource.resourceId,
                    whitelistUsers,
                    orgId,
                    trx
                );
            }

            // Create new targets
            for (const targetData of resourceData.targets) {
                if (!targetData) {
                    // If targetData is null or an empty object, we can skip it
                    continue;
                }
                await createTarget(newResource.resourceId, targetData);
            }

            for (const [index, rule] of resourceData.rules?.entries() || []) {
                validateRule(rule);
                await trx.insert(resourceRules).values({
                    resourceId: newResource.resourceId,
                    action: getRuleAction(rule.action),
                    match: rule.match.toUpperCase(),
                    value: getRuleValue(rule.match.toUpperCase(), rule.value),
                    priority: index + 1 // start priorities at 1
                });
            }

            logger.debug(`Created resource ${newResource.resourceId}`);
        }

        results.push({
            proxyResource: resource,
            targetsToUpdate,
            healthchecksToUpdate
        });
    }

    return results;
}

function getRuleAction(input: string) {
    let action = "DROP";
    if (input == "allow") {
        action = "ACCEPT";
    } else if (input == "deny") {
        action = "DROP";
    } else if (input == "pass") {
        action = "PASS";
    }
    return action;
}

function getRuleValue(match: string, value: string) {
    // if the match is a country, uppercase the value
    if (match == "COUNTRY") {
        return value.toUpperCase();
    }
    return value;
}

function validateRule(rule: any) {
    if (rule.match === "cidr") {
        if (!isValidCIDR(rule.value)) {
            throw new Error(`Invalid CIDR provided: ${rule.value}`);
        }
    } else if (rule.match === "ip") {
        if (!isValidIP(rule.value)) {
            throw new Error(`Invalid IP provided: ${rule.value}`);
        }
    } else if (rule.match === "path") {
        if (!isValidUrlGlobPattern(rule.value)) {
            throw new Error(`Invalid URL glob pattern: ${rule.value}`);
        }
    }
}

async function syncRoleResources(
    resourceId: number,
    ssoRoles: string[],
    orgId: string,
    trx: Transaction
) {
    const existingRoleResources = await trx
        .select()
        .from(roleResources)
        .where(eq(roleResources.resourceId, resourceId));

    for (const roleName of ssoRoles) {
        if (roleName === "Admin") {
            continue; // never add admin access
        }

        const [role] = await trx
            .select()
            .from(roles)
            .where(and(eq(roles.name, roleName), eq(roles.orgId, orgId)))
            .limit(1);

        if (!role) {
            throw new Error(`Role not found: ${roleName} in org ${orgId}`);
        }

        const existingRoleResource = existingRoleResources.find(
            (rr) => rr.roleId === role.roleId
        );

        if (!existingRoleResource) {
            await trx.insert(roleResources).values({
                roleId: role.roleId,
                resourceId: resourceId
            });
        }
    }

    for (const existingRoleResource of existingRoleResources) {
        const [role] = await trx
            .select()
            .from(roles)
            .where(eq(roles.roleId, existingRoleResource.roleId))
            .limit(1);

        if (role.isAdmin) {
            continue; // never remove admin access
        }

        if (role && !ssoRoles.includes(role.name)) {
            await trx
                .delete(roleResources)
                .where(
                    and(
                        eq(roleResources.roleId, existingRoleResource.roleId),
                        eq(roleResources.resourceId, resourceId)
                    )
                );
        }
    }
}

async function syncUserResources(
    resourceId: number,
    ssoUsers: string[],
    orgId: string,
    trx: Transaction
) {
    const existingUserResources = await trx
        .select()
        .from(userResources)
        .where(eq(userResources.resourceId, resourceId));

    for (const email of ssoUsers) {
        const [user] = await trx
            .select()
            .from(users)
            .innerJoin(userOrgs, eq(users.userId, userOrgs.userId))
            .where(and(eq(users.email, email), eq(userOrgs.orgId, orgId)))
            .limit(1);

        if (!user) {
            throw new Error(`User not found: ${email} in org ${orgId}`);
        }

        const existingUserResource = existingUserResources.find(
            (rr) => rr.userId === user.user.userId
        );

        if (!existingUserResource) {
            await trx.insert(userResources).values({
                userId: user.user.userId,
                resourceId: resourceId
            });
        }
    }

    for (const existingUserResource of existingUserResources) {
        const [user] = await trx
            .select()
            .from(users)
            .innerJoin(userOrgs, eq(users.userId, userOrgs.userId))
            .where(
                and(
                    eq(users.userId, existingUserResource.userId),
                    eq(userOrgs.orgId, orgId)
                )
            )
            .limit(1);

        if (user && user.user.email && !ssoUsers.includes(user.user.email)) {
            await trx
                .delete(userResources)
                .where(
                    and(
                        eq(userResources.userId, existingUserResource.userId),
                        eq(userResources.resourceId, resourceId)
                    )
                );
        }
    }
}

async function syncWhitelistUsers(
    resourceId: number,
    whitelistUsers: string[],
    orgId: string,
    trx: Transaction
) {
    const existingWhitelist = await trx
        .select()
        .from(resourceWhitelist)
        .where(eq(resourceWhitelist.resourceId, resourceId));

    for (const email of whitelistUsers) {
        const [user] = await trx
            .select()
            .from(users)
            .innerJoin(userOrgs, eq(users.userId, userOrgs.userId))
            .where(and(eq(users.email, email), eq(userOrgs.orgId, orgId)))
            .limit(1);

        if (!user) {
            throw new Error(`User not found: ${email} in org ${orgId}`);
        }

        const existingWhitelistEntry = existingWhitelist.find(
            (w) => w.email === email
        );

        if (!existingWhitelistEntry) {
            await trx.insert(resourceWhitelist).values({
                email,
                resourceId: resourceId
            });
        }
    }

    for (const existingWhitelistEntry of existingWhitelist) {
        if (!whitelistUsers.includes(existingWhitelistEntry.email)) {
            await trx
                .delete(resourceWhitelist)
                .where(
                    and(
                        eq(resourceWhitelist.resourceId, resourceId),
                        eq(
                            resourceWhitelist.email,
                            existingWhitelistEntry.email
                        )
                    )
                );
        }
    }
}

function checkIfHealthcheckChanged(
    existing: TargetHealthCheck | undefined,
    incoming: TargetHealthCheck | undefined
) {
    if (!existing && incoming) return true;
    if (existing && !incoming) return true;
    if (!existing || !incoming) return false;

    if (existing.hcEnabled !== incoming.hcEnabled) return true;
    if (existing.hcPath !== incoming.hcPath) return true;
    if (existing.hcScheme !== incoming.hcScheme) return true;
    if (existing.hcMode !== incoming.hcMode) return true;
    if (existing.hcHostname !== incoming.hcHostname) return true;
    if (existing.hcPort !== incoming.hcPort) return true;
    if (existing.hcInterval !== incoming.hcInterval) return true;
    if (existing.hcUnhealthyInterval !== incoming.hcUnhealthyInterval)
        return true;
    if (existing.hcTimeout !== incoming.hcTimeout) return true;
    if (existing.hcFollowRedirects !== incoming.hcFollowRedirects) return true;
    if (existing.hcMethod !== incoming.hcMethod) return true;
    if (existing.hcStatus !== incoming.hcStatus) return true;
    if (
        JSON.stringify(existing.hcHeaders) !==
        JSON.stringify(incoming.hcHeaders)
    )
        return true;

    return false;
}

function checkIfTargetChanged(
    existing: Target | undefined,
    incoming: Target | undefined
): boolean {
    if (!existing && incoming) return true;
    if (existing && !incoming) return true;
    if (!existing || !incoming) return false;

    if (existing.ip !== incoming.ip) return true;
    if (existing.port !== incoming.port) return true;
    if (existing.siteId !== incoming.siteId) return true;

    return false;
}

async function getDomain(
    resourceId: number | undefined,
    fullDomain: string,
    orgId: string,
    trx: Transaction
) {
    const [fullDomainExists] = await trx
        .select({ resourceId: resources.resourceId })
        .from(resources)
        .where(
            and(
                eq(resources.fullDomain, fullDomain),
                eq(resources.orgId, orgId),
                resourceId
                    ? ne(resources.resourceId, resourceId)
                    : isNotNull(resources.resourceId)
            )
        )
        .limit(1);

    if (fullDomainExists) {
        throw new Error(
            `Resource already exists: ${fullDomain} in org ${orgId}`
        );
    }

    const domain = await getDomainId(orgId, fullDomain, trx);

    if (!domain) {
        throw new Error(
            `Domain not found for full-domain: ${fullDomain} in org ${orgId}`
        );
    }

    await createCertificate(domain.domainId, fullDomain, trx);

    return domain;
}

async function getDomainId(
    orgId: string,
    fullDomain: string,
    trx: Transaction
): Promise<{ subdomain: string | null; domainId: string } | null> {
    const possibleDomains = await trx
        .select()
        .from(domains)
        .innerJoin(orgDomains, eq(domains.domainId, orgDomains.domainId))
        .where(and(eq(orgDomains.orgId, orgId), eq(domains.verified, true)))
        .execute();

    if (possibleDomains.length === 0) {
        return null;
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
        return null;
    }

    const domainSelection = validDomains[0].domains;
    const baseDomain = domainSelection.baseDomain;

    // remove the base domain of the domain
    let subdomain = null;
    if (domainSelection.type == "ns") {
        if (fullDomain != baseDomain) {
            subdomain = fullDomain.replace(`.${baseDomain}`, "");
        }
    }

    // Return the first valid domain
    return {
        subdomain: subdomain,
        domainId: domainSelection.domainId
    };
}
