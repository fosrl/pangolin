import { Request, Response, NextFunction } from "express";
import { AiProvider, aiProviders, apiKeyOrg, db } from "@server/db";
import { and, eq } from "drizzle-orm";
import createHttpError from "http-errors";
import HttpCode from "@server/types/HttpCode";
import { getFirstString } from "@server/lib/requestParams";

export async function verifyApiKeyAiProviderAccess(
    req: Request,
    res: Response,
    next: NextFunction
) {
    try {
        const apiKey = req.apiKey;
        const providerIdRaw = getFirstString(req.params.providerId);
        const niceId = getFirstString(req.params.niceId);
        const orgIdParam = getFirstString(req.params.orgId);

        if (!apiKey) {
            return next(
                createHttpError(HttpCode.UNAUTHORIZED, "Key not authenticated")
            );
        }

        let provider: AiProvider | undefined;

        if (niceId && orgIdParam) {
            const [providerRes] = await db
                .select()
                .from(aiProviders)
                .where(
                    and(
                        eq(aiProviders.niceId, niceId),
                        eq(aiProviders.orgId, orgIdParam)
                    )
                )
                .limit(1);
            provider = providerRes;
        } else {
            const providerId = Number.parseInt(providerIdRaw ?? "", 10);

            if (Number.isNaN(providerId)) {
                return next(
                    createHttpError(HttpCode.BAD_REQUEST, "Invalid provider ID")
                );
            }

            const [providerRes] = await db
                .select()
                .from(aiProviders)
                .where(eq(aiProviders.providerId, providerId))
                .limit(1);
            provider = providerRes;
        }

        if (!provider) {
            return next(
                createHttpError(
                    HttpCode.NOT_FOUND,
                    `AI provider with ID ${providerIdRaw || niceId} not found`
                )
            );
        }

        if (apiKey.isRoot) {
            req.aiProvider = provider;
            return next();
        }

        const orgId = provider.orgId;

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

        req.aiProvider = provider;
        return next();
    } catch (error) {
        return next(
            createHttpError(
                HttpCode.INTERNAL_SERVER_ERROR,
                "Error verifying AI provider access"
            )
        );
    }
}
