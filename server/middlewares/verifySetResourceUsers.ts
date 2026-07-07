import { Request, Response, NextFunction } from "express";
import { db } from "@server/db";
import { userOrgs } from "@server/db";
import { and, eq, inArray, or } from "drizzle-orm";
import createHttpError from "http-errors";
import HttpCode from "@server/types/HttpCode";
import { checkOrgAccessPolicy } from "#dynamic/lib/checkOrgAccessPolicy";

export async function verifySetResourceUsers(
    req: Request,
    res: Response,
    next: NextFunction
) {
    const userId = req.user!.userId;
    const userIds = req.body.userIds;

    if (!userId) {
        return next(
            createHttpError(HttpCode.UNAUTHORIZED, "User not authenticated")
        );
    }

    if (!req.userOrg) {
        return next(
            createHttpError(
                HttpCode.FORBIDDEN,
                "User does not have access to this user"
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

    if (!userIds) {
        return next(createHttpError(HttpCode.BAD_REQUEST, "Invalid user IDs"));
    }

    if (userIds.length === 0) {
        return next();
    }

    try {
        const orgId = req.userOrg.orgId;
        // get all userOrgs for the users
        const userOrgsData = await db
            .select()
            .from(userOrgs)
            .where(
                and(
                    inArray(userOrgs.userId, userIds),
                    eq(userOrgs.orgId, orgId)
                )
            );

        if (userOrgsData.length !== userIds.length) {
            return next(
                createHttpError(
                    HttpCode.FORBIDDEN,
                    "User does not have access to this user"
                )
            );
        }

        return next();
    } catch (error) {
        return next(
            createHttpError(
                HttpCode.INTERNAL_SERVER_ERROR,
                "Error checking if user has access to this user"
            )
        );
    }
}
