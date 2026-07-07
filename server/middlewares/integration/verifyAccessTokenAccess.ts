import { Request, Response, NextFunction } from "express";
import { db } from "@server/db";
import { resourceAccessToken, resources, apiKeyOrg } from "@server/db";
import { and, eq } from "drizzle-orm";
import createHttpError from "http-errors";
import HttpCode from "@server/types/HttpCode";
import { getFirstString } from "@server/lib/requestParams";

export async function verifyApiKeyAccessTokenAccess(
    req: Request,
    res: Response,
    next: NextFunction
) {
    try {
        const apiKey = req.apiKey;
        const accessTokenId = getFirstString(req.params.accessTokenId);

        if (!apiKey) {
            return next(
                createHttpError(HttpCode.UNAUTHORIZED, "Key not authenticated")
            );
        }

        if (!accessTokenId) {
            return next(
                createHttpError(HttpCode.BAD_REQUEST, "Invalid access token ID")
            );
        }

        const [accessToken] = await db
            .select()
            .from(resourceAccessToken)
            .where(eq(resourceAccessToken.accessTokenId, accessTokenId))
            .limit(1);

        if (!accessToken) {
            return next(
                createHttpError(
                    HttpCode.NOT_FOUND,
                    `Access token with ID ${accessTokenId} not found`
                )
            );
        }

        const resourceId = accessToken.resourceId;

        if (!resourceId) {
            return next(
                createHttpError(
                    HttpCode.INTERNAL_SERVER_ERROR,
                    `Access token with ID ${accessTokenId} does not have a resource ID`
                )
            );
        }

        const [resource] = await db
            .select()
            .from(resources)
            .where(eq(resources.resourceId, resourceId))
            .limit(1);

        if (!resource) {
            return next(
                createHttpError(
                    HttpCode.NOT_FOUND,
                    `Resource with ID ${resourceId} not found`
                )
            );
        }

        if (!resource.orgId) {
            return next(
                createHttpError(
                    HttpCode.INTERNAL_SERVER_ERROR,
                    `Resource with ID ${resourceId} does not have an organization ID`
                )
            );
        }

        // Verify that the API key is linked to the resource's organization
        if (!req.apiKeyOrg) {
            const apiKeyOrgResult = await db
                .select()
                .from(apiKeyOrg)
                .where(
                    and(
                        eq(apiKeyOrg.apiKeyId, apiKey.apiKeyId),
                        eq(apiKeyOrg.orgId, resource.orgId)
                    )
                )
                .limit(1);

            if (apiKeyOrgResult.length > 0) {
                req.apiKeyOrg = apiKeyOrgResult[0];
            }
        }

        if (!req.apiKeyOrg) {
            return next(
                createHttpError(
                    HttpCode.FORBIDDEN,
                    "Key does not have access to this organization"
                )
            );
        }

        return next();
    } catch (e) {
        return next(
            createHttpError(
                HttpCode.INTERNAL_SERVER_ERROR,
                "Error verifying access token access"
            )
        );
    }
}
