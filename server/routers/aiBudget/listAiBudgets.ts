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
import type { ListAiBudgetsResponse } from "@server/routers/aiBudget/types";

const paramsSchema = z.strictObject({
    orgId: z.string().nonempty()
});

const listSchema = z.object({
    pageSize: z.coerce
        .number<string>()
        .int()
        .positive()
        .optional()
        .catch(20)
        .default(20)
        .openapi({
            type: "integer",
            default: 20,
            description: "Number of items per page"
        }),
    page: z.coerce
        .number<string>()
        .int()
        .min(0)
        .optional()
        .catch(1)
        .default(1)
        .openapi({
            type: "integer",
            default: 1,
            description: "Page number to retrieve"
        })
});

registry.registerPath({
    method: "get",
    path: "/org/{orgId}/ai-budgets",
    description: "List AI budgets for an organization.",
    tags: [OpenAPITags.AiBudget],
    request: {
        params: paramsSchema,
        query: listSchema
    },
    responses: {
        200: {
            description: "Successful response"
        }
    }
});

export async function listAiBudgets(
    req: Request,
    res: Response,
    next: NextFunction
): Promise<any> {
    try {
        const parsedQuery = listSchema.safeParse(req.query);
        if (!parsedQuery.success) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    fromError(parsedQuery.error).toString()
                )
            );
        }

        const parsedParams = paramsSchema.safeParse(req.params);
        if (!parsedParams.success) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    fromError(parsedParams.error).toString()
                )
            );
        }

        const { orgId } = parsedParams.data;
        const { pageSize, page } = parsedQuery.data;

        const baseQuery = db
            .select()
            .from(aiBudgets)
            .where(eq(aiBudgets.orgId, orgId));

        const countQuery = db.$count(
            db
                .select()
                .from(aiBudgets)
                .where(eq(aiBudgets.orgId, orgId))
                .as("filtered_ai_budgets")
        );

        const [totalCount, rows] = await Promise.all([
            countQuery,
            baseQuery
                .limit(pageSize)
                .offset(pageSize * (page - 1))
                .orderBy(asc(aiBudgets.budgetId))
        ]);

        return response<ListAiBudgetsResponse>(res, {
            data: {
                budgets: rows,
                pagination: {
                    total: totalCount,
                    pageSize,
                    page
                }
            },
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
