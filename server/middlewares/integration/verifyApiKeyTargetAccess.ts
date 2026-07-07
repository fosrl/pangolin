import { Request, Response, NextFunction } from "express";
import { db } from "@server/db";
import { resources, targets, apiKeyOrg } from "@server/db";
import { and, eq } from "drizzle-orm";
import createHttpError from "http-errors";
import HttpCode from "@server/types/HttpCode";
import { getFirstString } from "@server/lib/requestParams";

export async function verifyApiKeyTargetAccess(
    req: Request,
    res: Response,
    next: NextFunction
) {
    try {
        const apiKey = req.apiKey;
        const targetIdRaw = getFirstString(req.params.targetId);
        const targetId = Number.parseInt(targetIdRaw ?? "", 10);

        if (!apiKey) {
            return next(
                createHttpError(HttpCode.UNAUTHORIZED, "Key not authenticated")
            );
        }

        if (Number.isNaN(targetId)) {
            return next(
                createHttpError(HttpCode.BAD_REQUEST, "Invalid target ID")
            );
        }

        const [target] = await db
            .select()
            .from(targets)
            .where(eq(targets.targetId, targetId))
            .limit(1);

        if (!target) {
            return next(
                createHttpError(
                    HttpCode.NOT_FOUND,
                    `Target with ID ${targetId} not found`
                )
            );
        }

        const resourceId = target.resourceId;
        if (!resourceId) {
            return next(
                createHttpError(
                    HttpCode.INTERNAL_SERVER_ERROR,
                    `Target with ID ${targetId} does not have a resource ID`
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
    } catch (error) {
        return next(
            createHttpError(
                HttpCode.INTERNAL_SERVER_ERROR,
                "Error verifying target access"
            )
        );
    }
}
