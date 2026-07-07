import { Request, Response, NextFunction } from "express";
import { db } from "@server/db";
import { userOrgs } from "@server/db";
import { and, eq } from "drizzle-orm";
import createHttpError from "http-errors";
import HttpCode from "@server/types/HttpCode";
import { getFirstString } from "@server/lib/requestParams";

export async function verifyUserIsOrgOwner(
    req: Request,
    res: Response,
    next: NextFunction
) {
    const userId = req.user!.userId;
    const orgId = getFirstString(req.params.orgId);

    if (!userId) {
        return next(
            createHttpError(HttpCode.UNAUTHORIZED, "User not authenticated")
        );
    }

    if (!orgId) {
        return next(
            createHttpError(
                HttpCode.BAD_REQUEST,
                "Organization ID not provided"
            )
        );
    }
    try {
        if (!req.userOrg) {
            const res = await db
                .select()
                .from(userOrgs)
                .where(
                    and(eq(userOrgs.userId, userId), eq(userOrgs.orgId, orgId))
                );
            req.userOrg = res[0];
        }

        if (!req.userOrg) {
            return next(
                createHttpError(
                    HttpCode.FORBIDDEN,
                    "User does not have access to this organization"
                )
            );
        }

        if (!req.userOrg.isOwner) {
            return next(
                createHttpError(
                    HttpCode.FORBIDDEN,
                    "User is not an organization owner"
                )
            );
        }

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
