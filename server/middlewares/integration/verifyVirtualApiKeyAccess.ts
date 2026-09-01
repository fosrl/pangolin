import { Request, Response, NextFunction } from "express";
import { apiKeyOrg, db, virtualApiKeys } from "@server/db";
import { and, eq } from "drizzle-orm";
import createHttpError from "http-errors";
import HttpCode from "@server/types/HttpCode";
import { getFirstString } from "@server/lib/requestParams";

export async function verifyApiKeyVirtualApiKeyAccess(
    req: Request,
    res: Response,
    next: NextFunction
) {
    try {
        const apiKey = req.apiKey;
        const virtualApiKeyId = getFirstString(req.params.virtualApiKeyId);

        if (!apiKey) {
            return next(
                createHttpError(HttpCode.UNAUTHORIZED, "Key not authenticated")
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

        if (apiKey.isRoot) {
            req.virtualApiKey = key;
            return next();
        }

        const orgId = key.orgId;

        if (!req.apiKeyOrg || req.apiKeyOrg.orgId !== orgId) {
            const apiKeyOrgRes = await db
                .select()
                .from(apiKeyOrg)
                .where(
                    and(
                        eq(apiKeyOrg.apiKeyId, apiKey.apiKeyId),
                        eq(apiKeyOrg.orgId, orgId)
                    )
                )
                .limit(1);
            req.apiKeyOrg = apiKeyOrgRes[0];
        }

        if (!req.apiKeyOrg) {
            return next(
                createHttpError(
                    HttpCode.FORBIDDEN,
                    "Key does not have access to this organization"
                )
            );
        }

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
