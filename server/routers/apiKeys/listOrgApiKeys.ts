import { db } from "@server/db";
import { apiKeyOrg, apiKeys } from "@server/db";
import logger from "@server/logger";
import HttpCode from "@server/types/HttpCode";
import response from "@server/lib/response";
import { NextFunction, Request, Response } from "express";
import createHttpError from "http-errors";
import { z } from "zod";
import { fromError } from "zod-validation-error";
import { eq, and } from "drizzle-orm";
import { OpenAPITags, registry } from "@server/openApi";
import { createApiResponseSchema } from "@server/lib/openapi/createApiResponseSchema";

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

const paramsSchema = z.object({
    orgId: z.string()
});

function queryApiKeys(orgId: string) {
    return db
        .select({
            apiKeyId: apiKeys.apiKeyId,
            orgId: apiKeyOrg.orgId,
            lastChars: apiKeys.lastChars,
            createdAt: apiKeys.createdAt,
            name: apiKeys.name
        })
        .from(apiKeyOrg)
        .where(and(eq(apiKeyOrg.orgId, orgId), eq(apiKeys.isRoot, false)))
        .innerJoin(apiKeys, eq(apiKeys.apiKeyId, apiKeyOrg.apiKeyId));
}

export type ListOrgApiKeysResponse = {
    apiKeys: Awaited<ReturnType<typeof queryApiKeys>>;
    pagination: { total: number; limit: number; offset: number };
};

const ListOrgApiKeysResponseDataSchema = z.object({
    apiKeys: z.array(
        z.object({
            apiKeyId: z.string(),
            orgId: z.string(),
            lastChars: z.string(),
            createdAt: z.string(),
            name: z.string()
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
    path: "/org/{orgId}/api-keys",
    description: "List all API keys for an organization",
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
                        ListOrgApiKeysResponseDataSchema
                    )
                }
            }
        }
    }
});

export async function listOrgApiKeys(
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
        const { orgId } = parsedParams.data;

        const baseQuery = queryApiKeys(orgId);

        const apiKeysList = await baseQuery.limit(limit).offset(offset);

        return response<ListOrgApiKeysResponse>(res, {
            data: {
                apiKeys: apiKeysList,
                pagination: {
                    total: apiKeysList.length,
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
