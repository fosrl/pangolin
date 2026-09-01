import { Request, Response, NextFunction } from "express";
import { z } from "zod";
import {
    db,
    resources,
    users,
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
import { and, asc, eq, exists, inArray, or } from "drizzle-orm";
import {
    getOrCreateUserVirtualApiKey,
    toPublicVirtualApiKey
} from "@server/lib/virtualApiKey";
import type { ListMyVirtualApiKeysResponse } from "@server/routers/virtualApiKey/types";
import { formatPublicResourceAccess } from "@server/routers/launcher/formatLauncherAccess";

const paramsSchema = z.strictObject({
    orgId: z.string().nonempty()
});

const querySchema = z.object({
    resourceGuid: z.string().nonempty().optional()
});

registry.registerPath({
    method: "get",
    path: "/org/{orgId}/my-virtual-api-keys",
    description:
        "List the signed-in user's identity virtual API key and manual keys attributed to them.",
    tags: [OpenAPITags.VirtualApiKey],
    request: {
        params: paramsSchema,
        query: querySchema
    },
    responses: {
        200: {
            description: "Successful response"
        }
    }
});

async function resourceIdsForKeys(
    keyIds: string[]
): Promise<Map<string, number[]>> {
    const resourceIdsByKey = new Map<string, number[]>();
    if (keyIds.length === 0) {
        return resourceIdsByKey;
    }

    const resourceRows = await db
        .select()
        .from(virtualApiKeyResources)
        .where(inArray(virtualApiKeyResources.virtualApiKeyId, keyIds));

    for (const row of resourceRows) {
        const existing = resourceIdsByKey.get(row.virtualApiKeyId) ?? [];
        existing.push(row.resourceId);
        resourceIdsByKey.set(row.virtualApiKeyId, existing);
    }

    return resourceIdsByKey;
}

function toKeyWithResources(
    row: VirtualApiKey,
    resourceIdsByKey: Map<string, number[]>
) {
    return {
        ...toPublicVirtualApiKey(row),
        resourceIds: resourceIdsByKey.get(row.virtualApiKeyId) ?? []
    };
}

export async function listMyVirtualApiKeys(
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

        const parsedQuery = querySchema.safeParse(req.query);
        if (!parsedQuery.success) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    fromError(parsedQuery.error).toString()
                )
            );
        }

        const { orgId } = parsedParams.data;
        const { resourceGuid } = parsedQuery.data;
        const userId = req.user?.userId;

        if (!userId) {
            return next(
                createHttpError(HttpCode.UNAUTHORIZED, "User not authenticated")
            );
        }

        if (orgId !== req.userOrgId) {
            return next(
                createHttpError(
                    HttpCode.FORBIDDEN,
                    "User does not have access to this organization"
                )
            );
        }

        let resourceId: number | undefined;
        let resourceName: string | undefined;
        let resourceNiceId: string | undefined;
        let resourceAccessUrl: string | null = null;
        if (resourceGuid) {
            const [resource] = await db
                .select({
                    resourceId: resources.resourceId,
                    name: resources.name,
                    niceId: resources.niceId,
                    mode: resources.mode,
                    fullDomain: resources.fullDomain,
                    ssl: resources.ssl,
                    proxyPort: resources.proxyPort,
                    wildcard: resources.wildcard
                })
                .from(resources)
                .where(
                    and(
                        eq(resources.resourceGuid, resourceGuid),
                        eq(resources.orgId, orgId)
                    )
                )
                .limit(1);

            if (!resource) {
                return next(
                    createHttpError(
                        HttpCode.NOT_FOUND,
                        `Resource with GUID ${resourceGuid} not found`
                    )
                );
            }

            resourceId = resource.resourceId;
            resourceName = resource.name;
            resourceNiceId = resource.niceId;
            resourceAccessUrl = formatPublicResourceAccess({
                mode: resource.mode ?? "",
                fullDomain: resource.fullDomain,
                ssl: resource.ssl,
                proxyPort: resource.proxyPort,
                wildcard: resource.wildcard
            }).accessUrl;
        }

        const [user] = await db
            .select()
            .from(users)
            .where(eq(users.userId, userId))
            .limit(1);

        if (!user) {
            return next(
                createHttpError(
                    HttpCode.NOT_FOUND,
                    `User with ID ${userId} not found`
                )
            );
        }

        const { key: userKeyRow } = await getOrCreateUserVirtualApiKey({
            orgId,
            user,
            createdByUserId: userId
        });

        const manualConditions = [
            eq(virtualApiKeys.orgId, orgId),
            eq(virtualApiKeys.userId, userId),
            eq(virtualApiKeys.kind, "manual")
        ];

        if (resourceId !== undefined) {
            manualConditions.push(
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

        const manualRows = await db
            .select()
            .from(virtualApiKeys)
            .where(and(...manualConditions))
            .orderBy(asc(virtualApiKeys.name), asc(virtualApiKeys.createdAt));

        const allKeyIds = [
            userKeyRow.virtualApiKeyId,
            ...manualRows.map((row) => row.virtualApiKeyId)
        ];
        const resourceIdsByKey = await resourceIdsForKeys(allKeyIds);

        return response<ListMyVirtualApiKeysResponse>(res, {
            data: {
                userKey: toKeyWithResources(userKeyRow, resourceIdsByKey),
                manualKeys: manualRows.map((row) =>
                    toKeyWithResources(row, resourceIdsByKey)
                ),
                ...(resourceName !== undefined ? { resourceName } : {}),
                ...(resourceNiceId !== undefined ? { resourceNiceId } : {}),
                ...(resourceNiceId !== undefined ? { resourceAccessUrl } : {})
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
