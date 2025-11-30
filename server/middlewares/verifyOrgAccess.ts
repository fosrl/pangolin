import { Request, Response, NextFunction } from "express";
import { db, orgs } from "@server/db";
import { userOrgs } from "@server/db";
import { and, eq } from "drizzle-orm";
import createHttpError from "http-errors";
import HttpCode from "@server/types/HttpCode";
import { checkOrgAccessPolicy } from "#dynamic/lib/checkOrgAccessPolicy";
import logger from "@server/logger";

export async function verifyOrgAccess(
    req: Request,
    res: Response,
    next: NextFunction
) {
    const userId = req.user!.userId;
    const orgId = req.params.orgId;

    if (!userId) {
        return next(
            createHttpError(HttpCode.UNAUTHORIZED, "User not authenticated")
        );
    }

    if (!orgId) {
        return next(
            createHttpError(HttpCode.BAD_REQUEST, "Invalid organization ID")
        );
    }

    try {
        if (!req.userOrg) {
            const userOrgRes = await db
                .select()
                .from(userOrgs)
                .where(
                    and(eq(userOrgs.userId, userId), eq(userOrgs.orgId, orgId))
                );
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

        const policyCheck = await checkOrgAccessPolicy({
            orgId,
            userId,
            session: req.session
        });

        logger.debug("Org check policy result", { policyCheck });

        if (!policyCheck.allowed || policyCheck.error) {
            return next(
                createHttpError(
                    HttpCode.FORBIDDEN,
                    "Failed organization access policy check: " +
                        (policyCheck.error || "Unknown error")
                )
            );
        }

        // User has access, attach the user's role to the request for potential future use
        req.userOrgRoleId = req.userOrg.roleId;
        req.userOrgId = orgId;
        return next();
    } catch (e) {
        return next(
            createHttpError(
                HttpCode.INTERNAL_SERVER_ERROR,
                "Error verifying organization access"
            )
        );
    }
}
