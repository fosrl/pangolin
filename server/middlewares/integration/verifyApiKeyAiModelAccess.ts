import { Request, Response, NextFunction } from "express";
import { aiModels, aiProviders, apiKeyOrg, db } from "@server/db";
import { and, eq } from "drizzle-orm";
import createHttpError from "http-errors";
import HttpCode from "@server/types/HttpCode";
import { getFirstString } from "@server/lib/requestParams";

export async function verifyApiKeyAiModelAccess(
    req: Request,
    res: Response,
    next: NextFunction
) {
    try {
        const apiKey = req.apiKey;
        const modelIdRaw = getFirstString(req.params.modelId);
        const modelId = Number.parseInt(modelIdRaw ?? "", 10);

        if (!apiKey) {
            return next(
                createHttpError(HttpCode.UNAUTHORIZED, "Key not authenticated")
            );
        }

        if (Number.isNaN(modelId)) {
            return next(
                createHttpError(HttpCode.BAD_REQUEST, "Invalid model ID")
            );
        }

        const [row] = await db
            .select({
                model: aiModels,
                provider: aiProviders
            })
            .from(aiModels)
            .innerJoin(
                aiProviders,
                eq(aiModels.providerId, aiProviders.providerId)
            )
            .where(eq(aiModels.modelId, modelId))
            .limit(1);

        if (!row) {
            return next(
                createHttpError(
                    HttpCode.NOT_FOUND,
                    `AI model with ID ${modelId} not found`
                )
            );
        }

        if (apiKey.isRoot) {
            req.aiProvider = row.provider;
            req.aiModel = row.model;
            return next();
        }

        const orgId = row.provider.orgId;

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

        req.aiProvider = row.provider;
        req.aiModel = row.model;
        return next();
    } catch (error) {
        return next(
            createHttpError(
                HttpCode.INTERNAL_SERVER_ERROR,
                "Error verifying AI model access"
            )
        );
    }
}
