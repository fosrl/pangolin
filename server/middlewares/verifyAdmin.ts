import { Request, Response, NextFunction } from "express";
import { db } from "@server/db";
import { roles, userOrgs } from "@server/db";
import { and, eq, inArray } from "drizzle-orm";
import createHttpError from "http-errors";
import HttpCode from "@server/types/HttpCode";
import { checkOrgAccessPolicy } from "#dynamic/lib/checkOrgAccessPolicy";
import { getUserOrgRoleIds } from "@server/lib/userOrgRoles";

export async function verifyAdmin(
    req: Request,
    res: Response,
    next: NextFunction
) {
    const userId = req.user?.userId;
    const orgId = req.userOrgId;

    if (!orgId) {
        return next(
            createHttpError(HttpCode.UNAUTHORIZED, "User does not have orgId")
        );
    }

    if (!userId) {
        return next(
            createHttpError(HttpCode.UNAUTHORIZED, "User not authenticated")
        );
    }

    if (!req.userOrg) {
        const userOrgRes = await db
            .select()
            .from(userOrgs)
            .where(and(eq(userOrgs.userId, userId), eq(userOrgs.orgId, orgId!)))
            .limit(1);
        req.userOrg = userOrgRes[0];
    }

    if (!req.userOrg) {
        return next(
            createHttpError(
                HttpCode.FORBIDDEN,
                "User does not have access to this organization"
            )
        );
    }

    if (req.orgPolicyAllowed === undefined && req.userOrg.orgId) {
        const policyCheck = await checkOrgAccessPolicy({
            orgId: req.userOrg.orgId,
            userId,
            session: req.session
        });
        req.orgPolicyAllowed = policyCheck.allowed;
        if (!policyCheck.allowed || policyCheck.error) {
            return next(
                createHttpError(
                    HttpCode.FORBIDDEN,
                    "" + (policyCheck.error || "Unknown error")
                )
            );
        }
    }

    req.userOrgRoleIds = await getUserOrgRoleIds(req.userOrg.userId, orgId!);

    if (req.userOrgRoleIds.length === 0) {
        return next(
            createHttpError(
                HttpCode.FORBIDDEN,
                "User does not have Admin access"
            )
        );
    }

    const userAdminRoles = await db
        .select()
        .from(roles)
        .where(
            and(
                inArray(roles.roleId, req.userOrgRoleIds),
                eq(roles.isAdmin, true)
            )
        )
        .limit(1);

    if (userAdminRoles.length === 0) {
        return next(
            createHttpError(
                HttpCode.FORBIDDEN,
                "User does not have Admin access"
            )
        );
    }

    return next();
}
