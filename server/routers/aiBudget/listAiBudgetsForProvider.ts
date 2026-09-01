import { Request, Response, NextFunction } from "express";
import { z } from "zod";
import { aiBudgets, db } from "@server/db";
import response from "@server/lib/response";
import HttpCode from "@server/types/HttpCode";
import createHttpError from "http-errors";
import logger from "@server/logger";
import { fromError } from "zod-validation-error";
import { OpenAPITags, registry } from "@server/openApi";
import { asc, eq } from "drizzle-orm";
import type { ListAiBudgetsByScopeResponse } from "@server/routers/aiBudget/types";

const paramsSchema = z.strictObject({
    providerId: z.coerce.number().int().positive()
});

registry.registerPath({
    method: "get",
    path: "/ai-provider/{providerId}/ai-budgets",
    description: "List AI budgets scoped to an AI provider.",
    tags: [OpenAPITags.AiBudget],
    request: {
        params: paramsSchema
    },
    responses: {
        200: {
            description: "Successful response"
        }
    }
});

export async function listAiBudgetsForProvider(
    req: Request,
    res: Response,
    next: NextFunction
): Promise<any> {
    try {
        const parsedParams = paramsSchema.safeParse(req.params);
        if (!parsedParams.success) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    fromError(parsedParams.error).toString()
                )
            );
        }

        const { providerId } = parsedParams.data;

        const budgets = await db
            .select()
            .from(aiBudgets)
            .where(eq(aiBudgets.providerId, providerId))
            .orderBy(asc(aiBudgets.budgetId));

        return response<ListAiBudgetsByScopeResponse>(res, {
            data: { budgets },
            success: true,
            error: false,
            message: "AI budgets retrieved successfully",
            status: HttpCode.OK
        });
    } catch (error) {
        logger.error(error);
        return next(
            createHttpError(HttpCode.INTERNAL_SERVER_ERROR, "An error occurred")
        );
    }
}
