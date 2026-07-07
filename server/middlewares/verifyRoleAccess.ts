import { Request, Response, NextFunction } from "express";
import { db } from "@server/db";
import { roles, userOrgs } from "@server/db";
import { and, eq, inArray } from "drizzle-orm";
import createHttpError from "http-errors";
import HttpCode from "@server/types/HttpCode";
import logger from "@server/logger";
import { checkOrgAccessPolicy } from "#dynamic/lib/checkOrgAccessPolicy";
import { getUserOrgRoleIds } from "@server/lib/userOrgRoles";

export async function verifyRoleAccess(
    req: Request,
    res: Response,
    next: NextFunction
) {
    const userId = req.user?.userId;
    const singleRoleId = parseInt(
        req.params.roleId || req.body.roleId || req.query.roleId
    );

    if (!userId) {
        return next(
            createHttpError(HttpCode.UNAUTHORIZED, "User not authenticated")
        );
    }

    let allRoleIds: number[] = [];
    if (!isNaN(singleRoleId)) {
        // If roleId is provided in URL params, query params, or body (single), use it exclusively
        allRoleIds = [singleRoleId];
    } else if (req.body?.roleIds) {
        // Only use body.roleIds if no single roleId was provided
        allRoleIds = req.body.roleIds;
    }

    if (allRoleIds.length === 0) {
        return next();
    }

    try {
        const rolesData = await db
            .select()
            .from(roles)
            .where(inArray(roles.roleId, allRoleIds));

        if (rolesData.length !== allRoleIds.length) {
            return next(
                createHttpError(
                    HttpCode.NOT_FOUND,
                    "One or more roles not found"
                )
            );
        }

        const orgIds = new Set(rolesData.map((role) => role.orgId));

        // Check user access to each role's organization
        for (const role of rolesData) {
            const userOrgRole = await db
                .select()
                .from(userOrgs)
                .where(
                    and(
                        eq(userOrgs.userId, userId),
                        eq(userOrgs.orgId, role.orgId!)
                    )
                )
                .limit(1);

            if (userOrgRole.length === 0) {
                return next(
                    createHttpError(
                        HttpCode.FORBIDDEN,
                        `User does not have access to organization for role ID ${role.roleId}`
                    )
                );
            }

            req.userOrgId = role.orgId;
        }

        if (orgIds.size > 1) {
            return next(
                createHttpError(
                    HttpCode.FORBIDDEN,
                    "Roles must belong to the same organization"
                )
            );
        }

        const orgId = orgIds.values().next().value;

        if (!orgId) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    "Organization ID not found"
                )
            );
        }

        if (!req.userOrg) {
            const userOrg = await db
                .select()
                .from(userOrgs)
                .where(
                    and(eq(userOrgs.userId, userId), eq(userOrgs.orgId, orgId!))
                )
                .limit(1);

            req.userOrg = userOrg[0];
            req.userOrgRoleIds = await getUserOrgRoleIds(userId, orgId!);
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

        return next();
    } catch (error) {
        logger.error("Error verifying role access:", error);
        return next(
            createHttpError(
                HttpCode.INTERNAL_SERVER_ERROR,
                "Error verifying role access"
            )
        );
    }
}
