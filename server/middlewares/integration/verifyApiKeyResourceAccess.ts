import { Request, Response, NextFunction } from "express";
import { db } from "@server/db";
import { resources, apiKeyOrg } from "@server/db";
import { eq, and } from "drizzle-orm";
import createHttpError from "http-errors";
import HttpCode from "@server/types/HttpCode";
import { ownApiKeyOrg } from "@server/lib/requestAuthState";

export async function verifyApiKeyResourceAccess(
    req: Request,
    res: Response,
    next: NextFunction
) {
    const apiKey = req.apiKey;
    const resourceId =
        req.params.resourceId || req.body.resourceId || req.query.resourceId;

    if (!apiKey) {
        return next(
            createHttpError(HttpCode.UNAUTHORIZED, "Key not authenticated")
        );
    }

    try {
        // Retrieve the resource
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

        if (apiKey.isRoot) {
            // Root keys can access any key in any org
            return next();
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
        if (!ownApiKeyOrg(req)) {
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

        if (!req.apiKeyOrg || ownApiKeyOrg(req)?.orgId !== resource.orgId) {
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
                "Error verifying resource access"
            )
        );
    }
}
