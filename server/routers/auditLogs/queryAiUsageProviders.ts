import { db, logsDb, aiUsageRecords, aiProviders } from "@server/db";
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

async function query(data: Q) {
    const roleUserIds = await resolveRoleUserIds(data.orgId, data.roleId);
    const baseConditions = buildAiUsageWhere(data, roleUserIds);
    const dayExpr = dayBucketExpr();

    const providerByDay = await logsDb
        .select({
            day: dayExpr.as("day"),
            providerId: aiUsageRecords.providerId,
            cost: sql<number>`COALESCE(SUM(${aiUsageRecords.costUsd}), 0)`,
            tokens: sql<number>`COALESCE(SUM(${aiUsageRecords.totalTokens}), 0)`
        })
        .from(aiUsageRecords)
        .where(baseConditions)
        .groupBy(dayExpr, aiUsageRecords.providerId)
        .orderBy(dayExpr);

    const costTotals = new Map<string, number>();
    const tokenTotals = new Map<string, number>();
    for (const row of providerByDay) {
        const key = String(row.providerId);
        costTotals.set(key, (costTotals.get(key) ?? 0) + row.cost);
        tokenTotals.set(key, (tokenTotals.get(key) ?? 0) + row.tokens);
    }

    const topByCost = pickTopNKeys(costTotals);
    const topByTokens = pickTopNKeys(tokenTotals);

    const providerCostPerDay = bucketTopNPerDay(
        providerByDay.map((r) => ({
            day: r.day,
            key: String(r.providerId),
            value: r.cost
        })),
        topByCost
    );
    const providerTokensPerDay = bucketTopNPerDay(
        providerByDay.map((r) => ({
            day: r.day,
            key: String(r.providerId),
            value: r.tokens
        })),
        topByTokens
    );

    const topProvidersRaw = await logsDb
        .select({
            providerId: aiUsageRecords.providerId,
            requests: count(),
            totalTokens: sql<number>`COALESCE(SUM(${aiUsageRecords.totalTokens}), 0)`,
            costUsd: sql<number>`COALESCE(SUM(${aiUsageRecords.costUsd}), 0)`
        })
        .from(aiUsageRecords)
        .where(baseConditions)
        .groupBy(aiUsageRecords.providerId)
        .orderBy(desc(sql`COALESCE(SUM(${aiUsageRecords.costUsd}), 0)`))
        .limit(DISTINCT_LIMIT + 1);

    if (topProvidersRaw.length > DISTINCT_LIMIT) {
        throw createHttpError(
            HttpCode.BAD_REQUEST,
            "Too many distinct providers. Please narrow your query."
        );
    }

    const providerIds = topProvidersRaw.map((r) => r.providerId);
    const nameMap = new Map<number, string | null>();
    if (providerIds.length > 0) {
        const providerDetails = await db
            .select({
                providerId: aiProviders.providerId,
                name: aiProviders.name
            })
            .from(aiProviders)
            .where(
                inArray(
                    aiProviders.providerId,
                    providerIds.filter((id): id is number => id !== null)
                )
            );
        for (const p of providerDetails) {
            nameMap.set(p.providerId, p.name);
        }
    }

    const topProviders = topProvidersRaw.map((r) => ({
        providerId: r.providerId,
        name: r.providerId ? (nameMap.get(r.providerId) ?? null) : null,
        requests: r.requests,
        totalTokens: r.totalTokens,
        costUsd: r.costUsd
    }));

    return {
        providerCostPerDay,
        providerTokensPerDay,
        topProviders
    };
}

registry.registerPath({
    method: "get",
    path: "/org/{orgId}/logs/ai/usage/providers",
    description:
        "Query the AI usage analytics provider breakdown for an organization",
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

export type QueryAiUsageProvidersResponse = Awaited<ReturnType<typeof query>>;

export async function queryAiUsageProviders(
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

        return response<QueryAiUsageProvidersResponse>(res, {
            data,
            success: true,
            error: false,
            message: "AI usage provider breakdown retrieved successfully",
            status: HttpCode.OK
        });
    } catch (error) {
        logger.error(error);
        return next(
            createHttpError(HttpCode.INTERNAL_SERVER_ERROR, "An error occurred")
        );
    }
}
