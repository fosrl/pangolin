import {
    db,
    loginPage,
    LoginPage,
    loginPageOrg,
    Org,
    orgs,
    roles
} from "@server/db";
import {
    Resource,
    ResourcePassword,
    ResourcePincode,
    ResourceRule,
    resourcePassword,
    resourcePincode,
    resourceHeaderAuth,
    ResourceHeaderAuth,
    resourceRules,
    resourcePolicyRules,
    resources,
    roleResources,
    rolePolicies,
    sessions,
    userResources,
    userPolicies,
    users,
    ResourceHeaderAuthExtendedCompatibility,
    resourceHeaderAuthExtendedCompatibility,
    resourcePolicies,
    resourcePolicyPincode,
    ResourcePolicyPincode,
    resourcePolicyPassword,
    ResourcePolicyPassword,
    resourcePolicyHeaderAuth,
    ResourcePolicyHeaderAuth
} from "@server/db";
import { alias } from "@server/db";
import { and, eq, inArray, isNull, or, sql } from "drizzle-orm";
import logger from "@server/logger";

export type ResourceWithAuth = {
    resource: Resource | null;
    pincode: ResourcePincode | ResourcePolicyPincode | null;
    password: ResourcePassword | ResourcePolicyPassword | null;
    headerAuth: ResourceHeaderAuth | ResourcePolicyHeaderAuth | null;
    headerAuthExtendedCompatibility: ResourceHeaderAuthExtendedCompatibility | null;
    applyRules: boolean | null;
    sso: boolean | null;
    emailWhitelistEnabled: boolean | null;
    org: Org;
};

export type UserSessionWithUser = {
    session: any;
    user: any;
};

/**
 * Get resource by domain with pincode and password information
 */
export async function getResourceByDomain(
    domain: string
): Promise<ResourceWithAuth | null> {
    // Build wildcard domain variants to match against.
    // For a domain like "me.example.test.com", we want to match:
    //   - "*.example.test.com" (subdomain wildcard)
    //   - "*.test.com" (parent wildcard, i.e. just "*" subdomain on parent)
    const parts = domain.split(".");
    const wildcardCandidates: string[] = [];
    for (let i = 1; i < parts.length; i++) {
        wildcardCandidates.push(`*.${parts.slice(i).join(".")}`);
    }

    const sharedPolicy = alias(resourcePolicies, "sharedPolicy");
    const defaultPolicy = alias(resourcePolicies, "defaultPolicy");
    const sharedPolicyPincode = alias(
        resourcePolicyPincode,
        "sharedPolicyPincode"
    );
    const defaultPolicyPincode = alias(
        resourcePolicyPincode,
        "defaultPolicyPincode"
    );
    const sharedPolicyPassword = alias(
        resourcePolicyPassword,
        "sharedPolicyPassword"
    );
    const defaultPolicyPassword = alias(
        resourcePolicyPassword,
        "defaultPolicyPassword"
    );
    const sharedPolicyHeaderAuth = alias(
        resourcePolicyHeaderAuth,
        "sharedPolicyHeaderAuth"
    );
    const defaultPolicyHeaderAuth = alias(
        resourcePolicyHeaderAuth,
        "defaultPolicyHeaderAuth"
    );

    const potentialResults = await db
        .select()
        .from(resources)
        .leftJoin(
            resourcePincode,
            eq(resourcePincode.resourceId, resources.resourceId)
        )
        .leftJoin(
            resourcePassword,
            eq(resourcePassword.resourceId, resources.resourceId)
        )
        .leftJoin(
            resourceHeaderAuth,
            eq(resourceHeaderAuth.resourceId, resources.resourceId)
        )
        .leftJoin(
            resourceHeaderAuthExtendedCompatibility,
            eq(
                resourceHeaderAuthExtendedCompatibility.resourceId,
                resources.resourceId
            )
        )
        .leftJoin(
            sharedPolicy,
            eq(sharedPolicy.resourcePolicyId, resources.resourcePolicyId)
        )
        .leftJoin(
            sharedPolicyPincode,
            eq(
                sharedPolicyPincode.resourcePolicyId,
                sharedPolicy.resourcePolicyId
            )
        )
        .leftJoin(
            sharedPolicyPassword,
            eq(
                sharedPolicyPassword.resourcePolicyId,
                sharedPolicy.resourcePolicyId
            )
        )
        .leftJoin(
            sharedPolicyHeaderAuth,
            eq(
                sharedPolicyHeaderAuth.resourcePolicyId,
                sharedPolicy.resourcePolicyId
            )
        )
        .leftJoin(
            defaultPolicy,
            eq(
                defaultPolicy.resourcePolicyId,
                resources.defaultResourcePolicyId
            )
        )
        .leftJoin(
            defaultPolicyPincode,
            eq(
                defaultPolicyPincode.resourcePolicyId,
                defaultPolicy.resourcePolicyId
            )
        )
        .leftJoin(
            defaultPolicyPassword,
            eq(
                defaultPolicyPassword.resourcePolicyId,
                defaultPolicy.resourcePolicyId
            )
        )
        .leftJoin(
            defaultPolicyHeaderAuth,
            eq(
                defaultPolicyHeaderAuth.resourcePolicyId,
                defaultPolicy.resourcePolicyId
            )
        )
        .innerJoin(orgs, eq(orgs.orgId, resources.orgId))
        .where(
            or(
                // Exact match
                eq(resources.fullDomain, domain),
                // Wildcard match: resource fullDomain is one of the wildcard candidates
                wildcardCandidates.length > 0
                    ? and(
                          eq(resources.wildcard, true),
                          inArray(resources.fullDomain, wildcardCandidates)
                      )
                    : sql`false`
            )
        );

    if (!potentialResults.length) {
        return null;
    }

    // Prefer exact match over wildcard match
    const exactMatch = potentialResults.find(
        (r) => r.resources?.fullDomain === domain
    );
    const result = exactMatch ?? potentialResults[0];

    if (!result) {
        return null;
    }

    // If a shared (custom) policy is assigned to the resource, use ONLY
    // its values — do not fall back to the default policy. The default
    // policy is only consulted when no shared policy is assigned at all.
    const hasSharedPolicy = result.sharedPolicy !== null;

    const effectivePolicyPincode = hasSharedPolicy
        ? result.sharedPolicyPincode
        : (result.defaultPolicyPincode ?? null);
    const effectivePolicyPassword = hasSharedPolicy
        ? result.sharedPolicyPassword
        : (result.defaultPolicyPassword ?? null);
    const effectivePolicyHeaderAuth = hasSharedPolicy
        ? result.sharedPolicyHeaderAuth
        : (result.defaultPolicyHeaderAuth ?? null);
    const selectedPolicy = hasSharedPolicy
        ? result.sharedPolicy
        : result.defaultPolicy;
    const effectiveApplyRules =
        selectedPolicy?.applyRules ?? result.resources.applyRules;
    const effectiveSSO = selectedPolicy?.sso ?? result.resources.sso;
    const effectiveEmailWhitelistEnabled =
        selectedPolicy?.emailWhitelistEnabled ??
        result.resources.emailWhitelistEnabled;

    return {
        resource: {
            ...result.resources,
            applyRules: effectiveApplyRules,
            sso: effectiveSSO,
            emailWhitelistEnabled: effectiveEmailWhitelistEnabled
        }, // doing this for backward compatability so the remote nodes get the value as part of the resource struct
        pincode: effectivePolicyPincode ?? result.resourcePincode,
        password: effectivePolicyPassword ?? result.resourcePassword,
        headerAuth: effectivePolicyHeaderAuth ?? result.resourceHeaderAuth,
        headerAuthExtendedCompatibility: effectivePolicyHeaderAuth
            ? ({
                  headerAuthExtendedCompatibilityId: 0,
                  resourceId: result.resources.resourceId,
                  extendedCompatibilityIsActivated:
                      effectivePolicyHeaderAuth.extendedCompatibility
              } as ResourceHeaderAuthExtendedCompatibility)
            : result.resourceHeaderAuthExtendedCompatibility,
        applyRules: effectiveApplyRules,
        sso: effectiveSSO,
        emailWhitelistEnabled: effectiveEmailWhitelistEnabled,
        org: result.orgs
    };
}

/**
 * Get user session with user information
 */
export async function getUserSessionWithUser(
    userSessionId: string
): Promise<UserSessionWithUser | null> {
    const [res] = await db
        .select()
        .from(sessions)
        .leftJoin(users, eq(users.userId, sessions.userId))
        .where(eq(sessions.sessionId, userSessionId));

    if (!res) {
        return null;
    }

    return {
        session: res.session,
        user: res.user
    };
}

/**
 * Get role name by role ID (for display).
 */
export async function getRoleName(roleId: number): Promise<string | null> {
    const [row] = await db
        .select({ name: roles.name })
        .from(roles)
        .where(eq(roles.roleId, roleId))
        .limit(1);
    return row?.name ?? null;
}

/**
 * Check if role has access to resource (direct or via resource policy)
 */
export async function getRoleResourceAccess(
    resourceId: number,
    roleIds: number[]
) {
    const [direct, viaPolicies] = await Promise.all([
        db
            .select()
            .from(roleResources)
            .where(
                and(
                    eq(roleResources.resourceId, resourceId),
                    inArray(roleResources.roleId, roleIds)
                )
            ),
        db
            .select({
                roleId: rolePolicies.roleId,
                resourcePolicyId: rolePolicies.resourcePolicyId
            })
            .from(rolePolicies)
            .innerJoin(
                resources,
                // Shared policy wins; only use default policy when no shared
                // policy is assigned to the resource.
                or(
                    eq(
                        resources.resourcePolicyId,
                        rolePolicies.resourcePolicyId
                    ),
                    and(
                        isNull(resources.resourcePolicyId),
                        eq(
                            resources.defaultResourcePolicyId,
                            rolePolicies.resourcePolicyId
                        )
                    )
                )
            )
            .where(
                and(
                    eq(resources.resourceId, resourceId),
                    inArray(rolePolicies.roleId, roleIds)
                )
            )
    ]);

    const combined = [...direct, ...viaPolicies];
    return combined.length > 0 ? combined : null;
}

/**
 * Check if user has access to resource (direct or via resource policy)
 */
export async function getUserResourceAccess(
    userId: string,
    resourceId: number
) {
    const [direct, viaPolicies] = await Promise.all([
        db
            .select()
            .from(userResources)
            .where(
                and(
                    eq(userResources.userId, userId),
                    eq(userResources.resourceId, resourceId)
                )
            )
            .limit(1),
        db
            .select({
                userId: userPolicies.userId,
                resourcePolicyId: userPolicies.resourcePolicyId
            })
            .from(userPolicies)
            .innerJoin(
                resources,
                // Shared policy wins; only use default policy when no shared
                // policy is assigned to the resource.
                or(
                    eq(
                        resources.resourcePolicyId,
                        userPolicies.resourcePolicyId
                    ),
                    and(
                        isNull(resources.resourcePolicyId),
                        eq(
                            resources.defaultResourcePolicyId,
                            userPolicies.resourcePolicyId
                        )
                    )
                )
            )
            .where(
                and(
                    eq(resources.resourceId, resourceId),
                    eq(userPolicies.userId, userId)
                )
            )
            .limit(1)
    ]);

    return direct[0] ?? viaPolicies[0] ?? null;
}

/**
 * Get resource rules for a given resource (direct and via resource policy)
 */
export async function getResourceRules(
    resourceId: number
): Promise<ResourceRule[]> {
    const [directRules, policyRules] = await Promise.all([
        db
            .select()
            .from(resourceRules)
            .where(eq(resourceRules.resourceId, resourceId)),
        db
            .select({
                ruleId: resourcePolicyRules.ruleId,
                resourceId: sql<number>`${resourceId}`,
                enabled: resourcePolicyRules.enabled,
                priority: resourcePolicyRules.priority,
                action: resourcePolicyRules.action,
                match: resourcePolicyRules.match,
                value: resourcePolicyRules.value
            })
            .from(resourcePolicyRules)
            .innerJoin(
                resources,
                // Shared policy wins; only use default policy when no shared
                // policy is assigned to the resource.
                or(
                    eq(
                        resources.resourcePolicyId,
                        resourcePolicyRules.resourcePolicyId
                    ),
                    and(
                        isNull(resources.resourcePolicyId),
                        eq(
                            resources.defaultResourcePolicyId,
                            resourcePolicyRules.resourcePolicyId
                        )
                    )
                )
            )
            .where(eq(resources.resourceId, resourceId))
    ]);

    const maxDirectPriority = directRules.reduce(
        (max, r) => Math.max(max, r.priority),
        0
    );
    const offsetPolicyRules = policyRules.map((r) => ({
        ...r,
        priority: maxDirectPriority + r.priority
    }));

    return [...directRules, ...offsetPolicyRules] as ResourceRule[];
}

/**
 * Get organization login page
 */
export async function getOrgLoginPage(
    orgId: string
): Promise<LoginPage | null> {
    const [result] = await db
        .select()
        .from(loginPageOrg)
        .where(eq(loginPageOrg.orgId, orgId))
        .innerJoin(
            loginPage,
            eq(loginPageOrg.loginPageId, loginPage.loginPageId)
        )
        .limit(1);

    if (!result) {
        return null;
    }

    return result?.loginPage;
}
