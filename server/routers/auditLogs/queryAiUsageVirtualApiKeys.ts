import { db, logsDb, aiUsageRecords, virtualApiKeys } from "@server/db";
import { registry } from "@server/openApi";
import { NextFunction } from "express";
import { Request, Response } from "express";
import { count, desc, inArray, sql } from "drizzle-orm";
import { OpenAPITags } from "@server/openApi";
import { z } from "zod";
import createHttpError from "http-errors";
import HttpCode from "@server/types/HttpCode";
import { fromError } from "zod-validation-error";
import response from "@server/lib/response";
import logger from "@server/logger";
import {
    aiUsageAnalyticsFiltersQuery,
    aiUsageAnalyticsParams,
    buildAiUsageWhere,
    resolveRoleUserIds,
    dayBucketExpr,
    pickTopNKeys,
    bucketTopNPerDay,
    DISTINCT_LIMIT,
    type AiUsageAnalyticsQuery
} from "./aiUsageAnalyticsShared";

type Q = AiUsageAnalyticsQuery;

const UNKNOWN_VIRTUAL_API_KEY_KEY = "unknown";

async function query(data: Q) {
    const roleUserIds = await resolveRoleUserIds(data.orgId, data.roleId);
    const baseConditions = buildAiUsageWhere(data, roleUserIds);
    const dayExpr = dayBucketExpr();

    const virtualApiKeyByDay = await logsDb
        .select({
            day: dayExpr.as("day"),
            virtualApiKeyId: aiUsageRecords.virtualApiKeyId,
            cost: sql<number>`COALESCE(SUM(${aiUsageRecords.costUsd}), 0)`,
            tokens: sql<number>`COALESCE(SUM(${aiUsageRecords.totalTokens}), 0)`
        })
        .from(aiUsageRecords)
        .where(baseConditions)
        .groupBy(dayExpr, aiUsageRecords.virtualApiKeyId)
        .orderBy(dayExpr);

    const virtualApiKeyTotalsRaw = await logsDb
        .select({
            virtualApiKeyId: aiUsageRecords.virtualApiKeyId,
            requests: count(),
            totalTokens: sql<number>`COALESCE(SUM(${aiUsageRecords.totalTokens}), 0)`,
            costUsd: sql<number>`COALESCE(SUM(${aiUsageRecords.costUsd}), 0)`
        })
        .from(aiUsageRecords)
        .where(baseConditions)
        .groupBy(aiUsageRecords.virtualApiKeyId)
        .orderBy(desc(sql`COALESCE(SUM(${aiUsageRecords.costUsd}), 0)`))
        .limit(DISTINCT_LIMIT + 1);

    if (virtualApiKeyTotalsRaw.length > DISTINCT_LIMIT) {
        throw createHttpError(
            HttpCode.BAD_REQUEST,
            "Too many distinct virtual API keys. Please narrow your query."
        );
    }

    const virtualApiKeyIds = virtualApiKeyTotalsRaw
        .map((r) => r.virtualApiKeyId)
        .filter((id): id is string => id !== null);

    const detailsMap = new Map<
        string,
        { name: string | null; lastChars: string; kind: "user" | "manual" }
    >();
    if (virtualApiKeyIds.length > 0) {
        const details = await db
            .select({
                virtualApiKeyId: virtualApiKeys.virtualApiKeyId,
                name: virtualApiKeys.name,
                lastChars: virtualApiKeys.lastChars,
                kind: virtualApiKeys.kind
            })
            .from(virtualApiKeys)
            .where(inArray(virtualApiKeys.virtualApiKeyId, virtualApiKeyIds));
        for (const k of details) {
            detailsMap.set(k.virtualApiKeyId, {
                name: k.name,
                lastChars: k.lastChars,
                kind: k.kind
            });
        }
    }

    const topVirtualApiKeys = virtualApiKeyTotalsRaw.map((r) => {
        const details = r.virtualApiKeyId
            ? detailsMap.get(r.virtualApiKeyId)
            : undefined;
        return {
            virtualApiKeyId: r.virtualApiKeyId,
            name: details?.name ?? null,
            lastChars: details?.lastChars ?? null,
            kind: details?.kind ?? null,
            requests: r.requests,
            totalTokens: r.totalTokens,
            costUsd: r.costUsd
        };
    });

    const virtualApiKeyCostTotals = new Map<string, number>();
    const virtualApiKeyTokenTotals = new Map<string, number>();
    for (const row of virtualApiKeyByDay) {
        const key = row.virtualApiKeyId ?? UNKNOWN_VIRTUAL_API_KEY_KEY;
        virtualApiKeyCostTotals.set(
            key,
            (virtualApiKeyCostTotals.get(key) ?? 0) + row.cost
        );
        virtualApiKeyTokenTotals.set(
            key,
            (virtualApiKeyTokenTotals.get(key) ?? 0) + row.tokens
        );
    }
    const topVirtualApiKeysByCost = pickTopNKeys(virtualApiKeyCostTotals);
    const topVirtualApiKeysByTokens = pickTopNKeys(virtualApiKeyTokenTotals);

    const virtualApiKeyCostPerDay = bucketTopNPerDay(
        virtualApiKeyByDay.map((r) => ({
            day: r.day,
            key: r.virtualApiKeyId ?? UNKNOWN_VIRTUAL_API_KEY_KEY,
            value: r.cost
        })),
        topVirtualApiKeysByCost
    );
    const virtualApiKeyTokensPerDay = bucketTopNPerDay(
        virtualApiKeyByDay.map((r) => ({
            day: r.day,
            key: r.virtualApiKeyId ?? UNKNOWN_VIRTUAL_API_KEY_KEY,
            value: r.tokens
        })),
        topVirtualApiKeysByTokens
    );

    return {
        topVirtualApiKeys,
        virtualApiKeyCostPerDay,
        virtualApiKeyTokensPerDay
    };
}

registry.registerPath({
    method: "get",
    path: "/org/{orgId}/logs/ai/usage/virtual-api-keys",
    description:
        "Query the AI usage analytics virtual API key breakdown for an organization",
    tags: [OpenAPITags.Logs],
    request: {
        query: aiUsageAnalyticsFiltersQuery,
        params: aiUsageAnalyticsParams
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

export type QueryAiUsageVirtualApiKeysResponse = Awaited<
    ReturnType<typeof query>
>;

export async function queryAiUsageVirtualApiKeys(
    req: Request,
    res: Response,
    next: NextFunction
): Promise<any> {
    try {
        const parsedQuery = aiUsageAnalyticsFiltersQuery.safeParse(req.query);
        if (!parsedQuery.success) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    fromError(parsedQuery.error)
                )
            );
        }

        const parsedParams = aiUsageAnalyticsParams.safeParse(req.params);
        if (!parsedParams.success) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    fromError(parsedParams.error)
                )
            );
        }

        const data = await query({ ...parsedQuery.data, ...parsedParams.data });

        return response<QueryAiUsageVirtualApiKeysResponse>(res, {
            data,
            success: true,
            error: false,
            message:
                "AI usage virtual API key breakdown retrieved successfully",
            status: HttpCode.OK
        });
    } catch (error) {
        logger.error(error);
        return next(
            createHttpError(HttpCode.INTERNAL_SERVER_ERROR, "An error occurred")
        );
    }
}
