import { isLicensedOrSubscribed } from "#dynamic/lib/isLicencedOrSubscribed";
import {
    db,
    idpOrg,
    orgs,
    type Idp,
    type IdpOidcConfig,
    type Org
} from "@server/db";
import { tierMatrix } from "@server/lib/billing/tierMatrix";
import { isOrgIdentityProviderMode } from "@server/lib/idp/idpExistsForOrg";
import { and, eq } from "drizzle-orm";
import jmespath from "jmespath";
import {
    resolveOrgMembership,
    type ResolvedOrgMembership
} from "./resolveOrgMembership";

/**
 * The steps of an OIDC login that decide who the user is and which orgs and
 * roles they get. Shared by the real login (`validateOidcCallback`) and the
 * test login, so the test always shows what a real login would do.
 */

export type IdpWithOidcConfig = { idp: Idp; idpOidcConfig: IdpOidcConfig };
export type IdpOrgPolicy = typeof idpOrg.$inferSelect;

export type ResolvedIdpIdentity = {
    /** Lower-cased. `null` when the identifier path returns no string. */
    identifier: string | null;
    /** Lower-cased. */
    email: string | null;
    name: string | null;
};

/**
 * Reads the user identifier, email and name from the claims with the IdP's paths.
 * An invalid identifier path throws; email and name path errors are ignored.
 */
export function resolveIdpIdentity(
    claims: unknown,
    idpOidcConfig: IdpOidcConfig
): ResolvedIdpIdentity {
    const identifier = jmespath.search(claims, idpOidcConfig.identifierPath);

    let email: unknown = null;
    let name: unknown = null;
    try {
        if (idpOidcConfig.emailPath) {
            email = jmespath.search(claims, idpOidcConfig.emailPath);
        }
        if (idpOidcConfig.namePath) {
            name = jmespath.search(claims, idpOidcConfig.namePath);
        }
    } catch {}

    return {
        identifier:
            typeof identifier === "string" && identifier
                ? identifier.toLowerCase()
                : null,
        email: typeof email === "string" && email ? email.toLowerCase() : null,
        name: typeof name === "string" && name ? name : null
    };
}

export type AutoProvisionCandidate = {
    org: Org;
    /** The org's policy for this IdP, if any. Missing values fall back to the IdP defaults. */
    policy: IdpOrgPolicy | undefined;
};

/**
 * The orgs the user can be auto-provisioned into.
 * - Org identity provider mode: the linked orgs that enable auto-provision.
 * - Global mode: every org, when the IdP enables auto-provision.
 *
 * `onlyOrgId` restricts the result to one org (test login from an org's settings).
 */
export async function getAutoProvisionCandidates(
    existingIdp: Idp,
    { onlyOrgId }: { onlyOrgId?: string } = {}
): Promise<{
    shouldAutoProvision: boolean;
    candidates: AutoProvisionCandidate[];
}> {
    if (isOrgIdentityProviderMode()) {
        const rows = await db
            .select()
            .from(idpOrg)
            .innerJoin(orgs, eq(orgs.orgId, idpOrg.orgId))
            .where(
                and(
                    eq(idpOrg.idpId, existingIdp.idpId),
                    onlyOrgId ? eq(idpOrg.orgId, onlyOrgId) : undefined
                )
            );

        // Enter auto-provision sync if any linked org enables it;
        // only those orgs are candidates for provisioning.
        const enabled = rows.filter((row) => row.idpOrg.autoProvision);
        return {
            shouldAutoProvision: enabled.length > 0,
            candidates: enabled.map((row) => ({
                org: row.orgs,
                policy: row.idpOrg
            }))
        };
    }

    if (!existingIdp.autoProvision) {
        return { shouldAutoProvision: false, candidates: [] };
    }

    const [allOrgs, policies] = await Promise.all([
        db
            .select()
            .from(orgs)
            .where(onlyOrgId ? eq(orgs.orgId, onlyOrgId) : undefined),
        db.select().from(idpOrg).where(eq(idpOrg.idpId, existingIdp.idpId))
    ]);
    const policyByOrgId = new Map(policies.map((p) => [p.orgId, p]));

    return {
        shouldAutoProvision: true,
        candidates: allOrgs.map((org) => ({
            org,
            policy: policyByOrgId.get(org.orgId)
        }))
    };
}

export type MappingSource = "org" | "default";

export type OrgProvisioningEvaluation = {
    orgId: string;
    orgName: string;
    orgMapping: string | null;
    orgMappingSource: MappingSource | null;
    roleMapping: string | null;
    roleMappingSource: MappingSource | null;
    createMissingRoles: boolean;
    /** Without full RBAC only the first mapped role is kept. */
    supportsMultiRole: boolean;
    /** `null` when there is no role mapping: the user is never provisioned in the org. */
    membership: ResolvedOrgMembership | null;
};

/** Runs the org's policy (or the IdP defaults) on the claims, for every candidate org. */
export async function evaluateAutoProvisioning(
    claims: unknown,
    existingIdp: Idp,
    candidates: AutoProvisionCandidate[],
    { throwOnExpressionError = true }: { throwOnExpressionError?: boolean } = {}
): Promise<OrgProvisioningEvaluation[]> {
    const results: OrgProvisioningEvaluation[] = [];

    for (const { org, policy } of candidates) {
        const orgMapping =
            policy?.orgMapping || existingIdp.defaultOrgMapping || null;
        const roleMapping =
            policy?.roleMapping || existingIdp.defaultRoleMapping || null;
        // follows the role mapping: the org policy's flag, or the IdP default
        const createMissingRoles = policy?.roleMapping
            ? policy.createMissingRoles
            : existingIdp.defaultCreateMissingRoles;

        const base = {
            orgId: org.orgId,
            orgName: org.name,
            orgMapping,
            orgMappingSource: policy?.orgMapping
                ? ("org" as const)
                : orgMapping
                  ? ("default" as const)
                  : null,
            roleMapping,
            roleMappingSource: policy?.roleMapping
                ? ("org" as const)
                : roleMapping
                  ? ("default" as const)
                  : null,
            createMissingRoles
        };

        // without a role mapping, the user is never provisioned in the org
        if (!roleMapping) {
            results.push({
                ...base,
                supportsMultiRole: false,
                membership: null
            });
            continue;
        }

        const supportsMultiRole = await isLicensedOrSubscribed(
            org.orgId,
            tierMatrix.fullRbac
        );

        const membership = await resolveOrgMembership({
            claims,
            orgId: org.orgId,
            orgMapping,
            roleMapping,
            supportsMultiRole,
            createMissingRoles,
            throwOnExpressionError
        });

        results.push({ ...base, supportsMultiRole, membership });
    }

    return results;
}

export * from "./membershipChanges";
