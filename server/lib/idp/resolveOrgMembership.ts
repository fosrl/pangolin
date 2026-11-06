import { db, roles } from "@server/db";
import { and, eq, inArray } from "drizzle-orm";
import jmespath from "jmespath";
import { evaluateRoleMapping } from "./evaluateRoleMapping";

export type ResolvedRole = { roleId: number; name: string };

export type ResolvedOrgMembership =
    | { matched: true; roles: ResolvedRole[] }
    | {
          matched: false;
          reason:
              /** The org mapping didn't return `true` or the orgId. */
              | "orgMappingMismatch"
              /** No role mapping, or it returned no role names. */
              | "noRoleNames"
              /** The role names don't exist in the org. */
              | "noMatchingRoles";
          roleNames?: string[];
      };

/**
 * Decides whether a user belongs to an org and with which roles, from their claims.
 * Shared by JIT (login) and directory sync, so both map a user the same way.
 *
 * - `orgMapping`: JMESPath that must return `true` or the orgId (`{{orgId}}` is
 *   replaced first). `null` means every user passes.
 * - `roleMapping`: stored role mapping (see `evaluateRoleMapping`). Without full
 *   RBAC, only the first role name is kept. Only roles that exist in the org are returned.
 */
export async function resolveOrgMembership({
    claims,
    orgId,
    orgMapping,
    roleMapping,
    supportsMultiRole
}: {
    claims: unknown;
    orgId: string;
    orgMapping: string | null | undefined;
    roleMapping: string | null | undefined;
    supportsMultiRole: boolean;
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

    if (matchedRoles.length === 0) {
        return { matched: false, reason: "noMatchingRoles", roleNames };
    }

    return { matched: true, roles: matchedRoles };
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
