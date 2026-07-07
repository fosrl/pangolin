import { db } from "@server/db";
import { actions, apiKeyActions, apiKeyOrg, apiKeys } from "@server/db";
import logger from "@server/logger";
import HttpCode from "@server/types/HttpCode";
import response from "@server/lib/response";
import { NextFunction, Request, Response } from "express";
import createHttpError from "http-errors";
import { z } from "zod";
import { fromError } from "zod-validation-error";
import { eq } from "drizzle-orm";
import { OpenAPITags, registry } from "@server/openApi";
import { createApiResponseSchema } from "@server/lib/openapi/createApiResponseSchema";

const paramsSchema = z.object({
    apiKeyId: z.string().nonempty()
});

const querySchema = z.strictObject({
    limit: z
        .string()
        .optional()
        .default("1000")
        .transform(Number)
        .pipe(z.int().positive()),
    offset: z
        .string()
        .optional()
        .default("0")
        .transform(Number)
        .pipe(z.int().nonnegative())
});

function queryActions(apiKeyId: string) {
    return db
        .select({
            actionId: actions.actionId
        })
        .from(apiKeyActions)
        .where(eq(apiKeyActions.apiKeyId, apiKeyId))
        .innerJoin(actions, eq(actions.actionId, apiKeyActions.actionId));
}

export type ListApiKeyActionsResponse = {
    actions: Awaited<ReturnType<typeof queryActions>>;
    pagination: { total: number; limit: number; offset: number };
};

const ListApiKeyActionsResponseDataSchema = z.object({
    actions: z.array(
        z.object({
            actionId: z.string()
        })
    ),
    pagination: z.object({
        total: z.number(),
        limit: z.number(),
        offset: z.number()
    })
});

registry.registerPath({
    method: "get",
    path: "/org/{orgId}/api-key/{apiKeyId}/actions",
    description: "List all actions set for an API key.",
    tags: [OpenAPITags.ApiKey],
    request: {
        params: paramsSchema,
        query: querySchema
    },
    responses: {
        200: {
            description: "Successful response",
            content: {
                "application/json": {
                    schema: createApiResponseSchema(
                        ListApiKeyActionsResponseDataSchema
                    )
                }
            }
        }
    }
});

export async function listApiKeyActions(
    req: Request,
    res: Response,
    next: NextFunction
): Promise<any> {
    try {
        const parsedQuery = querySchema.safeParse(req.query);
        if (!parsedQuery.success) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    fromError(parsedQuery.error)
                )
            );
        }

        const parsedParams = paramsSchema.safeParse(req.params);
        if (!parsedParams.success) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    fromError(parsedParams.error)
                )
            );
        }

        const { limit, offset } = parsedQuery.data;
        const { apiKeyId } = parsedParams.data;

        const baseQuery = queryActions(apiKeyId);

        const actionsList = await baseQuery.limit(limit).offset(offset);

        return response<ListApiKeyActionsResponse>(res, {
            data: {
                actions: actionsList,
                pagination: {
                    total: actionsList.length,
                    limit,
                    offset
                }
            },
            success: true,
            error: false,
            message: "API keys retrieved successfully",
            status: HttpCode.OK
        });
    } catch (error) {
        logger.error(error);
        return next(
            createHttpError(HttpCode.INTERNAL_SERVER_ERROR, "An error occurred")
        );
    }
}
