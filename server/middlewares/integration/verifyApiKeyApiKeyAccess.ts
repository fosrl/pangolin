import { Request, Response, NextFunction } from "express";
import { db } from "@server/db";
import { apiKeys, apiKeyOrg } from "@server/db";
import { and, eq, or } from "drizzle-orm";
import createHttpError from "http-errors";
import HttpCode from "@server/types/HttpCode";
import { getFirstString } from "@server/lib/requestParams";

export async function verifyApiKeyApiKeyAccess(
    req: Request,
    res: Response,
    next: NextFunction
) {
    try {
        const { apiKey: callerApiKey } = req;

        const apiKeyId =
            getFirstString(req.params.apiKeyId) ||
            getFirstString(req.body.apiKeyId) ||
            getFirstString(req.query.apiKeyId);
        const orgId = getFirstString(req.params.orgId);

        if (!callerApiKey) {
            return next(
                createHttpError(HttpCode.UNAUTHORIZED, "Key not authenticated")
            );
        }

        if (!orgId) {
            return next(
                createHttpError(HttpCode.BAD_REQUEST, "Invalid organization ID")
            );
        }

        if (!apiKeyId) {
            return next(
                createHttpError(HttpCode.BAD_REQUEST, "Invalid key ID")
            );
        }

        if (callerApiKey.isRoot) {
            // Root keys can access any key in any org
            return next();
        }

        const [callerApiKeyOrg] = await db
            .select()
            .from(apiKeyOrg)
            .where(
                and(
                    eq(apiKeys.apiKeyId, callerApiKey.apiKeyId),
                    eq(apiKeyOrg.orgId, orgId)
                )
            )
            .limit(1);

        if (!callerApiKeyOrg) {
            return next(
                createHttpError(
                    HttpCode.INTERNAL_SERVER_ERROR,
                    `API key with ID ${apiKeyId} does not have an organization ID`
                )
            );
        }

        const [otherApiKeyOrg] = await db
            .select()
            .from(apiKeyOrg)
            .where(
                and(eq(apiKeys.apiKeyId, apiKeyId), eq(apiKeyOrg.orgId, orgId))
            )
            .limit(1);

        if (!otherApiKeyOrg) {
            return next(
                createHttpError(
                    HttpCode.FORBIDDEN,
                    `API key with ID ${apiKeyId} does not have access to organization with ID ${orgId}`
                )
            );
        }

        return next();
    } catch (error) {
        return next(
            createHttpError(
                HttpCode.INTERNAL_SERVER_ERROR,
                "Error verifying key access"
            )
        );
    }
}
