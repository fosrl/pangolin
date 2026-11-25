import { Request, Response, NextFunction } from "express";
import { db } from "@server/db";
import { sites, apiKeyOrg } from "@server/db";
import { and, eq, or } from "drizzle-orm";
import createHttpError from "http-errors";
import HttpCode from "@server/types/HttpCode";
import { ownApiKeyOrg } from "@server/lib/requestAuthState";

export async function verifyApiKeySiteAccess(
    req: Request,
    res: Response,
    next: NextFunction
) {
    try {
        const apiKey = req.apiKey;
        const siteId = parseInt(
            req.params.siteId || req.body.siteId || req.query.siteId
        );

        if (!apiKey) {
            return next(
                createHttpError(HttpCode.UNAUTHORIZED, "Key not authenticated")
            );
        }

        if (isNaN(siteId)) {
            return next(
                createHttpError(HttpCode.BAD_REQUEST, "Invalid site ID")
            );
        }

        if (apiKey.isRoot) {
            // Root keys can access any key in any org
            return next();
        }

        const site = await db
            .select()
            .from(sites)
            .where(eq(sites.siteId, siteId))
            .limit(1);

        if (site.length === 0) {
            return next(
                createHttpError(
                    HttpCode.NOT_FOUND,
                    `Site with ID ${siteId} not found`
                )
            );
        }

        if (!site[0].orgId) {
            return next(
                createHttpError(
                    HttpCode.INTERNAL_SERVER_ERROR,
                    `Site with ID ${siteId} does not have an organization ID`
                )
            );
        }

        if (!ownApiKeyOrg(req)) {
            const apiKeyOrgRes = await db
                .select()
                .from(apiKeyOrg)
                .where(
                    and(
                        eq(apiKeyOrg.apiKeyId, apiKey.apiKeyId),
                        eq(apiKeyOrg.orgId, site[0].orgId)
                    )
                );
            req.apiKeyOrg = apiKeyOrgRes[0];
        }

        if (!req.apiKeyOrg || ownApiKeyOrg(req)?.orgId !== site[0].orgId) {
            return next(
                createHttpError(
                    HttpCode.FORBIDDEN,
                    "Key does not have access to this organization"
                )
            );
        }

        return next();
    } catch (error) {
        return next(
            createHttpError(
                HttpCode.INTERNAL_SERVER_ERROR,
                "Error verifying site access"
            )
        );
    }
}
