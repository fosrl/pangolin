import { db, roleActions, roles, type Transaction } from "@server/db";
import logger from "@server/logger";
import { defaultRoleAllowedActions } from "@server/routers/role/createRole";
import { and, eq, inArray } from "drizzle-orm";
import {
    evaluateMappings,
    type MappingEvaluation
} from "@app/lib/idpMappingEval";

export { hydrateOrgMapping } from "@app/lib/idpMappingEval";

export type ResolvedRole = { roleId: number; name: string };

export type ResolvedOrgMembership =
    | {
          matched: true;
          /** Mapped roles that exist in the org. */
          roles: ResolvedRole[];
          /** Mapped role names that don't exist in the org yet, only with `createMissingRoles`. */
          missingRoleNames: string[];
          /** What each expression returned, for the test login. */
          trace: MappingEvaluation;
      }
    | {
          matched: false;
          reason:
              /** An expression is invalid (only with `throwOnExpressionError: false`). */
              | "expressionError"
              /** The org mapping didn't return `true` or the orgId. */
              | "orgMappingMismatch"
              /** No role mapping, or it returned no role names. */
              | "noRoleNames"
              /** The role names don't exist in the org (and `createMissingRoles` is off). */
              | "noMatchingRoles";
          roleNames?: string[];
          trace: MappingEvaluation;
      };

// same limit as the create role API
const MAX_ROLE_NAME_LENGTH = 255;

/**
 * Decides whether a user belongs to an org and with which roles, from their claims.
 * Shared by JIT (login) and directory sync, so both map a user the same way.
 *
 * - `orgMapping`: JMESPath that must return `true` or the orgId (`{{orgId}}` is
 *   replaced first). `null` means every user passes.
 * - `roleMapping`: stored role mapping (see `evaluateRoleMapping`). Without full
 *   RBAC, only the first role name is kept.
 * - `createMissingRoles`: role names that don't exist in the org are returned in
 *   `missingRoleNames` instead of being dropped. Nothing is written here: the
 *   caller creates them with `createRoles` when it applies the membership.
 * - `throwOnExpressionError`: an invalid expression throws (default, as login and
 *   sync always did) or, when `false`, returns `reason: "expressionError"`.
 */
export async function resolveOrgMembership({
    claims,
    orgId,
    orgMapping,
    roleMapping,
    supportsMultiRole,
    createMissingRoles,
    throwOnExpressionError = true
}: {
    claims: unknown;
    orgId: string;
    orgMapping: string | null | undefined;
    roleMapping: string | null | undefined;
    supportsMultiRole: boolean;
    createMissingRoles: boolean;
    throwOnExpressionError?: boolean;
}): Promise<ResolvedOrgMembership> {
    const trace = evaluateMappings({ claims, orgId, orgMapping, roleMapping });

    // the org mapping is checked first, so a role mapping error doesn't matter when it fails
    if (
        trace.orgMapping?.error ||
        (trace.orgMapping?.passed !== false && trace.roleMapping?.error)
    ) {
        const error = trace.orgMapping?.error ?? trace.roleMapping?.error;
        if (throwOnExpressionError) {
            throw new Error(error);
        }
        return { matched: false, reason: "expressionError", trace };
    }

    if (trace.orgMapping && !trace.orgMapping.passed) {
        return { matched: false, reason: "orgMappingMismatch", trace };
    }

    const roleNames = (trace.roleMapping?.roleNames ?? []).slice(
        0,
        supportsMultiRole ? undefined : 1
    );
    if (roleNames.length === 0) {
        return { matched: false, reason: "noRoleNames", trace };
    }

    const matchedRoles = await db
        .select({ roleId: roles.roleId, name: roles.name })
        .from(roles)
        .where(and(eq(roles.orgId, orgId), inArray(roles.name, roleNames)));

    const missingRoleNames = createMissingRoles
        ? roleNames.filter(
              (name) =>
                  name.length <= MAX_ROLE_NAME_LENGTH &&
                  !matchedRoles.some((role) => role.name === name)
          )
        : [];

    if (matchedRoles.length === 0 && missingRoleNames.length === 0) {
        return {
            matched: false,
            reason: "noMatchingRoles",
            roleNames,
            trace
        };
    }

    return { matched: true, roles: matchedRoles, missingRoleNames, trace };
}

/**
 * Creates the roles that don't exist in the org yet, with the default role
 * actions (same as the create role API), and returns every requested role.
 */
export async function createRoles(
    orgId: string,
    roleNames: string[],
    trx: Transaction | typeof db
): Promise<ResolvedRole[]> {
    const names = [...new Set(roleNames)];
    if (names.length === 0) {
        return [];
    }

    // re-check in the transaction: the role may have been created since it was resolved
    const existingRoles = await trx
        .select({ roleId: roles.roleId, name: roles.name })
        .from(roles)
        .where(and(eq(roles.orgId, orgId), inArray(roles.name, names)));

    const namesToCreate = names.filter(
        (name) => !existingRoles.some((role) => role.name === name)
    );
    if (namesToCreate.length === 0) {
        return existingRoles;
    }

    const createdRoles = await trx
        .insert(roles)
        .values(namesToCreate.map((name) => ({ orgId, name })))
        .returning({ roleId: roles.roleId, name: roles.name });

    await trx.insert(roleActions).values(
        createdRoles.flatMap((role) =>
            defaultRoleAllowedActions.map((action) => ({
                roleId: role.roleId,
                actionId: action,
                orgId
            }))
        )
    );

    logger.info(
        `IdP: created missing roles in org ${orgId}: ${createdRoles.map((r) => r.name).join(", ")}`
    );

    return [...existingRoles, ...createdRoles];
}
