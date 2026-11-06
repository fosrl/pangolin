import { db, roleActions, roles, type Transaction } from "@server/db";
import logger from "@server/logger";
import { defaultRoleAllowedActions } from "@server/routers/role/createRole";
import { and, eq, inArray } from "drizzle-orm";
import jmespath from "jmespath";
import { evaluateRoleMapping } from "./evaluateRoleMapping";

export type ResolvedRole = { roleId: number; name: string };

export type ResolvedOrgMembership =
    | {
          matched: true;
          /** Mapped roles that exist in the org. */
          roles: ResolvedRole[];
          /** Mapped role names that don't exist in the org yet, only with `createMissingRoles`. */
          missingRoleNames: string[];
      }
    | {
          matched: false;
          reason:
              /** The org mapping didn't return `true` or the orgId. */
              | "orgMappingMismatch"
              /** No role mapping, or it returned no role names. */
              | "noRoleNames"
              /** The role names don't exist in the org (and `createMissingRoles` is off). */
              | "noMatchingRoles";
          roleNames?: string[];
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
 */
export async function resolveOrgMembership({
    claims,
    orgId,
    orgMapping,
    roleMapping,
    supportsMultiRole,
    createMissingRoles
}: {
    claims: unknown;
    orgId: string;
    orgMapping: string | null | undefined;
    roleMapping: string | null | undefined;
    supportsMultiRole: boolean;
    createMissingRoles: boolean;
}): Promise<ResolvedOrgMembership> {
    const hydratedOrgMapping = hydrateOrgMapping(orgMapping, orgId);
    if (hydratedOrgMapping) {
        const result = jmespath.search(claims, hydratedOrgMapping);
        if (result !== true && result !== orgId) {
            return { matched: false, reason: "orgMappingMismatch" };
        }
    }

    const roleNames = evaluateRoleMapping(roleMapping, claims).slice(
        0,
        supportsMultiRole ? undefined : 1
    );
    if (roleNames.length === 0) {
        return { matched: false, reason: "noRoleNames" };
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
        return { matched: false, reason: "noMatchingRoles", roleNames };
    }

    return { matched: true, roles: matchedRoles, missingRoleNames };
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

export function hydrateOrgMapping(
    orgMapping: string | null | undefined,
    orgId: string
): string | undefined {
    if (!orgMapping) {
        return undefined;
    }
    return orgMapping.split("{{orgId}}").join(orgId);
}
