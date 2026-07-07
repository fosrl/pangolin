import { Request, Response, NextFunction } from "express";
import { db } from "@server/db";
import { siteResources, apiKeyOrg } from "@server/db";
import { and, eq } from "drizzle-orm";
import createHttpError from "http-errors";
import HttpCode from "@server/types/HttpCode";
import { getFirstString } from "@server/lib/requestParams";

export async function verifyApiKeySiteResourceAccess(
    req: Request,
    res: Response,
    next: NextFunction
) {
    try {
        const apiKey = req.apiKey;
        const siteResourceIdRaw = getFirstString(req.params.siteResourceId);
        const siteResourceId = Number.parseInt(siteResourceIdRaw ?? "", 10);

        if (!apiKey) {
            return next(
                createHttpError(HttpCode.UNAUTHORIZED, "Key not authenticated")
            );
        }

        if (Number.isNaN(siteResourceId)) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    "Missing siteResourceId parameter"
                )
            );
        }

        if (apiKey.isRoot) {
            // Root keys can access any resource in any org
            return next();
        }

        // Check if the site resource exists and belongs to the specified site and org
        const [siteResource] = await db
            .select()
            .from(siteResources)
            .where(and(eq(siteResources.siteResourceId, siteResourceId)))
            .limit(1);

        if (!siteResource) {
            return next(
                createHttpError(HttpCode.NOT_FOUND, "Site resource not found")
            );
        }

        // Verify that the API key has access to the organization
        if (!req.apiKeyOrg) {
            const apiKeyOrgRes = await db
                .select()
                .from(apiKeyOrg)
                .where(
                    and(
                        eq(apiKeyOrg.apiKeyId, apiKey.apiKeyId),
                        eq(apiKeyOrg.orgId, siteResource.orgId)
                    )
                )
                .limit(1);

            if (apiKeyOrgRes.length === 0) {
                return next(
                    createHttpError(
                        HttpCode.FORBIDDEN,
                        "Key does not have access to this organization"
                    )
                );
            }

            req.apiKeyOrg = apiKeyOrgRes[0];
        }

        // Attach the siteResource to the request for use in the next middleware/route
        req.siteResource = siteResource;

        return next();
    } catch (error) {
        return next(
            createHttpError(
                HttpCode.INTERNAL_SERVER_ERROR,
                "Error verifying site resource access"
            )
        );
    }
}
