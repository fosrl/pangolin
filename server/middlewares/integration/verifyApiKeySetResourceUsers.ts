import { Request, Response, NextFunction } from "express";
import { db } from "@server/db";
import { userOrgs } from "@server/db";
import { and, eq, inArray } from "drizzle-orm";
import createHttpError from "http-errors";
import HttpCode from "@server/types/HttpCode";
import { ownApiKeyOrg } from "@server/lib/requestAuthState";

export async function verifyApiKeySetResourceUsers(
    req: Request,
    res: Response,
    next: NextFunction
) {
    const apiKey = req.apiKey;
    const singleUserId =
        req.params.userId || req.body.userId || req.query.userId;
    const { userIds } = req.body;
    const allUserIds = userIds || (singleUserId ? [singleUserId] : []);

    if (!apiKey) {
        return next(
            createHttpError(HttpCode.UNAUTHORIZED, "Key not authenticated")
        );
    }

    if (apiKey.isRoot) {
        // Root keys can access any key in any org
        return next();
    }

    if (!req.apiKeyOrg || !ownApiKeyOrg(req)) {
        return next(
            createHttpError(
                HttpCode.FORBIDDEN,
                "Key does not have access to this organization"
            )
        );
    }

    if (allUserIds.length === 0) {
        return next();
    }

    try {
        const orgId = req.apiKeyOrg.orgId;
        const userOrgsData = await db
            .select()
            .from(userOrgs)
            .where(
                and(
                    inArray(userOrgs.userId, allUserIds),
                    eq(userOrgs.orgId, orgId)
                )
            );

        if (userOrgsData.length !== allUserIds.length) {
            return next(
                createHttpError(
                    HttpCode.FORBIDDEN,
                    "Key does not have access to one or more specified users"
                )
            );
        }

        return next();
    } catch (error) {
        return next(
            createHttpError(
                HttpCode.INTERNAL_SERVER_ERROR,
                "Error checking if key has access to the specified users"
            )
        );
    }
}
