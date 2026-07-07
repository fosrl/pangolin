import {
    domains,
    domainNamespaces,
    orgDomains,
    Resource,
    resourceHeaderAuth,
    resourceHeaderAuthExtendedCompatibility,
    resourcePincode,
    resourceRules,
    resourceWhitelist,
    roleActions,
    roleResources,
    roles,
    Target,
    TargetHealthCheck,
    targetHealthCheck,
    Transaction,
    userOrgs,
    userResources,
    users,
    resourcePolicies,
    resourcePolicyPassword,
    resourcePolicyPincode,
    resourcePolicyHeaderAuth,
    resourcePolicyRules,
    resourcePolicyWhiteList,
    rolePolicies,
    userPolicies
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
import { getUniqueResourcePolicyName } from "@server/db/names";
import { hashPassword } from "@server/auth/password";
import { isValidCIDR, isValidIP, isValidUrlGlobPattern } from "../validators";
import { isValidRegionId } from "@server/db/regions";
import { isLicensedOrSubscribed } from "#dynamic/lib/isLicencedOrSubscribed";
import { fireHealthCheckUnknownAlert } from "@server/lib/alerts";
import { tierMatrix } from "../billing/tierMatrix";
import { defaultRoleAllowedActions } from "@server/routers/role/createRole";
import { build } from "@server/build";
import { encrypt } from "@server/lib/crypto";
import { generateId } from "@server/auth/sessions/app";
import serverConfig from "@server/lib/config";
import HttpCode from "@server/types/HttpCode";
import createHttpError from "http-errors";
import next from "next";
import { LimitId } from "../billing";
import { usageService } from "../billing/usageService";

export type PublicResourcesResults = {
    proxyResource: Resource;
    targetsToUpdate: Target[];
    healthchecksToUpdate: TargetHealthCheck[];
}[];

export async function updatePublicResources(
    orgId: string,
    config: Config,
    trx: Transaction,
    siteId?: number
): Promise<PublicResourcesResults> {
    const results: PublicResourcesResults = [];

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
                    .select({ siteId: sites.siteId, type: sites.type })
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
                    .select({ siteId: sites.siteId, type: sites.type })
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

            let authToken: string | undefined;
            if (site.type !== "local") {
                const plainToken = generateId(48);
                authToken = encrypt(
                    plainToken,
                    serverConfig.getRawConfig().server.secret!
                );
            }

            // Create target
            const [newTarget] = await trx
                .insert(targets)
                .values({
                    resourceId: resourceId,
                    siteId: site.siteId,
                    ip: targetData.hostname,
                    mode: resourceData.mode as Target["mode"],
                    method: targetData.method,
                    port: targetData.port,
                    enabled: targetData.enabled,
                    internalPort: internalPortToCreate,
                    authToken: authToken,
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
                    name: `${targetData.hostname}:${targetData.port}`,
                    siteId: site.siteId,
                    targetId: newTarget.targetId,
                    orgId: orgId,
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
                    hcHealth: "unknown",
                    hcHealthyThreshold: healthcheckData?.["healthy-threshold"],
                    hcUnhealthyThreshold:
                        healthcheckData?.["unhealthy-threshold"]
                })
                .returning();

            healthchecksToUpdate.push(newHealthcheck);

            // Insert unknown status history when HC is created in disabled state
            if (!healthcheckData?.enabled) {
                await fireHealthCheckUnknownAlert(
                    orgId,
                    newHealthcheck.targetHealthCheckId,
                    newHealthcheck.name,
                    newHealthcheck.targetId,
                    undefined,
                    true,
                    trx
                );
            }
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

        if (["ssh", "rdp", "vnc"].includes(resourceData.mode || "")) {
            const isLicensed = await isLicensedOrSubscribed(
                orgId,
                tierMatrix.advancedPublicResources
            );
            if (!isLicensed) {
                throw new Error(
                    "Your current subscription does not support browser gateway resources. Please upgrade to access this feature."
                );
            }
        }

        if (resourceData.policy) {
            const isLicensed = await isLicensedOrSubscribed(
                orgId,
                tierMatrix.resourcePolicies
            );
            if (!isLicensed) {
                throw new Error(
                    "Your current subscription does not support shared resource policies. Please upgrade to access this feature."
                );
            }
        }

        if (existingResource) {
            let domain;
            if (
                ["http", "ssh", "rdp", "vnc"].includes(resourceData.mode || "")
            ) {
                if (resourceData["full-domain"]?.startsWith("*.")) {
                    const isLicensed = await isLicensedOrSubscribed(
                        orgId,
                        tierMatrix.wildcardSubdomain
                    );
                    if (!isLicensed) {
                        throw new Error(
                            "Wildcard subdomains are not supported on your current plan. Please upgrade to access this feature."
                        );
                    }
                }

                domain = await getDomain(
                    existingResource.resourceId,
                    resourceData["full-domain"]!,
                    orgId,
                    trx
                );

                await enforceDomainNamespacePaywall(
                    orgId,
                    domain.domainId,
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

                const isLicensed = await isLicensedOrSubscribed(
                    orgId,
                    tierMatrix.maintencePage
                );
                if (!isLicensed) {
                    resourceData.maintenance = undefined;
                }

                // Look up the admin role (needed for inline policy creation)
                const [adminRole] = await trx
                    .select()
                    .from(roles)
                    .where(and(eq(roles.isAdmin, true), eq(roles.orgId, orgId)))
                    .limit(1);

                if (!adminRole) {
                    throw new Error(`Admin role not found`);
                }

                if (resourceData.policy) {
                    // SHARED POLICY MODE: look up shared policy by niceId
                    const [sharedPolicy] = await trx
                        .select()
                        .from(resourcePolicies)
                        .where(
                            and(
                                eq(
                                    resourcePolicies.niceId,
                                    resourceData.policy
                                ),
                                eq(resourcePolicies.orgId, orgId)
                            )
                        )
                        .limit(1);

                    if (!sharedPolicy) {
                        throw new Error(
                            `Shared policy not found: ${resourceData.policy} in org ${orgId}`
                        );
                    }

                    [resource] = await trx
                        .update(resources)
                        .set({
                            name: resourceData.name || "Unnamed Resource",

                            mode: resourceData.mode,
                            proxyPort: ["http", "ssh", "rdp", "vnc"].includes(
                                resourceData.mode || ""
                            )
                                ? null
                                : resourceData["proxy-port"],
                            fullDomain: ["http", "ssh", "rdp", "vnc"].includes(
                                resourceData.mode || ""
                            )
                                ? resourceData["full-domain"]
                                : null,
                            subdomain: domain ? domain.subdomain : null,
                            domainId: domain ? domain.domainId : null,
                            wildcard: domain ? domain.wildcard : false,
                            enabled: resourceEnabled,
                            sso: resourceData.auth?.["sso-enabled"] || false,
                            skipToIdpId:
                                resourceData.auth?.["auto-login-idp"] || null,
                            ssl: resourceSsl,
                            setHostHeader: resourceData["host-header"] || null,
                            tlsServerName:
                                resourceData["tls-server-name"] || null,
                            emailWhitelistEnabled: resourceData.auth?.[
                                "whitelist-users"
                            ]
                                ? resourceData.auth["whitelist-users"].length >
                                  0
                                : false,
                            headers: headers || null,
                            applyRules:
                                resourceData.rules &&
                                resourceData.rules.length > 0,
                            pamMode:
                                resourceData["auth-daemon"]?.pam ||
                                "passthrough",
                            authDaemonMode:
                                resourceData["auth-daemon"]?.mode || "native",
                            authDaemonPort:
                                resourceData["auth-daemon"]?.port || 22123,
                            maintenanceModeEnabled:
                                resourceData.maintenance?.enabled,
                            maintenanceModeType: resourceData.maintenance?.type,
                            maintenanceTitle: resourceData.maintenance?.title,
                            maintenanceMessage:
                                resourceData.maintenance?.message,
                            maintenanceEstimatedTime:
                                resourceData.maintenance?.["estimated-time"],
                            proxyProtocol:
                                resourceData.mode === "tcp"
                                    ? (resourceData["proxy-protocol"] ?? false)
                                    : false,
                            proxyProtocolVersion:
                                resourceData.mode === "tcp"
                                    ? (resourceData["proxy-protocol-version"] ??
                                      1)
                                    : 1,
                            resourcePolicyId: sharedPolicy.resourcePolicyId
                        })
                        .where(
                            eq(
                                resources.resourceId,
                                existingResource.resourceId
                            )
                        )
                        .returning();

                    // Update OLD resource-level auth tables
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
                    await trx
                        .delete(resourceHeaderAuthExtendedCompatibility)
                        .where(
                            eq(
                                resourceHeaderAuthExtendedCompatibility.resourceId,
                                existingResource.resourceId
                            )
                        );
                    if (resourceData.auth?.["basic-auth"]) {
                        const headerAuthUser =
                            resourceData.auth["basic-auth"]?.user;
                        const headerAuthPassword =
                            resourceData.auth["basic-auth"]?.password;
                        const headerAuthExtendedCompatibility =
                            resourceData.auth["basic-auth"]
                                ?.extendedCompatibility;
                        if (
                            headerAuthUser &&
                            headerAuthPassword &&
                            headerAuthExtendedCompatibility !== null
                        ) {
                            const headerAuthHash = await hashPassword(
                                Buffer.from(
                                    `${headerAuthUser}:${headerAuthPassword}`
                                ).toString("base64")
                            );
                            await Promise.all([
                                trx.insert(resourceHeaderAuth).values({
                                    resourceId: existingResource.resourceId,
                                    headerAuthHash
                                }),
                                trx
                                    .insert(
                                        resourceHeaderAuthExtendedCompatibility
                                    )
                                    .values({
                                        resourceId: existingResource.resourceId,
                                        extendedCompatibilityIsActivated:
                                            headerAuthExtendedCompatibility
                                    })
                            ]);
                        }
                    }

                    if (resourceData.auth?.["sso-roles"]) {
                        await syncRoleResources(
                            existingResource.resourceId,
                            resourceData.auth["sso-roles"],
                            orgId,
                            trx
                        );
                    }

                    if (resourceData.auth?.["sso-users"]) {
                        await syncUserResources(
                            existingResource.resourceId,
                            resourceData.auth["sso-users"],
                            orgId,
                            trx
                        );
                    }

                    if (resourceData.auth?.["whitelist-users"]) {
                        await syncWhitelistUsers(
                            existingResource.resourceId,
                            resourceData.auth["whitelist-users"],
                            orgId,
                            trx
                        );
                    }
                } else {
                    // INLINE POLICY MODE: ensure inline policy exists
                    const inlinePolicyId = await ensureInlinePolicy(
                        existingResource.defaultResourcePolicyId,
                        orgId,
                        resourceNiceId,
                        adminRole.roleId,
                        trx
                    );

                    [resource] = await trx
                        .update(resources)
                        .set({
                            name: resourceData.name || "Unnamed Resource",
                            proxyPort: ["http", "ssh", "rdp", "vnc"].includes(
                                resourceData.mode || ""
                            )
                                ? null
                                : resourceData["proxy-port"],
                            fullDomain: ["http", "ssh", "rdp", "vnc"].includes(
                                resourceData.mode || ""
                            )
                                ? resourceData["full-domain"]
                                : null,
                            subdomain: domain ? domain.subdomain : null,
                            domainId: domain ? domain.domainId : null,
                            wildcard: domain ? domain.wildcard : false,
                            enabled: resourceEnabled,
                            ssl: resourceSsl,
                            setHostHeader: resourceData["host-header"] || null,
                            tlsServerName:
                                resourceData["tls-server-name"] || null,
                            headers: headers || null,
                            maintenanceModeEnabled:
                                resourceData.maintenance?.enabled,
                            maintenanceModeType: resourceData.maintenance?.type,
                            maintenanceTitle: resourceData.maintenance?.title,
                            maintenanceMessage:
                                resourceData.maintenance?.message,
                            maintenanceEstimatedTime:
                                resourceData.maintenance?.["estimated-time"],
                            proxyProtocol:
                                resourceData.mode === "tcp"
                                    ? (resourceData["proxy-protocol"] ?? false)
                                    : false,
                            proxyProtocolVersion:
                                resourceData.mode === "tcp"
                                    ? (resourceData["proxy-protocol-version"] ??
                                      1)
                                    : 1,
                            pamMode:
                                resourceData["auth-daemon"]?.pam ||
                                "passthrough",
                            authDaemonMode:
                                resourceData["auth-daemon"]?.mode || "native",
                            authDaemonPort:
                                resourceData["auth-daemon"]?.port || 22123,
                            resourcePolicyId: null,
                            defaultResourcePolicyId: inlinePolicyId
                        })
                        .where(
                            eq(
                                resources.resourceId,
                                existingResource.resourceId
                            )
                        )
                        .returning();

                    // Clear the old resource-level auth tables (not used in inline policy mode)
                    await Promise.all([
                        trx
                            .delete(resourcePassword)
                            .where(
                                eq(
                                    resourcePassword.resourceId,
                                    existingResource.resourceId
                                )
                            ),
                        trx
                            .delete(resourcePincode)
                            .where(
                                eq(
                                    resourcePincode.resourceId,
                                    existingResource.resourceId
                                )
                            ),
                        trx
                            .delete(resourceHeaderAuth)
                            .where(
                                eq(
                                    resourceHeaderAuth.resourceId,
                                    existingResource.resourceId
                                )
                            ),
                        trx
                            .delete(resourceHeaderAuthExtendedCompatibility)
                            .where(
                                eq(
                                    resourceHeaderAuthExtendedCompatibility.resourceId,
                                    existingResource.resourceId
                                )
                            ),
                        trx
                            .delete(resourceWhitelist)
                            .where(
                                eq(
                                    resourceWhitelist.resourceId,
                                    existingResource.resourceId
                                )
                            )
                    ]);

                    // Update inline policy auth fields and policy-level tables
                    await syncInlinePolicyAuth(
                        inlinePolicyId,
                        orgId,
                        resourceData,
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
                            method:
                                resourceData.mode == "http" // the other types of ssh, rdp, and vnc use the browser gateway targets and not this one so this is okay
                                    ? targetData.method
                                    : null,
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
                            priority: targetData.priority,
                            mode: resourceData.mode
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
                            hcStatus: healthcheckData?.status,
                            hcHealthyThreshold:
                                healthcheckData?.["healthy-threshold"],
                            hcUnhealthyThreshold:
                                healthcheckData?.["unhealthy-threshold"]
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

                    // Insert unknown status history when HC is disabled
                    const isDisablingHc =
                        !healthcheckData?.enabled && oldHealthcheck?.hcEnabled;
                    if (isDisablingHc) {
                        await fireHealthCheckUnknownAlert(
                            orgId,
                            newHealthcheck.targetHealthCheckId,
                            newHealthcheck.name,
                            newHealthcheck.targetId,
                            undefined,
                            true,
                            trx
                        );
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

            if (resourceData.policy) {
                // SHARED POLICY MODE: sync rules into old resourceRules table
                const existingRules = await trx
                    .select()
                    .from(resourceRules)
                    .where(
                        eq(
                            resourceRules.resourceId,
                            existingResource.resourceId
                        )
                    )
                    .orderBy(resourceRules.priority);

                // Sync rules
                for (const [index, rule] of resourceData.rules?.entries() ||
                    []) {
                    const intendedPriority = rule.priority ?? index + 1;
                    const existingRule = existingRules[index];
                    if (existingRule) {
                        if (
                            existingRule.action !==
                                getRuleAction(rule.action) ||
                            existingRule.match !== rule.match.toUpperCase() ||
                            existingRule.value !==
                                getRuleValue(
                                    rule.match.toUpperCase(),
                                    rule.value
                                ) ||
                            existingRule.priority !== intendedPriority
                        ) {
                            validateRule(rule);
                            await trx
                                .update(resourceRules)
                                .set({
                                    action: getRuleAction(rule.action),
                                    match: rule.match.toUpperCase(),
                                    value: getRuleValue(
                                        rule.match.toUpperCase(),
                                        rule.value
                                    ),
                                    priority: intendedPriority
                                })
                                .where(
                                    eq(
                                        resourceRules.ruleId,
                                        existingRule.ruleId
                                    )
                                );
                        }
                    } else {
                        validateRule(rule);
                        await trx.insert(resourceRules).values({
                            resourceId: existingResource.resourceId,
                            action: getRuleAction(rule.action),
                            match: rule.match.toUpperCase(),
                            value: getRuleValue(
                                rule.match.toUpperCase(),
                                rule.value
                            ),
                            priority: intendedPriority
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
            } else {
                // INLINE POLICY MODE: sync rules into policy-level table
                let inlinePolicyId = resource!.defaultResourcePolicyId;

                // Targets-only updates skip the auth/policy update branch above,
                // so pre-1.19 resources can still have no inline policy linked.
                if (!inlinePolicyId) {
                    const [adminRole] = await trx
                        .select()
                        .from(roles)
                        .where(
                            and(eq(roles.isAdmin, true), eq(roles.orgId, orgId))
                        )
                        .limit(1);

                    if (!adminRole) {
                        throw new Error(`Admin role not found`);
                    }

                    inlinePolicyId = await ensureInlinePolicy(
                        existingResource.defaultResourcePolicyId,
                        orgId,
                        resourceNiceId,
                        adminRole.roleId,
                        trx
                    );

                    [resource] = await trx
                        .update(resources)
                        .set({
                            resourcePolicyId: null,
                            defaultResourcePolicyId: inlinePolicyId
                        })
                        .where(
                            eq(
                                resources.resourceId,
                                existingResource.resourceId
                            )
                        )
                        .returning();
                }

                // Clear the old resource-level rules table
                await trx
                    .delete(resourceRules)
                    .where(
                        eq(
                            resourceRules.resourceId,
                            existingResource.resourceId
                        )
                    );

                await syncInlinePolicyRules(
                    inlinePolicyId,
                    resourceData.rules || [],
                    trx
                );
            }

            logger.debug(`Updated resource ${existingResource.resourceId}`);
        } else {
            // create a brand new resource

            if (build == "saas") {
                const usage = await usageService.getUsage(
                    orgId,
                    LimitId.PUBLIC_RESOURCES
                );
                if (!usage) {
                    throw new Error(
                        `Usage data not found for org ${orgId} and limit ${LimitId.PUBLIC_RESOURCES}`
                    );
                }
                const rejectResource = await usageService.checkLimitSet(
                    orgId,

                    LimitId.PUBLIC_RESOURCES,
                    {
                        ...usage,
                        instantaneousValue: (usage.instantaneousValue || 0) + 1
                    } // We need to add one to know if we are violating the limit
                );
                if (rejectResource) {
                    throw new Error(
                        "Public resource limit exceeded. Please upgrade your plan."
                    );
                }
            }

            let domain;
            if (
                ["http", "ssh", "rdp", "vnc"].includes(resourceData.mode || "")
            ) {
                if (resourceData["full-domain"]?.startsWith("*.")) {
                    const isLicensed = await isLicensedOrSubscribed(
                        orgId,
                        tierMatrix.wildcardSubdomain
                    );
                    if (!isLicensed) {
                        throw new Error(
                            "Wildcard subdomains are not supported on your current plan. Please upgrade to access this feature."
                        );
                    }
                }

                domain = await getDomain(
                    undefined,
                    resourceData["full-domain"]!,
                    orgId,
                    trx
                );

                await enforceDomainNamespacePaywall(
                    orgId,
                    domain.domainId,
                    trx
                );
            }

            const isLicensed = await isLicensedOrSubscribed(
                orgId,
                tierMatrix.maintencePage
            );
            if (!isLicensed) {
                resourceData.maintenance = undefined;
            }

            // Look up admin role (needed for inline policy and roleResources)
            const [adminRole] = await trx
                .select()
                .from(roles)
                .where(and(eq(roles.isAdmin, true), eq(roles.orgId, orgId)))
                .limit(1);

            if (!adminRole) {
                throw new Error(`Admin role not found`);
            }

            // Always create an inline policy for the resource
            const policyNiceId = await getUniqueResourcePolicyName(orgId);
            const [inlinePolicy] = await trx
                .insert(resourcePolicies)
                .values({
                    niceId: policyNiceId,
                    orgId,
                    name: `default policy for ${resourceNiceId}`,
                    sso: true,
                    scope: "resource"
                })
                .returning();

            // Make the inline policy visible to the admin role
            await trx.insert(rolePolicies).values({
                roleId: adminRole.roleId,
                resourcePolicyId: inlinePolicy.resourcePolicyId
            });

            // Determine the active shared policy (if provided)
            let sharedPolicyId: number | null = null;
            if (resourceData.policy) {
                const [sharedPolicy] = await trx
                    .select()
                    .from(resourcePolicies)
                    .where(
                        and(
                            eq(resourcePolicies.niceId, resourceData.policy),
                            eq(resourcePolicies.orgId, orgId)
                        )
                    )
                    .limit(1);

                if (!sharedPolicy) {
                    throw new Error(
                        `Shared policy not found: ${resourceData.policy} in org ${orgId}`
                    );
                }
                sharedPolicyId = sharedPolicy.resourcePolicyId;
            }

            // Create new resource
            const [newResource] = await trx
                .insert(resources)
                .values({
                    orgId,
                    niceId: resourceNiceId,
                    name: resourceData.name || "Unnamed Resource",
                    mode: resourceData.mode,
                    proxyPort: ["http", "ssh", "rdp", "vnc"].includes(
                        resourceData.mode || ""
                    )
                        ? null
                        : resourceData["proxy-port"],
                    fullDomain: ["http", "ssh", "rdp", "vnc"].includes(
                        resourceData.mode || ""
                    )
                        ? resourceData["full-domain"]
                        : null,
                    subdomain: domain ? domain.subdomain : null,
                    domainId: domain ? domain.domainId : null,
                    wildcard: domain ? domain.wildcard : false,
                    enabled: resourceEnabled,
                    setHostHeader: resourceData["host-header"] || null,
                    tlsServerName: resourceData["tls-server-name"] || null,
                    ssl: resourceSsl,
                    headers: headers || null,
                    applyRules:
                        resourceData.rules && resourceData.rules.length > 0,
                    pamMode: resourceData["auth-daemon"]?.pam || "passthrough",
                    authDaemonMode:
                        resourceData["auth-daemon"]?.mode || "native",
                    authDaemonPort: resourceData["auth-daemon"]?.port || 22123,
                    maintenanceModeEnabled: resourceData.maintenance?.enabled,
                    maintenanceModeType: resourceData.maintenance?.type,
                    maintenanceTitle: resourceData.maintenance?.title,
                    maintenanceMessage: resourceData.maintenance?.message,
                    maintenanceEstimatedTime:
                        resourceData.maintenance?.["estimated-time"],
                    proxyProtocol:
                        resourceData.mode === "tcp"
                            ? (resourceData["proxy-protocol"] ?? false)
                            : false,
                    proxyProtocolVersion:
                        resourceData.mode === "tcp"
                            ? (resourceData["proxy-protocol-version"] ?? 1)
                            : 1,
                    defaultResourcePolicyId: inlinePolicy.resourcePolicyId,
                    resourcePolicyId: sharedPolicyId,
                    // Only set these resource-level fields when using a shared policy
                    ...(sharedPolicyId
                        ? {
                              sso: resourceData.auth?.["sso-enabled"] || false,
                              skipToIdpId:
                                  resourceData.auth?.["auto-login-idp"] || null,
                              emailWhitelistEnabled: resourceData.auth?.[
                                  "whitelist-users"
                              ]
                                  ? resourceData.auth["whitelist-users"]
                                        .length > 0
                                  : false,
                              applyRules:
                                  resourceData.rules &&
                                  resourceData.rules.length > 0
                          }
                        : {})
                })
                .returning();

            resource = newResource;

            await trx.insert(roleResources).values({
                roleId: adminRole.roleId,
                resourceId: newResource.resourceId
            });

            if (sharedPolicyId) {
                // SHARED POLICY MODE: update OLD resource-level auth tables
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
                    const headerAuthUser =
                        resourceData.auth["basic-auth"]?.user;
                    const headerAuthPassword =
                        resourceData.auth["basic-auth"]?.password;
                    const headerAuthExtendedCompatibility =
                        resourceData.auth["basic-auth"]?.extendedCompatibility;
                    if (
                        headerAuthUser &&
                        headerAuthPassword &&
                        headerAuthExtendedCompatibility !== null
                    ) {
                        const headerAuthHash = await hashPassword(
                            Buffer.from(
                                `${headerAuthUser}:${headerAuthPassword}`
                            ).toString("base64")
                        );
                        await Promise.all([
                            trx.insert(resourceHeaderAuth).values({
                                resourceId: newResource.resourceId,
                                headerAuthHash
                            }),
                            trx
                                .insert(resourceHeaderAuthExtendedCompatibility)
                                .values({
                                    resourceId: newResource.resourceId,
                                    extendedCompatibilityIsActivated:
                                        headerAuthExtendedCompatibility
                                })
                        ]);
                    }
                }

                if (resourceData.auth?.["sso-roles"]) {
                    await syncRoleResources(
                        newResource.resourceId,
                        resourceData.auth["sso-roles"],
                        orgId,
                        trx
                    );
                }

                if (resourceData.auth?.["sso-users"]) {
                    await syncUserResources(
                        newResource.resourceId,
                        resourceData.auth["sso-users"],
                        orgId,
                        trx
                    );
                }

                if (resourceData.auth?.["whitelist-users"]) {
                    await syncWhitelistUsers(
                        newResource.resourceId,
                        resourceData.auth["whitelist-users"],
                        orgId,
                        trx
                    );
                }

                // Rules into OLD resourceRules table
                for (const [index, rule] of resourceData.rules?.entries() ||
                    []) {
                    validateRule(rule);
                    await trx.insert(resourceRules).values({
                        resourceId: newResource.resourceId,
                        action: getRuleAction(rule.action),
                        match: rule.match.toUpperCase(),
                        value: getRuleValue(
                            rule.match.toUpperCase(),
                            rule.value
                        ),
                        priority: rule.priority ?? index + 1
                    });
                }
            } else {
                // INLINE POLICY MODE: update the inline policy auth fields
                await syncInlinePolicyAuth(
                    inlinePolicy.resourcePolicyId,
                    orgId,
                    resourceData,
                    trx
                );

                // Rules into policy-level table
                await syncInlinePolicyRules(
                    inlinePolicy.resourcePolicyId,
                    resourceData.rules || [],
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

            await usageService.add(orgId, LimitId.PUBLIC_RESOURCES, 1, trx);

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
    } else if (rule.match === "region") {
        if (!isValidRegionId(rule.value)) {
            throw new Error(`Invalid region ID provided: ${rule.value}`);
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
        let [role] = await trx
            .select()
            .from(roles)
            .where(and(eq(roles.name, roleName), eq(roles.orgId, orgId)))
            .limit(1);

        if (!role) {
            const [created] = await trx
                .insert(roles)
                .values({ name: roleName, orgId })
                .returning();
            await trx.insert(roleActions).values(
                defaultRoleAllowedActions.map((action) => ({
                    roleId: created.roleId,
                    actionId: action,
                    orgId
                }))
            );
            role = created;
            logger.info(
                `Auto-created role "${roleName}" in org ${orgId} from blueprint`
            );
        }

        if (role.isAdmin) {
            continue; // never add admin access
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

    for (const username of ssoUsers) {
        const [user] = await trx
            .select()
            .from(users)
            .innerJoin(userOrgs, eq(users.userId, userOrgs.userId))
            .where(
                and(
                    or(eq(users.username, username), eq(users.email, username)),
                    eq(userOrgs.orgId, orgId)
                )
            )
            .limit(1);

        if (!user) {
            throw new Error(`User not found: ${username} in org ${orgId}`);
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

        if (
            user &&
            user.user.username &&
            !ssoUsers.includes(user.user.username)
        ) {
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

/**
 * Creates an inline resourcePolicy if one doesn't exist yet, and returns its ID.
 * Makes the policy visible to the admin role via rolePolicies.
 */
async function ensureInlinePolicy(
    existingPolicyId: number | null | undefined,
    orgId: string,
    resourceNiceId: string,
    adminRoleId: number,
    trx: Transaction
): Promise<number> {
    if (existingPolicyId) {
        return existingPolicyId;
    }

    const policyNiceId = await getUniqueResourcePolicyName(orgId);
    const [newPolicy] = await trx
        .insert(resourcePolicies)
        .values({
            niceId: policyNiceId,
            orgId,
            name: `default policy for ${resourceNiceId}`,
            sso: true,
            scope: "resource"
        })
        .returning();

    await trx.insert(rolePolicies).values({
        roleId: adminRoleId,
        resourcePolicyId: newPolicy.resourcePolicyId
    });

    return newPolicy.resourcePolicyId;
}

/**
 * Updates the inline policy's auth-related fields and policy-level tables
 * (used when no shared policy is specified in the blueprint).
 */
async function syncInlinePolicyAuth(
    policyId: number,
    orgId: string,
    resourceData: any,
    trx: Transaction
) {
    // Update policy-level SSO/whitelist/applyRules fields
    await trx
        .update(resourcePolicies)
        .set({
            sso: resourceData.auth?.["sso-enabled"] ?? false,
            idpId: resourceData.auth?.["auto-login-idp"] || null,
            emailWhitelistEnabled: resourceData.auth?.["whitelist-users"]
                ? resourceData.auth["whitelist-users"].length > 0
                : false,
            applyRules: !!(resourceData.rules && resourceData.rules.length > 0)
        })
        .where(eq(resourcePolicies.resourcePolicyId, policyId));

    // Password
    await trx
        .delete(resourcePolicyPassword)
        .where(eq(resourcePolicyPassword.resourcePolicyId, policyId));
    if (resourceData.auth?.password) {
        const passwordHash = await hashPassword(resourceData.auth.password);
        await trx.insert(resourcePolicyPassword).values({
            resourcePolicyId: policyId,
            passwordHash
        });
    }

    // Pincode
    await trx
        .delete(resourcePolicyPincode)
        .where(eq(resourcePolicyPincode.resourcePolicyId, policyId));
    if (resourceData.auth?.pincode) {
        const pincodeHash = await hashPassword(
            resourceData.auth.pincode.toString()
        );
        await trx.insert(resourcePolicyPincode).values({
            resourcePolicyId: policyId,
            pincodeHash,
            digitLength: 6
        });
    }

    // Header auth
    await trx
        .delete(resourcePolicyHeaderAuth)
        .where(eq(resourcePolicyHeaderAuth.resourcePolicyId, policyId));
    if (resourceData.auth?.["basic-auth"]) {
        const headerAuthUser = resourceData.auth["basic-auth"]?.user;
        const headerAuthPassword = resourceData.auth["basic-auth"]?.password;
        const headerAuthExtendedCompatibility =
            resourceData.auth["basic-auth"]?.extendedCompatibility;
        if (
            headerAuthUser &&
            headerAuthPassword &&
            headerAuthExtendedCompatibility !== null
        ) {
            const headerAuthHash = await hashPassword(
                Buffer.from(`${headerAuthUser}:${headerAuthPassword}`).toString(
                    "base64"
                )
            );
            await trx.insert(resourcePolicyHeaderAuth).values({
                resourcePolicyId: policyId,
                headerAuthHash,
                extendedCompatibility: headerAuthExtendedCompatibility
            });
        }
    }

    // SSO roles → rolePolicies
    if (resourceData.auth?.["sso-roles"] !== undefined) {
        await syncRolePolicies(
            policyId,
            resourceData.auth["sso-roles"],
            orgId,
            trx
        );
    }

    // SSO users → userPolicies
    if (resourceData.auth?.["sso-users"] !== undefined) {
        await syncUserPolicies(
            policyId,
            resourceData.auth["sso-users"],
            orgId,
            trx
        );
    }

    // Whitelist → resourcePolicyWhiteList
    if (resourceData.auth?.["whitelist-users"] !== undefined) {
        await syncWhitelistPolicyUsers(
            policyId,
            resourceData.auth["whitelist-users"],
            orgId,
            trx
        );
    }
}

/**
 * Syncs rules into the resourcePolicyRules table (inline policy mode).
 */
async function syncInlinePolicyRules(
    policyId: number,
    rules: any[],
    trx: Transaction
) {
    const existingRules = await trx
        .select()
        .from(resourcePolicyRules)
        .where(eq(resourcePolicyRules.resourcePolicyId, policyId))
        .orderBy(resourcePolicyRules.priority);

    for (const [index, rule] of rules.entries()) {
        const intendedPriority = rule.priority ?? index + 1;
        const existingRule = existingRules[index];
        if (existingRule) {
            if (
                existingRule.action !== getRuleAction(rule.action) ||
                existingRule.match !== rule.match.toUpperCase() ||
                existingRule.value !==
                    getRuleValue(rule.match.toUpperCase(), rule.value) ||
                existingRule.priority !== intendedPriority
            ) {
                validateRule(rule);
                await trx
                    .update(resourcePolicyRules)
                    .set({
                        action: getRuleAction(rule.action) as
                            | "ACCEPT"
                            | "DROP"
                            | "PASS",
                        match: rule.match.toUpperCase() as
                            | "CIDR"
                            | "IP"
                            | "PATH",
                        value: getRuleValue(
                            rule.match.toUpperCase(),
                            rule.value
                        ),
                        priority: intendedPriority
                    })
                    .where(eq(resourcePolicyRules.ruleId, existingRule.ruleId));
            }
        } else {
            validateRule(rule);
            await trx.insert(resourcePolicyRules).values({
                resourcePolicyId: policyId,
                action: getRuleAction(rule.action) as
                    | "ACCEPT"
                    | "DROP"
                    | "PASS",
                match: rule.match.toUpperCase() as "CIDR" | "IP" | "PATH",
                value: getRuleValue(rule.match.toUpperCase(), rule.value),
                priority: intendedPriority
            });
        }
    }

    if (existingRules.length > rules.length) {
        const rulesToDelete = existingRules.slice(rules.length);
        for (const rule of rulesToDelete) {
            await trx
                .delete(resourcePolicyRules)
                .where(eq(resourcePolicyRules.ruleId, rule.ruleId));
        }
    }
}

/**
 * Syncs SSO roles to the rolePolicies table (inline policy mode).
 */
async function syncRolePolicies(
    policyId: number,
    ssoRoles: string[],
    orgId: string,
    trx: Transaction
) {
    const existingRolePoliciesList = await trx
        .select()
        .from(rolePolicies)
        .where(eq(rolePolicies.resourcePolicyId, policyId));

    for (const roleName of ssoRoles) {
        const [role] = await trx
            .select()
            .from(roles)
            .where(and(eq(roles.name, roleName), eq(roles.orgId, orgId)))
            .limit(1);

        if (!role) {
            throw new Error(`Role not found: ${roleName} in org ${orgId}`);
        }

        if (role.isAdmin) {
            continue;
        }

        const existingRolePolicy = existingRolePoliciesList.find(
            (rp) => rp.roleId === role.roleId
        );

        if (!existingRolePolicy) {
            await trx.insert(rolePolicies).values({
                roleId: role.roleId,
                resourcePolicyId: policyId
            });
        }
    }

    for (const existingRolePolicy of existingRolePoliciesList) {
        const [role] = await trx
            .select()
            .from(roles)
            .where(eq(roles.roleId, existingRolePolicy.roleId))
            .limit(1);

        if (role?.isAdmin) {
            continue;
        }

        if (role && !ssoRoles.includes(role.name)) {
            await trx
                .delete(rolePolicies)
                .where(
                    and(
                        eq(rolePolicies.roleId, existingRolePolicy.roleId),
                        eq(rolePolicies.resourcePolicyId, policyId)
                    )
                );
        }
    }
}

/**
 * Syncs SSO users to the userPolicies table (inline policy mode).
 */
async function syncUserPolicies(
    policyId: number,
    ssoUsers: string[],
    orgId: string,
    trx: Transaction
) {
    const existingUserPoliciesList = await trx
        .select()
        .from(userPolicies)
        .where(eq(userPolicies.resourcePolicyId, policyId));

    for (const username of ssoUsers) {
        const [user] = await trx
            .select()
            .from(users)
            .innerJoin(userOrgs, eq(users.userId, userOrgs.userId))
            .where(
                and(
                    or(eq(users.username, username), eq(users.email, username)),
                    eq(userOrgs.orgId, orgId)
                )
            )
            .limit(1);

        if (!user) {
            throw new Error(`User not found: ${username} in org ${orgId}`);
        }

        const existingUserPolicy = existingUserPoliciesList.find(
            (up) => up.userId === user.user.userId
        );

        if (!existingUserPolicy) {
            await trx.insert(userPolicies).values({
                userId: user.user.userId,
                resourcePolicyId: policyId
            });
        }
    }

    for (const existingUserPolicy of existingUserPoliciesList) {
        const [user] = await trx
            .select()
            .from(users)
            .innerJoin(userOrgs, eq(users.userId, userOrgs.userId))
            .where(
                and(
                    eq(users.userId, existingUserPolicy.userId),
                    eq(userOrgs.orgId, orgId)
                )
            )
            .limit(1);

        if (
            user &&
            user.user.username &&
            !ssoUsers.includes(user.user.username)
        ) {
            await trx
                .delete(userPolicies)
                .where(
                    and(
                        eq(userPolicies.userId, existingUserPolicy.userId),
                        eq(userPolicies.resourcePolicyId, policyId)
                    )
                );
        }
    }
}

/**
 * Syncs whitelist emails to the resourcePolicyWhiteList table (inline policy mode).
 */
async function syncWhitelistPolicyUsers(
    policyId: number,
    whitelistUsers: string[],
    orgId: string,
    trx: Transaction
) {
    const existingWhitelist = await trx
        .select()
        .from(resourcePolicyWhiteList)
        .where(eq(resourcePolicyWhiteList.resourcePolicyId, policyId));

    for (const email of whitelistUsers) {
        const existingEntry = existingWhitelist.find((w) => w.email === email);

        if (!existingEntry) {
            await trx.insert(resourcePolicyWhiteList).values({
                email,
                resourcePolicyId: policyId
            });
        }
    }

    for (const existingEntry of existingWhitelist) {
        if (!whitelistUsers.includes(existingEntry.email)) {
            await trx
                .delete(resourcePolicyWhiteList)
                .where(
                    and(
                        eq(
                            resourcePolicyWhiteList.whitelistId,
                            existingEntry.whitelistId
                        ),
                        eq(resourcePolicyWhiteList.resourcePolicyId, policyId)
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
    if (existing.hcHealthyThreshold !== incoming.hcHealthyThreshold)
        return true;
    if (existing.hcUnhealthyThreshold !== incoming.hcUnhealthyThreshold)
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

async function enforceDomainNamespacePaywall(
    orgId: string,
    domainId: string,
    trx: Transaction
) {
    if (build !== "saas") {
        return;
    }

    const hasDomainNamespaceAccess = await isLicensedOrSubscribed(
        orgId,
        tierMatrix.domainNamespaces
    );

    if (hasDomainNamespaceAccess) {
        return;
    }

    const [namespaceDomain] = await trx
        .select()
        .from(domainNamespaces)
        .where(eq(domainNamespaces.domainId, domainId))
        .limit(1);

    if (namespaceDomain) {
        throw new Error(
            "Your current subscription does not support custom domain namespaces. Please upgrade to access this feature."
        );
    }
}

export async function getDomain(
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
): Promise<{
    subdomain: string | null;
    domainId: string;
    wildcard: boolean;
} | null> {
    const isWildcardFullDomain = fullDomain.startsWith("*.");

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
        // Wildcard full-domains are not allowed on CNAME domains
        if (isWildcardFullDomain && domain.domains.type === "cname") {
            return false;
        }

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

    // Pick the most specific (longest baseDomain) valid domain so that, e.g.,
    // *.test.dev.example.com is assigned to *.dev.example.com rather than *.example.com.
    const domainSelection = validDomains.sort(
        (a, b) => b.domains.baseDomain.length - a.domains.baseDomain.length
    )[0].domains;
    const baseDomain = domainSelection.baseDomain;

    // Wildcard full-domains are not allowed on namespace (provided/free) domains
    if (isWildcardFullDomain) {
        const [namespaceDomain] = await trx
            .select()
            .from(domainNamespaces)
            .where(eq(domainNamespaces.domainId, domainSelection.domainId))
            .limit(1);

        if (namespaceDomain) {
            throw new Error(
                `Wildcard full-domains are not supported for provided or free domains: ${fullDomain}`
            );
        }
    }

    // remove the base domain of the domain
    let subdomain = null;
    if (fullDomain != baseDomain) {
        subdomain = fullDomain.replace(`.${baseDomain}`, "");
    }

    // Return the first valid domain
    return {
        subdomain: subdomain,
        domainId: domainSelection.domainId,
        wildcard: isWildcardFullDomain
    };
}
