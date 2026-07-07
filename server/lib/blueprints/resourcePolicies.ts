import {
    db,
    idp,
    idpOrg,
    resourcePolicies,
    resourcePolicyHeaderAuth,
    resourcePolicyPassword,
    resourcePolicyPincode,
    resourcePolicyRules,
    resourcePolicyWhiteList,
    rolePolicies,
    roles,
    Transaction,
    userOrgs,
    userPolicies,
    users
} from "@server/db";
import { eq, and, or } from "drizzle-orm";
import { Config, ResourcePolicyData } from "./types";
import logger from "@server/logger";
import { getUniqueResourcePolicyName } from "@server/db/names";
import { hashPassword } from "@server/auth/password";
import { isValidCIDR, isValidIP, isValidUrlGlobPattern } from "../validators";
import { isLicensedOrSubscribed } from "#dynamic/lib/isLicencedOrSubscribed";
import { tierMatrix } from "../billing/tierMatrix";

export type ResourcePoliciesResults = {
    resourcePolicyId: number;
    niceId: string;
}[];

export async function updateResourcePolicies(
    orgId: string,
    config: Config,
    trx: Transaction
): Promise<ResourcePoliciesResults> {
    const results: ResourcePoliciesResults = [];

    for (const [policyNiceId, policyData] of Object.entries(
        config["public-policies"]
    )) {
        const isLicensed = await isLicensedOrSubscribed(
            orgId,
            tierMatrix.resourcePolicies
        );
        if (!isLicensed) {
            throw new Error(
                "Your current subscription does not support shared resource policies. Please upgrade to access this feature."
            );
        }

        // Validate rules
        for (const rule of policyData.rules) {
            if (rule.match === "cidr" && !isValidCIDR(rule.value)) {
                throw new Error(
                    `Invalid CIDR provided in resource policy '${policyNiceId}': ${rule.value}`
                );
            } else if (rule.match === "ip" && !isValidIP(rule.value)) {
                throw new Error(
                    `Invalid IP provided in resource policy '${policyNiceId}': ${rule.value}`
                );
            } else if (
                rule.match === "path" &&
                !isValidUrlGlobPattern(rule.value)
            ) {
                throw new Error(
                    `Invalid URL glob pattern provided in resource policy '${policyNiceId}': ${rule.value}`
                );
            }
        }

        // Validate auto-login-idp if provided
        if (policyData["auto-login-idp"]) {
            const [provider] = await trx
                .select()
                .from(idp)
                .innerJoin(idpOrg, eq(idpOrg.idpId, idp.idpId))
                .where(
                    and(
                        eq(idp.idpId, policyData["auto-login-idp"]),
                        eq(idpOrg.orgId, orgId)
                    )
                )
                .limit(1);

            if (!provider) {
                throw new Error(
                    `Identity provider not found for policy '${policyNiceId}' in this organization`
                );
            }
        }

        // Look up the admin role
        const [adminRole] = await trx
            .select()
            .from(roles)
            .where(and(eq(roles.isAdmin, true), eq(roles.orgId, orgId)))
            .limit(1);

        if (!adminRole) {
            throw new Error("Admin role not found");
        }

        // Find existing policy by niceId and orgId
        const [existingPolicy] = await trx
            .select()
            .from(resourcePolicies)
            .where(
                and(
                    eq(resourcePolicies.niceId, policyNiceId),
                    eq(resourcePolicies.orgId, orgId)
                )
            )
            .limit(1);

        let resourcePolicyId: number;

        if (existingPolicy) {
            // Update the existing policy
            await trx
                .update(resourcePolicies)
                .set({
                    name: policyData.name,
                    sso: policyData.sso ?? true,
                    idpId: policyData["auto-login-idp"] ?? null,
                    emailWhitelistEnabled:
                        policyData["email-whitelist-enabled"] ??
                        policyData["whitelist-users"].length > 0,
                    applyRules:
                        policyData["apply-rules"] || policyData.rules.length > 0
                })
                .where(
                    eq(
                        resourcePolicies.resourcePolicyId,
                        existingPolicy.resourcePolicyId
                    )
                );

            resourcePolicyId = existingPolicy.resourcePolicyId;

            // Sync password
            await trx
                .delete(resourcePolicyPassword)
                .where(
                    eq(
                        resourcePolicyPassword.resourcePolicyId,
                        resourcePolicyId
                    )
                );
            if (policyData.password) {
                const passwordHash = await hashPassword(policyData.password);
                await trx.insert(resourcePolicyPassword).values({
                    resourcePolicyId,
                    passwordHash
                });
            }

            // Sync pincode
            await trx
                .delete(resourcePolicyPincode)
                .where(
                    eq(resourcePolicyPincode.resourcePolicyId, resourcePolicyId)
                );
            if (policyData.pincode) {
                const pincodeHash = await hashPassword(policyData.pincode);
                await trx.insert(resourcePolicyPincode).values({
                    resourcePolicyId,
                    pincodeHash,
                    digitLength: 6
                });
            }

            // Sync header auth
            await trx
                .delete(resourcePolicyHeaderAuth)
                .where(
                    eq(
                        resourcePolicyHeaderAuth.resourcePolicyId,
                        resourcePolicyId
                    )
                );
            if (policyData["basic-auth"]) {
                const basicAuth = policyData["basic-auth"];
                const headerAuthHash = await hashPassword(
                    Buffer.from(
                        `${basicAuth.user}:${basicAuth.password}`
                    ).toString("base64")
                );
                await trx.insert(resourcePolicyHeaderAuth).values({
                    resourcePolicyId,
                    headerAuthHash,
                    extendedCompatibility:
                        basicAuth["extended-compatibility"] ?? true
                });
            }

            // Sync SSO roles
            await syncRolePolicies(
                resourcePolicyId,
                policyData["sso-roles"],
                orgId,
                adminRole.roleId,
                trx
            );

            // Sync SSO users
            await syncUserPolicies(
                resourcePolicyId,
                policyData["sso-users"],
                orgId,
                trx
            );

            // Sync whitelist users
            await syncWhitelistPolicyUsers(
                resourcePolicyId,
                policyData["whitelist-users"],
                trx
            );

            // Sync rules
            await syncPolicyRules(resourcePolicyId, policyData.rules, trx);

            logger.debug(
                `Updated resource policy ${resourcePolicyId} (${policyNiceId})`
            );
        } else {
            // Create a new policy
            const [newPolicy] = await trx
                .insert(resourcePolicies)
                .values({
                    niceId: policyNiceId,
                    orgId,
                    name: policyData.name,
                    sso: policyData.sso ?? true,
                    idpId: policyData["auto-login-idp"] ?? null,
                    emailWhitelistEnabled:
                        policyData["email-whitelist-enabled"] ??
                        policyData["whitelist-users"].length > 0,
                    applyRules:
                        policyData["apply-rules"] ||
                        policyData.rules.length > 0,
                    scope: "global"
                })
                .returning();

            resourcePolicyId = newPolicy.resourcePolicyId;

            // Always add admin role
            await trx.insert(rolePolicies).values({
                roleId: adminRole.roleId,
                resourcePolicyId
            });

            // Add SSO roles
            await addRolePolicies(
                resourcePolicyId,
                policyData["sso-roles"],
                orgId,
                adminRole.roleId,
                trx
            );

            // Add SSO users
            await addUserPolicies(
                resourcePolicyId,
                policyData["sso-users"],
                orgId,
                trx
            );

            // Add password
            if (policyData.password) {
                const passwordHash = await hashPassword(policyData.password);
                await trx.insert(resourcePolicyPassword).values({
                    resourcePolicyId,
                    passwordHash
                });
            }

            // Add pincode
            if (policyData.pincode) {
                const pincodeHash = await hashPassword(policyData.pincode);
                await trx.insert(resourcePolicyPincode).values({
                    resourcePolicyId,
                    pincodeHash,
                    digitLength: 6
                });
            }

            // Add header auth
            if (policyData["basic-auth"]) {
                const basicAuth = policyData["basic-auth"];
                const headerAuthHash = await hashPassword(
                    Buffer.from(
                        `${basicAuth.user}:${basicAuth.password}`
                    ).toString("base64")
                );
                await trx.insert(resourcePolicyHeaderAuth).values({
                    resourcePolicyId,
                    headerAuthHash,
                    extendedCompatibility:
                        basicAuth["extended-compatibility"] ?? true
                });
            }

            // Add whitelist users
            if (policyData["whitelist-users"].length > 0) {
                await trx.insert(resourcePolicyWhiteList).values(
                    policyData["whitelist-users"].map((email) => ({
                        email,
                        resourcePolicyId
                    }))
                );
            }

            // Add rules
            if (policyData.rules.length > 0) {
                await trx.insert(resourcePolicyRules).values(
                    policyData.rules.map((rule, index) => ({
                        resourcePolicyId,
                        action: getRuleAction(rule.action),
                        match: getRuleMatch(rule.match),
                        value: rule.value,
                        priority: rule.priority ?? index + 1,
                        enabled: rule.enabled ?? true
                    }))
                );
            }

            logger.debug(
                `Created resource policy ${resourcePolicyId} (${policyNiceId})`
            );
        }

        results.push({ resourcePolicyId, niceId: policyNiceId });
    }

    return results;
}

function getRuleAction(input: string): "ACCEPT" | "DROP" | "PASS" {
    if (input === "allow") return "ACCEPT";
    if (input === "deny") return "DROP";
    return "PASS";
}

function getRuleMatch(
    input: string
): "CIDR" | "IP" | "PATH" | "COUNTRY" | "ASN" | "REGION" {
    return input.toUpperCase() as
        | "CIDR"
        | "IP"
        | "PATH"
        | "COUNTRY"
        | "ASN"
        | "REGION";
}

async function syncRolePolicies(
    policyId: number,
    ssoRoles: string[],
    orgId: string,
    adminRoleId: number,
    trx: Transaction
) {
    const existingRolePolicies = await trx
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
            logger.warn(
                `Role '${roleName}' not found in org '${orgId}', skipping`
            );
            continue;
        }

        if (role.isAdmin) {
            continue; // admin role is always included, skip
        }

        const alreadyExists = existingRolePolicies.some(
            (rp) => rp.roleId === role.roleId
        );

        if (!alreadyExists) {
            await trx.insert(rolePolicies).values({
                roleId: role.roleId,
                resourcePolicyId: policyId
            });
        }
    }

    // Remove roles no longer in the list (except admin)
    for (const existingRolePolicy of existingRolePolicies) {
        if (existingRolePolicy.roleId === adminRoleId) {
            continue;
        }

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
                        eq(rolePolicies.resourcePolicyId, policyId),
                        eq(rolePolicies.roleId, existingRolePolicy.roleId)
                    )
                );
        }
    }
}

async function addRolePolicies(
    policyId: number,
    ssoRoles: string[],
    orgId: string,
    adminRoleId: number,
    trx: Transaction
) {
    for (const roleName of ssoRoles) {
        const [role] = await trx
            .select()
            .from(roles)
            .where(and(eq(roles.name, roleName), eq(roles.orgId, orgId)))
            .limit(1);

        if (!role) {
            logger.warn(
                `Role '${roleName}' not found in org '${orgId}', skipping`
            );
            continue;
        }

        if (role.isAdmin) {
            continue; // admin already added
        }

        await trx.insert(rolePolicies).values({
            roleId: role.roleId,
            resourcePolicyId: policyId
        });
    }
}

async function syncUserPolicies(
    policyId: number,
    ssoUsers: string[],
    orgId: string,
    trx: Transaction
) {
    const existingUserPolicies = await trx
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
            logger.warn(
                `User '${username}' not found in org '${orgId}', skipping`
            );
            continue;
        }

        const alreadyExists = existingUserPolicies.some(
            (up) => up.userId === user.user.userId
        );

        if (!alreadyExists) {
            await trx.insert(userPolicies).values({
                userId: user.user.userId,
                resourcePolicyId: policyId
            });
        }
    }

    // Remove users no longer in the list
    for (const existingUserPolicy of existingUserPolicies) {
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
            !ssoUsers.includes(user.user.username) &&
            !ssoUsers.includes(user.user.email ?? "")
        ) {
            await trx
                .delete(userPolicies)
                .where(
                    and(
                        eq(userPolicies.resourcePolicyId, policyId),
                        eq(userPolicies.userId, existingUserPolicy.userId)
                    )
                );
        }
    }
}

async function addUserPolicies(
    policyId: number,
    ssoUsers: string[],
    orgId: string,
    trx: Transaction
) {
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
            logger.warn(
                `User '${username}' not found in org '${orgId}', skipping`
            );
            continue;
        }

        await trx.insert(userPolicies).values({
            userId: user.user.userId,
            resourcePolicyId: policyId
        });
    }
}

async function syncWhitelistPolicyUsers(
    policyId: number,
    whitelistUsers: string[],
    trx: Transaction
) {
    const existingWhitelist = await trx
        .select()
        .from(resourcePolicyWhiteList)
        .where(eq(resourcePolicyWhiteList.resourcePolicyId, policyId));

    for (const email of whitelistUsers) {
        const alreadyExists = existingWhitelist.some((w) => w.email === email);

        if (!alreadyExists) {
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
                        eq(resourcePolicyWhiteList.resourcePolicyId, policyId),
                        eq(resourcePolicyWhiteList.email, existingEntry.email)
                    )
                );
        }
    }
}

async function syncPolicyRules(
    policyId: number,
    rules: ResourcePolicyData["rules"],
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
            await trx
                .update(resourcePolicyRules)
                .set({
                    action: getRuleAction(rule.action),
                    match: getRuleMatch(rule.match),
                    value: rule.value,
                    priority: intendedPriority,
                    enabled: rule.enabled ?? true
                })
                .where(eq(resourcePolicyRules.ruleId, existingRule.ruleId));
        } else {
            await trx.insert(resourcePolicyRules).values({
                resourcePolicyId: policyId,
                action: getRuleAction(rule.action),
                match: getRuleMatch(rule.match),
                value: rule.value,
                priority: intendedPriority,
                enabled: rule.enabled ?? true
            });
        }
    }

    // Remove extra rules
    if (existingRules.length > rules.length) {
        const rulesToDelete = existingRules.slice(rules.length);
        for (const rule of rulesToDelete) {
            await trx
                .delete(resourcePolicyRules)
                .where(eq(resourcePolicyRules.ruleId, rule.ruleId));
        }
    }
}
