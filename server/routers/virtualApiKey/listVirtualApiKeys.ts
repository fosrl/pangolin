import { Request, Response, NextFunction } from "express";
import { z } from "zod";
import {
    db,
    virtualApiKeyResources,
    virtualApiKeys,
    type VirtualApiKey
} from "@server/db";
import response from "@server/lib/response";
import HttpCode from "@server/types/HttpCode";
import createHttpError from "http-errors";
import logger from "@server/logger";
import { fromError } from "zod-validation-error";
import { OpenAPITags, registry } from "@server/openApi";
import { and, asc, eq, exists, inArray, like, or, sql } from "drizzle-orm";
import { toPublicVirtualApiKey } from "@server/lib/virtualApiKey";
import type { ListVirtualApiKeysResponse } from "@server/routers/virtualApiKey/types";

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
    search: z.string().optional(),
    userId: z.string().optional(),
    resourceId: z.coerce.number().int().positive().optional()
});

registry.registerPath({
    method: "get",
    path: "/org/{orgId}/virtual-api-keys",
    description: "List manual virtual API keys for an organization.",
    tags: [OpenAPITags.VirtualApiKey],
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

export async function listVirtualApiKeys(
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

        const { pageSize, page, search, userId, resourceId } = parsedQuery.data;
        const conditions = [
            eq(virtualApiKeys.orgId, orgId),
            eq(virtualApiKeys.kind, "manual")
        ];

        if (userId) {
            conditions.push(eq(virtualApiKeys.userId, userId));
        }

        if (search) {
            const term = "%" + search.toLowerCase() + "%";
            conditions.push(
                or(
                    like(sql`LOWER(${virtualApiKeys.name})`, term),
                    like(sql`LOWER(${virtualApiKeys.description})`, term),
                    like(sql`LOWER(${virtualApiKeys.lastChars})`, term)
                )!
            );
        }

        if (resourceId !== undefined) {
            conditions.push(
                or(
                    eq(virtualApiKeys.allResources, true),
                    exists(
                        db
                            .select()
                            .from(virtualApiKeyResources)
                            .where(
                                and(
                                    eq(
                                        virtualApiKeyResources.virtualApiKeyId,
                                        virtualApiKeys.virtualApiKeyId
                                    ),
                                    eq(
                                        virtualApiKeyResources.resourceId,
                                        resourceId
                                    )
                                )
                            )
                    )
                )!
            );
        }

        const whereClause = and(...conditions);

        const [totalCount, rows] = await Promise.all([
            db.$count(
                db
                    .select()
                    .from(virtualApiKeys)
                    .where(whereClause)
                    .as("filtered_virtual_api_keys")
            ),
            db
                .select()
                .from(virtualApiKeys)
                .where(whereClause)
                .limit(pageSize)
                .offset(pageSize * (page - 1))
                .orderBy(
                    asc(virtualApiKeys.name),
                    asc(virtualApiKeys.createdAt)
                )
        ]);

        const keyIds = rows.map((row) => row.virtualApiKeyId);
        const resourceRows =
            keyIds.length === 0
                ? []
                : await db
                      .select()
                      .from(virtualApiKeyResources)
                      .where(
                          inArray(
                              virtualApiKeyResources.virtualApiKeyId,
                              keyIds
                          )
                      );

        const resourceIdsByKey = new Map<string, number[]>();
        for (const row of resourceRows) {
            const existing = resourceIdsByKey.get(row.virtualApiKeyId) ?? [];
            existing.push(row.resourceId);
            resourceIdsByKey.set(row.virtualApiKeyId, existing);
        }

        return response<ListVirtualApiKeysResponse>(res, {
            data: {
                virtualApiKeys: rows.map((row: VirtualApiKey) => ({
                    ...toPublicVirtualApiKey(row),
                    resourceIds: resourceIdsByKey.get(row.virtualApiKeyId) ?? []
                })),
                pagination: {
                    total: totalCount,
                    pageSize,
                    page
                }
            },
            success: true,
            error: false,
            message: "Virtual API keys retrieved successfully",
            status: HttpCode.OK
        });
    } catch (error) {
        logger.error(error);
        return next(
            createHttpError(HttpCode.INTERNAL_SERVER_ERROR, "An error occurred")
        );
    }
}
