import { Request, Response, NextFunction } from "express";
import { z } from "zod";
import { aiModels, aiProviders, db } from "@server/db";
import response from "@server/lib/response";
import HttpCode from "@server/types/HttpCode";
import createHttpError from "http-errors";
import logger from "@server/logger";
import { fromError } from "zod-validation-error";
import { OpenAPITags, registry } from "@server/openApi";
import { and, asc, eq, like, sql } from "drizzle-orm";
import type { ListAiModelsResponse } from "@server/routers/aiProvider/types";

const paramsSchema = z.strictObject({
    providerId: z.coerce.number().int().positive()
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
        }),
    query: z.string().optional()
});

registry.registerPath({
    method: "get",
    path: "/ai-provider/{providerId}/models",
    description: "List AI models for a provider.",
    tags: [OpenAPITags.AiModel],
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

export async function listAiModels(
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

        const { providerId } = parsedParams.data;

        const [provider] =
            req.aiProvider && req.aiProvider.providerId === providerId
                ? [req.aiProvider]
                : await db
                      .select({ providerId: aiProviders.providerId })
                      .from(aiProviders)
                      .where(eq(aiProviders.providerId, providerId))
                      .limit(1);

        if (!provider) {
            return next(
                createHttpError(
                    HttpCode.NOT_FOUND,
                    `AI provider with ID ${providerId} not found`
                )
            );
        }

        const { pageSize, page, query } = parsedQuery.data;
        const conditions = [eq(aiModels.providerId, providerId)];

        if (query) {
            conditions.push(
                like(
                    sql`LOWER(${aiModels.name})`,
                    "%" + query.toLowerCase() + "%"
                )
            );
        }

        const baseQuery = db
            .select()
            .from(aiModels)
            .where(and(...conditions));

        const countQuery = db.$count(
            db
                .select()
                .from(aiModels)
                .where(and(...conditions))
                .as("filtered_ai_models")
        );

        const [totalCount, rows] = await Promise.all([
            countQuery,
            baseQuery
                .limit(pageSize)
                .offset(pageSize * (page - 1))
                .orderBy(asc(aiModels.name))
        ]);

        return response<ListAiModelsResponse>(res, {
            data: {
                models: rows,
                pagination: {
                    total: totalCount,
                    pageSize,
                    page
                }
            },
            success: true,
            error: false,
            message: "AI models retrieved successfully",
            status: HttpCode.OK
        });
    } catch (error) {
        logger.error(error);
        return next(
            createHttpError(HttpCode.INTERNAL_SERVER_ERROR, "An error occurred")
        );
    }
}
