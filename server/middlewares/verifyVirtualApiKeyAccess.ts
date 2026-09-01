import { Request, Response, NextFunction } from "express";
import { db, userOrgs, virtualApiKeys } from "@server/db";
import { and, eq } from "drizzle-orm";
import createHttpError from "http-errors";
import HttpCode from "@server/types/HttpCode";
import { checkOrgAccessPolicy } from "#dynamic/lib/checkOrgAccessPolicy";
import { getUserOrgRoleIds } from "@server/lib/userOrgRoles";
import { getFirstString } from "@server/lib/requestParams";

export async function verifyVirtualApiKeyAccess(
    req: Request,
    res: Response,
    next: NextFunction
) {
    try {
        const userId = req.user!.userId;
        const virtualApiKeyId = getFirstString(req.params.virtualApiKeyId);

        if (!userId) {
            return next(
                createHttpError(HttpCode.UNAUTHORIZED, "User not authenticated")
            );
        }

        if (!virtualApiKeyId) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    "Invalid virtual API key ID"
                )
            );
        }

        const [key] = await db
            .select()
            .from(virtualApiKeys)
            .where(eq(virtualApiKeys.virtualApiKeyId, virtualApiKeyId))
            .limit(1);

        if (!key || key.kind !== "manual") {
            return next(
                createHttpError(
                    HttpCode.NOT_FOUND,
                    `Virtual API key with ID ${virtualApiKeyId} not found`
                )
            );
        }

        const orgId = key.orgId;

        if (!req.userOrg || req.userOrg.orgId !== orgId) {
            const userOrgRole = await db
                .select()
                .from(userOrgs)
                .where(
                    and(eq(userOrgs.userId, userId), eq(userOrgs.orgId, orgId))
                )
                .limit(1);
            req.userOrg = userOrgRole[0];
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

        req.userOrgId = orgId;
        req.userOrgRoleIds = await getUserOrgRoleIds(req.userOrg.userId, orgId);
        req.virtualApiKey = key;

        return next();
    } catch (error) {
        return next(
            createHttpError(
                HttpCode.INTERNAL_SERVER_ERROR,
                "Error verifying virtual API key access"
            )
        );
    }
}
