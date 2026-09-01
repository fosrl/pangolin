import { Request, Response, NextFunction } from "express";
import { z } from "zod";
import { aiProviders, db } from "@server/db";
import response from "@server/lib/response";
import HttpCode from "@server/types/HttpCode";
import createHttpError from "http-errors";
import logger from "@server/logger";
import { fromError } from "zod-validation-error";
import { OpenAPITags, registry } from "@server/openApi";
import { and, asc, eq, like, sql } from "drizzle-orm";
import type { ListAiProvidersResponse } from "@server/routers/aiProvider/types";
import { toPublicAiProvider } from "@server/routers/aiProvider/types";

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
        }),
    query: z.string().optional()
});

registry.registerPath({
    method: "get",
    path: "/org/{orgId}/ai-providers",
    description: "List AI providers for an organization.",
    tags: [OpenAPITags.AiProvider],
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

export async function listAiProviders(
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

        if (req.user && orgId && orgId !== req.userOrgId) {
            return next(
                createHttpError(
                    HttpCode.FORBIDDEN,
                    "User does not have access to this organization"
                )
            );
        }

        const { pageSize, page, query } = parsedQuery.data;
        const conditions = [eq(aiProviders.orgId, orgId)];

        if (query) {
            conditions.push(
                like(
                    sql`LOWER(${aiProviders.name})`,
                    "%" + query.toLowerCase() + "%"
                )
            );
        }

        const baseQuery = db
            .select()
            .from(aiProviders)
            .where(and(...conditions));

        const countQuery = db.$count(
            db
                .select()
                .from(aiProviders)
                .where(and(...conditions))
                .as("filtered_ai_providers")
        );

        const [totalCount, rows] = await Promise.all([
            countQuery,
            baseQuery
                .limit(pageSize)
                .offset(pageSize * (page - 1))
                .orderBy(asc(aiProviders.name))
        ]);

        return response<ListAiProvidersResponse>(res, {
            data: {
                providers: rows.map((row) => toPublicAiProvider(row)),
                pagination: {
                    total: totalCount,
                    pageSize,
                    page
                }
            },
            success: true,
            error: false,
            message: "AI providers retrieved successfully",
            status: HttpCode.OK
        });
    } catch (error) {
        logger.error(error);
        return next(
            createHttpError(HttpCode.INTERNAL_SERVER_ERROR, "An error occurred")
        );
    }
}
