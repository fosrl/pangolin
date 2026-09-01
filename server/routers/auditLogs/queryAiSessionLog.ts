import {
    logsDb,
    aiSessionLog,
    aiProviders,
    aiUsageRecords,
    resources,
    siteResources,
    users,
    virtualApiKeys,
    db,
    primaryDb
} from "@server/db";
import { registry } from "@server/openApi";
import { NextFunction } from "express";
import { Request, Response } from "express";
import { eq, gt, lt, and, count, desc, inArray, isNull, or } from "drizzle-orm";
import { OpenAPITags } from "@server/openApi";
import { z } from "zod";
import createHttpError from "http-errors";
import HttpCode from "@server/types/HttpCode";
import { fromError } from "zod-validation-error";
import { QueryAiSessionLogResponse } from "@server/routers/auditLogs/types";
import { AI_CAPABILITIES } from "@server/lib/aiCapabilities";
import response from "@server/lib/response";
import logger from "@server/logger";
import { getSevenDaysAgo } from "@app/lib/getSevenDaysAgo";
import { decompressText } from "@server/lib/textCompression";

export const queryAiSessionLogsQuery = z.strictObject({
    // iso string just validate its a parseable date
    timeStart: z
        .string()
        .refine((val) => !isNaN(Date.parse(val)), {
            error: "timeStart must be a valid ISO date string"
        })
        .transform((val) => Math.floor(new Date(val).getTime() / 1000))
        .prefault(() => getSevenDaysAgo().toISOString())
        .openapi({
            type: "string",
            format: "date-time",
            description:
                "Start time as ISO date string (defaults to 7 days ago)"
        }),
    timeEnd: z
        .string()
        .refine((val) => !isNaN(Date.parse(val)), {
            error: "timeEnd must be a valid ISO date string"
        })
        .transform((val) => Math.floor(new Date(val).getTime() / 1000))
        .optional()
        .prefault(() => new Date().toISOString())
        .openapi({
            type: "string",
            format: "date-time",
            description:
                "End time as ISO date string (defaults to current time)"
        }),
    providerId: z
        .string()
        .optional()
        .transform(Number)
        .pipe(z.int().positive())
        .optional(),
    capability: z.enum(AI_CAPABILITIES).optional(),
    resourceId: z
        .string()
        .optional()
        .transform(Number)
        .pipe(z.int().positive())
        .optional(),
    actor: z.string().optional(),
    virtualApiKeyId: z.string().optional(),
    model: z.string().optional(),
    isStream: z
        .union([z.boolean(), z.string()])
        .transform((val) => (typeof val === "string" ? val === "true" : val))
        .optional(),
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

export const queryAiSessionLogsParams = z.object({
    orgId: z.string()
});

export const queryAiSessionLogsCombined = queryAiSessionLogsQuery.merge(
    queryAiSessionLogsParams
);
type Q = z.infer<typeof queryAiSessionLogsCombined>;

function sortNamedFilterOptions<T extends { id: number; name: string | null }>(
    items: T[]
): T[] {
    return [...items].sort((a, b) => {
        const nameA = a.name ?? "";
        const nameB = b.name ?? "";

        if (nameA < nameB) return -1;
        if (nameA > nameB) return 1;

        return a.id - b.id;
    });
}

function getWhere(data: Q) {
    return and(
        gt(aiSessionLog.createdAt, data.timeStart),
        lt(aiSessionLog.createdAt, data.timeEnd),
        eq(aiSessionLog.orgId, data.orgId),
        data.providerId
            ? eq(aiSessionLog.providerId, data.providerId)
            : undefined,
        data.capability
            ? eq(aiSessionLog.capability, data.capability)
            : undefined,
        data.resourceId
            ? or(
                  eq(aiSessionLog.resourceId, data.resourceId),
                  eq(aiSessionLog.siteResourceId, data.resourceId)
              )
            : undefined,
        data.actor ? eq(aiSessionLog.userId, data.actor) : undefined,
        data.virtualApiKeyId
            ? eq(aiSessionLog.virtualApiKeyId, data.virtualApiKeyId)
            : undefined,
        data.model ? eq(aiSessionLog.requestedModel, data.model) : undefined,
        data.isStream !== undefined
            ? eq(aiSessionLog.isStream, data.isStream)
            : undefined
    );
}

export function queryAiSession(data: Q) {
    return logsDb
        .select({
            id: aiSessionLog.id,
            sessionId: aiSessionLog.sessionId,
            orgId: aiSessionLog.orgId,
            providerId: aiSessionLog.providerId,
            capability: aiSessionLog.capability,
            resourceId: aiSessionLog.resourceId,
            siteResourceId: aiSessionLog.siteResourceId,
            userId: aiSessionLog.userId,
            virtualApiKeyId: aiSessionLog.virtualApiKeyId,
            requestedModel: aiSessionLog.requestedModel,
            isStream: aiSessionLog.isStream,
            requestBody: aiSessionLog.requestBody,
            responseBody: aiSessionLog.responseBody,
            normalizedRequest: aiSessionLog.normalizedRequest,
            normalizedResponse: aiSessionLog.normalizedResponse,
            truncated: aiSessionLog.truncated,
            statusCode: aiSessionLog.statusCode,
            createdAt: aiSessionLog.createdAt
        })
        .from(aiSessionLog)
        .where(getWhere(data))
        .orderBy(desc(aiSessionLog.createdAt));
}

function decompressField(value: string | null): string | null {
    if (value == null) {
        return value;
    }
    try {
        return decompressText(value);
    } catch (error) {
        logger.error("Failed to decompress AI session log field", { error });
        return value;
    }
}

export function decompressAiSessionLogRow<
    T extends {
        requestBody: string | null;
        responseBody: string | null;
        normalizedRequest: string | null;
        normalizedResponse: string | null;
    }
>(row: T): T {
    return {
        ...row,
        requestBody: decompressField(row.requestBody),
        responseBody: decompressField(row.responseBody),
        normalizedRequest: decompressField(row.normalizedRequest),
        normalizedResponse: decompressField(row.normalizedResponse)
    };
}

async function enrichWithDetails(
    logs: Awaited<ReturnType<typeof queryAiSession>>
) {
    const providerIds = [...new Set(logs.map((log) => log.providerId))];

    const resourceIds = logs
        .map((log) => log.resourceId)
        .filter((id): id is number => id !== null && id !== undefined);

    const siteResourceIds = logs
        .filter((log) => log.resourceId == null && log.siteResourceId != null)
        .map((log) => log.siteResourceId)
        .filter((id): id is number => id !== null && id !== undefined);

    const userIds = [
        ...new Set(
            logs
                .map((log) => log.userId)
                .filter((id): id is string => id !== null && id !== undefined)
        )
    ];

    const virtualApiKeyIds = [
        ...new Set(
            logs
                .map((log) => log.virtualApiKeyId)
                .filter((id): id is string => id !== null && id !== undefined)
        )
    ];

    const providerMap = new Map<
        number,
        { name: string | null; type: string | null }
    >();
    if (providerIds.length > 0) {
        const providerDetails = await primaryDb
            .select({
                providerId: aiProviders.providerId,
                name: aiProviders.name,
                type: aiProviders.type
            })
            .from(aiProviders)
            .where(
                inArray(
                    aiProviders.providerId,
                    providerIds.filter(
                        (id): id is number => id !== null && id !== undefined
                    )
                )
            );

        for (const p of providerDetails) {
            providerMap.set(p.providerId, { name: p.name, type: p.type });
        }
    }

    const resourceMap = new Map<
        number,
        { name: string | null; niceId: string | null }
    >();
    if (resourceIds.length > 0) {
        const resourceDetails = await primaryDb
            .select({
                resourceId: resources.resourceId,
                name: resources.name,
                niceId: resources.niceId
            })
            .from(resources)
            .where(inArray(resources.resourceId, resourceIds));

        for (const r of resourceDetails) {
            resourceMap.set(r.resourceId, { name: r.name, niceId: r.niceId });
        }
    }

    const siteResourceMap = new Map<
        number,
        { name: string | null; niceId: string | null }
    >();
    if (siteResourceIds.length > 0) {
        const siteResourceDetails = await primaryDb
            .select({
                siteResourceId: siteResources.siteResourceId,
                name: siteResources.name,
                niceId: siteResources.niceId
            })
            .from(siteResources)
            .where(inArray(siteResources.siteResourceId, siteResourceIds));

        for (const r of siteResourceDetails) {
            siteResourceMap.set(r.siteResourceId, {
                name: r.name,
                niceId: r.niceId
            });
        }
    }

    const userMap = new Map<string, string | null>();
    if (userIds.length > 0) {
        const userDetails = await db
            .select({ userId: users.userId, email: users.email })
            .from(users)
            .where(inArray(users.userId, userIds));

        for (const u of userDetails) {
            userMap.set(u.userId, u.email);
        }
    }

    const virtualApiKeyMap = new Map<
        string,
        { name: string | null; lastChars: string }
    >();
    if (virtualApiKeyIds.length > 0) {
        const virtualApiKeyDetails = await db
            .select({
                virtualApiKeyId: virtualApiKeys.virtualApiKeyId,
                name: virtualApiKeys.name,
                lastChars: virtualApiKeys.lastChars
            })
            .from(virtualApiKeys)
            .where(inArray(virtualApiKeys.virtualApiKeyId, virtualApiKeyIds));

        for (const k of virtualApiKeyDetails) {
            virtualApiKeyMap.set(k.virtualApiKeyId, {
                name: k.name,
                lastChars: k.lastChars
            });
        }
    }

    const usageMap = new Map<
        string,
        {
            promptTokens: number;
            cacheReadTokens: number;
            cacheWriteTokens: number;
            completionTokens: number;
            reasoningTokens: number;
            totalTokens: number;
            costUsd: number | null;
            estimated: boolean;
        }
    >();
    const sessionIds = logs.map((log) => log.sessionId);
    if (sessionIds.length > 0) {
        const usageDetails = await logsDb
            .select({
                sessionId: aiUsageRecords.sessionId,
                promptTokens: aiUsageRecords.promptTokens,
                cacheReadTokens: aiUsageRecords.cacheReadTokens,
                cacheWriteTokens: aiUsageRecords.cacheWriteTokens,
                completionTokens: aiUsageRecords.completionTokens,
                reasoningTokens: aiUsageRecords.reasoningTokens,
                totalTokens: aiUsageRecords.totalTokens,
                costUsd: aiUsageRecords.costUsd,
                estimated: aiUsageRecords.estimated
            })
            .from(aiUsageRecords)
            .where(inArray(aiUsageRecords.sessionId, sessionIds));

        for (const u of usageDetails) {
            if (!u.sessionId) continue;
            usageMap.set(u.sessionId, {
                promptTokens: u.promptTokens,
                cacheReadTokens: u.cacheReadTokens,
                cacheWriteTokens: u.cacheWriteTokens,
                completionTokens: u.completionTokens,
                reasoningTokens: u.reasoningTokens,
                totalTokens: u.totalTokens,
                costUsd: u.costUsd,
                estimated: u.estimated
            });
        }
    }

    return logs.map((log) => {
        const provider = log.providerId
            ? providerMap.get(log.providerId)
            : null;

        let resourceId = log.resourceId;
        let resourceName: string | null = null;
        let resourceNiceId: string | null = null;
        let resourceType: "public" | "site" | null = null;
        if (log.resourceId != null) {
            const details = resourceMap.get(log.resourceId);
            resourceName = details?.name ?? null;
            resourceNiceId = details?.niceId ?? null;
            resourceType = "public";
        } else if (log.siteResourceId != null) {
            const details = siteResourceMap.get(log.siteResourceId);
            resourceId = log.siteResourceId;
            resourceName = details?.name ?? null;
            resourceNiceId = details?.niceId ?? null;
            resourceType = "site";
        }

        return {
            ...log,
            resourceId,
            resourceType,
            providerName: provider?.name ?? null,
            providerType: provider?.type ?? null,
            resourceName,
            resourceNiceId,
            userEmail: log.userId ? (userMap.get(log.userId) ?? null) : null,
            virtualApiKeyName: log.virtualApiKeyId
                ? (virtualApiKeyMap.get(log.virtualApiKeyId)?.name ?? null)
                : null,
            virtualApiKeyLastChars: log.virtualApiKeyId
                ? (virtualApiKeyMap.get(log.virtualApiKeyId)?.lastChars ?? null)
                : null,
            usage: usageMap.get(log.sessionId) ?? null
        };
    });
}

export function countAiSessionQuery(data: Q) {
    return logsDb
        .select({ count: count() })
        .from(aiSessionLog)
        .where(getWhere(data));
}

registry.registerPath({
    method: "get",
    path: "/org/{orgId}/logs/ai",
    description: "Query the AI gateway session log for an organization",
    tags: [OpenAPITags.Logs],
    request: {
        query: queryAiSessionLogsQuery,
        params: queryAiSessionLogsParams
    },
    responses: {
        200: {
            description: "Successful response",
            content: {
                "application/json": {
                    schema: z.object({
                        data: z.record(z.string(), z.any()).nullable(),
                        success: z.boolean(),
                        error: z.boolean(),
                        message: z.string(),
                        status: z.number()
                    })
                }
            }
        }
    }
});

async function queryUniqueFilterAttributes(
    timeStart: number,
    timeEnd: number,
    orgId: string
) {
    const baseConditions = and(
        gt(aiSessionLog.createdAt, timeStart),
        lt(aiSessionLog.createdAt, timeEnd),
        eq(aiSessionLog.orgId, orgId)
    );

    const DISTINCT_LIMIT = 500;

    const [
        uniqueProviders,
        uniqueUsers,
        uniqueResources,
        uniqueSiteResources,
        uniqueModels,
        uniqueVirtualApiKeys
    ] = await Promise.all([
        logsDb
            .selectDistinct({ id: aiSessionLog.providerId })
            .from(aiSessionLog)
            .where(baseConditions)
            .limit(DISTINCT_LIMIT + 1),
        logsDb
            .selectDistinct({ userId: aiSessionLog.userId })
            .from(aiSessionLog)
            .where(baseConditions)
            .limit(DISTINCT_LIMIT + 1),
        logsDb
            .selectDistinct({ id: aiSessionLog.resourceId })
            .from(aiSessionLog)
            .where(baseConditions)
            .limit(DISTINCT_LIMIT + 1),
        logsDb
            .selectDistinct({ id: aiSessionLog.siteResourceId })
            .from(aiSessionLog)
            .where(and(baseConditions, isNull(aiSessionLog.resourceId)))
            .limit(DISTINCT_LIMIT + 1),
        logsDb
            .selectDistinct({ model: aiSessionLog.requestedModel })
            .from(aiSessionLog)
            .where(baseConditions)
            .limit(DISTINCT_LIMIT + 1),
        logsDb
            .selectDistinct({ id: aiSessionLog.virtualApiKeyId })
            .from(aiSessionLog)
            .where(baseConditions)
            .limit(DISTINCT_LIMIT + 1)
    ]);

    const models = uniqueModels
        .map((row) => row.model)
        .filter((model): model is string => model !== null);

    const providerIds = uniqueProviders
        .map((row) => row.id)
        .filter((id): id is number => id !== null);

    let providers: Array<{ id: number; name: string | null }> = [];
    if (providerIds.length > 0) {
        const providerDetails = await primaryDb
            .select({
                providerId: aiProviders.providerId,
                name: aiProviders.name
            })
            .from(aiProviders)
            .where(inArray(aiProviders.providerId, providerIds));

        providers = providerDetails.map((p) => ({
            id: p.providerId,
            name: p.name
        }));
    }

    const userIds = uniqueUsers
        .map((row) => row.userId)
        .filter((id): id is string => id !== null);

    let userList: Array<{ id: string; email: string | null }> = [];
    if (userIds.length > 0) {
        const userDetails = await db
            .select({ userId: users.userId, email: users.email })
            .from(users)
            .where(inArray(users.userId, userIds));

        userList = userDetails.map((u) => ({ id: u.userId, email: u.email }));
    }

    const resourceIds = uniqueResources
        .map((row) => row.id)
        .filter((id): id is number => id !== null);

    const siteResourceIds = uniqueSiteResources
        .map((row) => row.id)
        .filter((id): id is number => id !== null);

    let resourcesWithNames: Array<{ id: number; name: string | null }> = [];

    if (resourceIds.length > 0) {
        const resourceDetails = await primaryDb
            .select({
                resourceId: resources.resourceId,
                name: resources.name
            })
            .from(resources)
            .where(inArray(resources.resourceId, resourceIds));

        resourcesWithNames = [
            ...resourcesWithNames,
            ...resourceDetails.map((r) => ({
                id: r.resourceId,
                name: r.name
            }))
        ];
    }

    if (siteResourceIds.length > 0) {
        const siteResourceDetails = await primaryDb
            .select({
                siteResourceId: siteResources.siteResourceId,
                name: siteResources.name
            })
            .from(siteResources)
            .where(inArray(siteResources.siteResourceId, siteResourceIds));

        resourcesWithNames = [
            ...resourcesWithNames,
            ...siteResourceDetails.map((r) => ({
                id: r.siteResourceId,
                name: r.name
            }))
        ];
    }

    const virtualApiKeyIds = uniqueVirtualApiKeys
        .map((row) => row.id)
        .filter((id): id is string => id !== null);

    let virtualApiKeyList: Array<{
        id: string;
        name: string | null;
        lastChars: string | null;
    }> = [];
    if (virtualApiKeyIds.length > 0) {
        const virtualApiKeyDetails = await primaryDb
            .select({
                virtualApiKeyId: virtualApiKeys.virtualApiKeyId,
                name: virtualApiKeys.name,
                lastChars: virtualApiKeys.lastChars
            })
            .from(virtualApiKeys)
            .where(inArray(virtualApiKeys.virtualApiKeyId, virtualApiKeyIds));

        virtualApiKeyList = virtualApiKeyDetails.map((k) => ({
            id: k.virtualApiKeyId,
            name: k.name,
            lastChars: k.lastChars
        }));
    }

    return {
        providers: sortNamedFilterOptions(providers),
        resources: sortNamedFilterOptions(resourcesWithNames),
        users: userList,
        virtualApiKeys: virtualApiKeyList,
        models: models.sort()
    };
}

export async function queryAiSessionLogs(
    req: Request,
    res: Response,
    next: NextFunction
): Promise<any> {
    try {
        const parsedQuery = queryAiSessionLogsQuery.safeParse(req.query);
        if (!parsedQuery.success) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    fromError(parsedQuery.error)
                )
            );
        }

        const parsedParams = queryAiSessionLogsParams.safeParse(req.params);
        if (!parsedParams.success) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    fromError(parsedParams.error)
                )
            );
        }

        const data = { ...parsedQuery.data, ...parsedParams.data };

        const baseQuery = queryAiSession(data);

        const logsRaw = (
            await baseQuery.limit(data.limit).offset(data.offset)
        ).map(decompressAiSessionLogRow);

        const log = await enrichWithDetails(logsRaw);

        const totalCountResult = await countAiSessionQuery(data);
        const totalCount = totalCountResult[0].count;

        const filterAttributes = await queryUniqueFilterAttributes(
            data.timeStart,
            data.timeEnd,
            data.orgId
        );

        return response<QueryAiSessionLogResponse>(res, {
            data: {
                log,
                pagination: {
                    total: totalCount,
                    limit: data.limit,
                    offset: data.offset
                },
                filterAttributes
            },
            success: true,
            error: false,
            message: "AI session logs retrieved successfully",
            status: HttpCode.OK
        });
    } catch (error) {
        logger.error(error);
        return next(
            createHttpError(HttpCode.INTERNAL_SERVER_ERROR, "An error occurred")
        );
    }
}
