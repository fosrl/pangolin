import { db, roles, userOrgRoles, userOrgs, users } from "@server/db";
import type { MappingEvaluation } from "@app/lib/idpMappingEval";
import { and, eq, inArray } from "drizzle-orm";
import {
    evaluateAutoProvisioning,
    getAutoProvisionCandidates,
    isLoginDenied,
    planMembershipChanges,
    resolveIdpIdentity,
    type CurrentMembership,
    type DesiredMembership,
    type IdpWithOidcConfig,
    type MappingSource,
    type ResolvedIdpIdentity
} from "./evaluateIdpLogin";

export type OidcTestOrgStatus =
    | "matched"
    | "noRoleMapping"
    | "expressionError"
    | "orgMappingMismatch"
    | "noRoleNames"
    | "noMatchingRoles";

export type OidcTestOrgChange =
    "add" | "updateRoles" | "remove" | "keptManual" | "none";

export type OidcTestOrgResult = {
    orgId: string;
    orgName: string;
    orgMapping: string | null;
    orgMappingSource: MappingSource | null;
    /** Stored role mapping (may carry the mapping builder wrapper). */
    roleMapping: string | null;
    roleMappingSource: MappingSource | null;
    createMissingRoles: boolean;
    supportsMultiRole: boolean;
    /** What each expression returned. `null` without a role mapping. */
    trace: MappingEvaluation | null;
    status: OidcTestOrgStatus;
    /** Role names the role mapping returned (after the single-role cap without full RBAC). */
    roleNames: string[];
    /** Mapped roles that exist in the org. */
    matchedRoleNames: string[];
    /** Mapped roles that don't exist yet and would be created. */
    missingRoleNames: string[];
    /** Whether the user is currently a member, and how. */
    currentMembership: "none" | "manual" | "autoManaged";
    currentRoleNames: string[];
    change: OidcTestOrgChange;
};

export type OidcTestWarning =
    | { code: "identifierNotFound"; path: string }
    | { code: "identifierPathError"; path: string; error: string }
    | { code: "emailNotFound"; path: string }
    | { code: "nameNotFound"; path: string }
    | { code: "noGroupsClaim" };

export type OidcTestResult = {
    idpId: number;
    idpName: string;
    /** Epoch ms. */
    testedAt: number;
    /** ID token claims, plus the groups added by the IdP API integration. */
    claims: Record<string, unknown>;
    /** Claim keys added or changed by the IdP API integration. */
    enrichedClaimKeys: string[];
    identity: ResolvedIdpIdentity & {
        identifierPath: string;
        emailPath: string | null;
        namePath: string | null;
    };
    autoProvision: boolean;
    /** The test only looked at this org (started from an org's settings). */
    scopedToOrgId: string | null;
    existingUser: boolean;
    /**
     * Whether a real login would succeed. `null` for an org-scoped test: it
     * depends on orgs the tester can't see.
     */
    loginOutcome: "allowed" | "denied" | null;
    orgs: OidcTestOrgResult[];
    warnings: OidcTestWarning[];
};

/**
 * Dry run of an OIDC login: everything `validateOidcCallback` decides, without
 * writing anything (no user, membership, role or session is created).
 */
export async function previewIdpLogin({
    existingIdp,
    claims,
    enrichedClaimKeys,
    onlyOrgId,
    testedAt = Date.now()
}: {
    existingIdp: IdpWithOidcConfig;
    /** ID token claims, plus the groups added by the IdP API integration. */
    claims: Record<string, unknown>;
    enrichedClaimKeys: string[];
    onlyOrgId?: string;
    /** When the claims were received (epoch ms). Defaults to now. */
    testedAt?: number;
}): Promise<OidcTestResult> {
    const { idp, idpOidcConfig } = existingIdp;
    const warnings: OidcTestWarning[] = [];

    let identity: ResolvedIdpIdentity = {
        identifier: null,
        email: null,
        name: null
    };
    try {
        identity = resolveIdpIdentity(claims, idpOidcConfig);
        if (!identity.identifier) {
            warnings.push({
                code: "identifierNotFound",
                path: idpOidcConfig.identifierPath
            });
        }
    } catch (e) {
        warnings.push({
            code: "identifierPathError",
            path: idpOidcConfig.identifierPath,
            error: e instanceof Error ? e.message : String(e)
        });
    }
    if (idpOidcConfig.emailPath && !identity.email) {
        warnings.push({ code: "emailNotFound", path: idpOidcConfig.emailPath });
    }
    if (idpOidcConfig.namePath && !identity.name) {
        warnings.push({ code: "nameNotFound", path: idpOidcConfig.namePath });
    }
    if (!Object.keys(claims).some((key) => /group|role/i.test(key))) {
        warnings.push({ code: "noGroupsClaim" });
    }

    const { shouldAutoProvision, candidates } =
        await getAutoProvisionCandidates(idp, { onlyOrgId });
    const evaluations = shouldAutoProvision
        ? await evaluateAutoProvisioning(claims, idp, candidates, {
              throwOnExpressionError: false
          })
        : [];

    // current memberships of the user, restricted to the tested org when scoped
    const [existingUser] = identity.identifier
        ? await db
              .select({ userId: users.userId })
              .from(users)
              .where(
                  and(
                      eq(users.username, identity.identifier),
                      eq(users.idpId, idp.idpId)
                  )
              )
        : [];

    let currentMemberships: (CurrentMembership & { roleNames: string[] })[] =
        [];
    if (existingUser) {
        const memberships = await db
            .select({
                orgId: userOrgs.orgId,
                autoManaged: userOrgs.autoManaged
            })
            .from(userOrgs)
            .where(
                and(
                    eq(userOrgs.userId, existingUser.userId),
                    onlyOrgId ? eq(userOrgs.orgId, onlyOrgId) : undefined
                )
            );
        const orgIds = memberships.map((m) => m.orgId);
        const roleRows = orgIds.length
            ? await db
                  .select({
                      orgId: userOrgRoles.orgId,
                      roleId: roles.roleId,
                      name: roles.name
                  })
                  .from(userOrgRoles)
                  .innerJoin(roles, eq(roles.roleId, userOrgRoles.roleId))
                  .where(
                      and(
                          eq(userOrgRoles.userId, existingUser.userId),
                          inArray(userOrgRoles.orgId, orgIds)
                      )
                  )
            : [];
        currentMemberships = memberships.map((m) => {
            const orgRoles = roleRows.filter((r) => r.orgId === m.orgId);
            return {
                ...m,
                roleIds: orgRoles.map((r) => r.roleId),
                roleNames: orgRoles.map((r) => r.name)
            };
        });
    }

    const desired: DesiredMembership[] = evaluations.flatMap((e) =>
        e.membership?.matched
            ? [
                  {
                      orgId: e.orgId,
                      roleIds: e.membership.roles.map((r) => r.roleId),
                      missingRoleNames: e.membership.missingRoleNames
                  }
              ]
            : []
    );
    const candidateOrgIds = new Set(candidates.map((c) => c.org.orgId));

    let loginOutcome: OidcTestResult["loginOutcome"];
    let removedOrgIds: string[];
    let changes = planMembershipChanges({
        currentMemberships,
        desired,
        candidateOrgIds
    });
    if (!identity.identifier) {
        loginOutcome = "denied";
        removedOrgIds = [];
    } else if (!shouldAutoProvision) {
        loginOutcome = onlyOrgId
            ? null
            : existingUser && currentMemberships.length > 0
              ? "allowed"
              : "denied";
        removedOrgIds = [];
        changes = { add: [], remove: [], updateRoles: [], keptManual: [] };
    } else {
        const denied = isLoginDenied({
            currentMemberships: existingUser ? currentMemberships : null,
            desired,
            candidateOrgIds
        });
        loginOutcome = onlyOrgId ? null : denied ? "denied" : "allowed";
        // a refused login removes every auto-managed membership
        removedOrgIds =
            denied && !onlyOrgId
                ? currentMemberships
                      .filter((m) => m.autoManaged === true)
                      .map((m) => m.orgId)
                : changes.remove;
    }

    const orgs: OidcTestOrgResult[] = evaluations.map((e) => {
        const membership = e.membership;
        const current = currentMemberships.find((m) => m.orgId === e.orgId);

        let change: OidcTestOrgChange = "none";
        if (identity.identifier) {
            if (removedOrgIds.includes(e.orgId)) change = "remove";
            else if (changes.add.some((a) => a.orgId === e.orgId))
                change = "add";
            else if (changes.updateRoles.some((u) => u.orgId === e.orgId))
                change = "updateRoles";
            else if (changes.keptManual.includes(e.orgId))
                change = "keptManual";
        }

        return {
            orgId: e.orgId,
            orgName: e.orgName,
            orgMapping: e.orgMapping,
            orgMappingSource: e.orgMappingSource,
            roleMapping: e.roleMapping,
            roleMappingSource: e.roleMappingSource,
            createMissingRoles: e.createMissingRoles,
            supportsMultiRole: e.supportsMultiRole,
            trace: membership?.trace ?? null,
            status: membership
                ? membership.matched
                    ? "matched"
                    : membership.reason
                : "noRoleMapping",
            roleNames: membership?.matched
                ? [
                      ...membership.roles.map((r) => r.name),
                      ...membership.missingRoleNames
                  ]
                : (membership?.roleNames ?? []),
            matchedRoleNames: membership?.matched
                ? membership.roles.map((r) => r.name)
                : [],
            missingRoleNames: membership?.matched
                ? membership.missingRoleNames
                : [],
            currentMembership: current
                ? current.autoManaged === true
                    ? "autoManaged"
                    : "manual"
                : "none",
            currentRoleNames: current?.roleNames ?? [],
            change
        };
    });

    return {
        idpId: idp.idpId,
        idpName: idp.name,
        testedAt,
        claims,
        enrichedClaimKeys,
        identity: {
            ...identity,
            identifierPath: idpOidcConfig.identifierPath,
            emailPath: idpOidcConfig.emailPath,
            namePath: idpOidcConfig.namePath
        },
        autoProvision: shouldAutoProvision,
        scopedToOrgId: onlyOrgId ?? null,
        existingUser: !!existingUser,
        loginOutcome,
        orgs,
        warnings
    };
}
