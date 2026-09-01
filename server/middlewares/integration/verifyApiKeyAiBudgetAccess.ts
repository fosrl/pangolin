import { Request, Response, NextFunction } from "express";
import { aiBudgets, apiKeyOrg, db } from "@server/db";
import { and, eq } from "drizzle-orm";
import createHttpError from "http-errors";
import HttpCode from "@server/types/HttpCode";
import { getFirstString } from "@server/lib/requestParams";

export async function verifyApiKeyAiBudgetAccess(
    req: Request,
    res: Response,
    next: NextFunction
) {
    try {
        const apiKey = req.apiKey;
        const budgetIdRaw = getFirstString(req.params.budgetId);
        const budgetId = Number.parseInt(budgetIdRaw ?? "", 10);

        if (!apiKey) {
            return next(
                createHttpError(HttpCode.UNAUTHORIZED, "Key not authenticated")
            );
        }

        if (Number.isNaN(budgetId)) {
            return next(
                createHttpError(HttpCode.BAD_REQUEST, "Invalid budget ID")
            );
        }

        const [budget] = await db
            .select()
            .from(aiBudgets)
            .where(eq(aiBudgets.budgetId, budgetId))
            .limit(1);

        if (!budget) {
            return next(
                createHttpError(
                    HttpCode.NOT_FOUND,
                    `AI budget with ID ${budgetId} not found`
                )
            );
        }

        if (apiKey.isRoot) {
            req.aiBudget = budget;
            return next();
        }

        const orgId = budget.orgId;

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

        req.aiBudget = budget;
        return next();
    } catch (error) {
        return next(
            createHttpError(
                HttpCode.INTERNAL_SERVER_ERROR,
                "Error verifying AI budget access"
            )
        );
    }
}
