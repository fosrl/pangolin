import { Request } from "express";
import { db, roles } from "@server/db";
import { and, eq, inArray } from "drizzle-orm";
import { getUserOrgRoleIds } from "@server/lib/userOrgRoles";

/**
 * Whether the caller of an org-scoped route is an administrator of the org:
 * a root API key, or a user holding a role with isAdmin set. Used to stop a
 * narrow custom role from handing out more than it holds.
 */
export async function callerIsOrgAdmin(
    req: Request,
    orgId: string
): Promise<boolean> {
    if (req.apiKey) {
        return req.apiKey.isRoot === true;
    }

    const userId = req.user?.userId;
    if (!userId) {
        return false;
    }

    const roleIds =
        req.userOrgRoleIds ?? (await getUserOrgRoleIds(userId, orgId));
    if (roleIds.length === 0) {
        return false;
    }

    const [adminRole] = await db
        .select({ roleId: roles.roleId })
        .from(roles)
        .where(
            and(
                inArray(roles.roleId, roleIds),
                eq(roles.orgId, orgId),
                eq(roles.isAdmin, true)
            )
        )
        .limit(1);

    return !!adminRole;
}
