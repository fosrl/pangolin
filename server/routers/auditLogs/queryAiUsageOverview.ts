import { logsDb, aiUsageRecords } from "@server/db";
import { registry } from "@server/openApi";
import { NextFunction } from "express";
import { Request, Response } from "express";
import { and, count, desc, eq, sql } from "drizzle-orm";
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
    aiUsageAnalyticsCombined,
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

    const [totalsRow] = await logsDb
        .select({
            requests: count(),
            promptTokens: sql<number>`COALESCE(SUM(${aiUsageRecords.promptTokens}), 0)`,
            cacheReadTokens: sql<number>`COALESCE(SUM(${aiUsageRecords.cacheReadTokens}), 0)`,
            cacheWriteTokens: sql<number>`COALESCE(SUM(${aiUsageRecords.cacheWriteTokens}), 0)`,
            completionTokens: sql<number>`COALESCE(SUM(${aiUsageRecords.completionTokens}), 0)`,
            reasoningTokens: sql<number>`COALESCE(SUM(${aiUsageRecords.reasoningTokens}), 0)`,
            totalTokens: sql<number>`COALESCE(SUM(${aiUsageRecords.totalTokens}), 0)`,
            costUsd: sql<number>`COALESCE(SUM(${aiUsageRecords.costUsd}), 0)`,
            estimatedRequests: sql<number>`SUM(CASE WHEN ${aiUsageRecords.estimated} THEN 1 ELSE 0 END)`
        })
        .from(aiUsageRecords)
        .where(baseConditions);

    const dayExpr = dayBucketExpr();

    const requestsPerDay = await logsDb
        .select({
            day: dayExpr.as("day"),
            requests: count()
        })
        .from(aiUsageRecords)
        .where(baseConditions)
        .groupBy(dayExpr)
        .orderBy(dayExpr);

    const tokensPerDay = await logsDb
        .select({
            day: dayExpr.as("day"),
            promptTokens: sql<number>`COALESCE(SUM(${aiUsageRecords.promptTokens}), 0)`,
            cacheReadTokens: sql<number>`COALESCE(SUM(${aiUsageRecords.cacheReadTokens}), 0)`,
            cacheWriteTokens: sql<number>`COALESCE(SUM(${aiUsageRecords.cacheWriteTokens}), 0)`,
            completionTokens: sql<number>`COALESCE(SUM(${aiUsageRecords.completionTokens}), 0)`,
            reasoningTokens: sql<number>`COALESCE(SUM(${aiUsageRecords.reasoningTokens}), 0)`
        })
        .from(aiUsageRecords)
        .where(baseConditions)
        .groupBy(dayExpr)
        .orderBy(dayExpr);

    const costPerDay = await logsDb
        .select({
            day: dayExpr.as("day"),
            cost: sql<number>`COALESCE(SUM(${aiUsageRecords.costUsd}), 0)`
        })
        .from(aiUsageRecords)
        .where(baseConditions)
        .groupBy(dayExpr)
        .orderBy(dayExpr);

    const modelByDay = await logsDb
        .select({
            day: dayExpr.as("day"),
            model: aiUsageRecords.requestedModel,
            cost: sql<number>`COALESCE(SUM(${aiUsageRecords.costUsd}), 0)`,
            tokens: sql<number>`COALESCE(SUM(${aiUsageRecords.totalTokens}), 0)`
        })
        .from(aiUsageRecords)
        .where(baseConditions)
        .groupBy(dayExpr, aiUsageRecords.requestedModel)
        .orderBy(dayExpr);

    const modelCostTotals = new Map<string, number>();
    const modelTokenTotals = new Map<string, number>();
    for (const row of modelByDay) {
        modelCostTotals.set(
            row.model,
            (modelCostTotals.get(row.model) ?? 0) + row.cost
        );
        modelTokenTotals.set(
            row.model,
            (modelTokenTotals.get(row.model) ?? 0) + row.tokens
        );
    }

    const topModelsByCost = pickTopNKeys(modelCostTotals);
    const topModelsByTokens = pickTopNKeys(modelTokenTotals);

    const modelCostPerDay = bucketTopNPerDay(
        modelByDay.map((r) => ({ day: r.day, key: r.model, value: r.cost })),
        topModelsByCost
    );
    const modelTokensPerDay = bucketTopNPerDay(
        modelByDay.map((r) => ({ day: r.day, key: r.model, value: r.tokens })),
        topModelsByTokens
    );

    const topModelsRaw = await logsDb
        .select({
            model: aiUsageRecords.requestedModel,
            requests: count(),
            totalTokens: sql<number>`COALESCE(SUM(${aiUsageRecords.totalTokens}), 0)`,
            costUsd: sql<number>`COALESCE(SUM(${aiUsageRecords.costUsd}), 0)`
        })
        .from(aiUsageRecords)
        .where(baseConditions)
        .groupBy(aiUsageRecords.requestedModel)
        .orderBy(desc(sql`COALESCE(SUM(${aiUsageRecords.costUsd}), 0)`))
        .limit(DISTINCT_LIMIT + 1);

    if (topModelsRaw.length > DISTINCT_LIMIT) {
        throw createHttpError(
            HttpCode.BAD_REQUEST,
            "Too many distinct models. Please narrow your query."
        );
    }

    return {
        totalRequests: totalsRow.requests,
        totalTokens: totalsRow.totalTokens,
        totalCost: totalsRow.costUsd,
        estimatedPercent:
            totalsRow.requests > 0
                ? (totalsRow.estimatedRequests / totalsRow.requests) * 100
                : 0,
        tokenBreakdown: {
            promptTokens: totalsRow.promptTokens,
            cacheReadTokens: totalsRow.cacheReadTokens,
            cacheWriteTokens: totalsRow.cacheWriteTokens,
            completionTokens: totalsRow.completionTokens,
            reasoningTokens: totalsRow.reasoningTokens
        },
        requestsPerDay,
        tokensPerDay,
        costPerDay,
        modelCostPerDay,
        modelTokensPerDay,
        topModels: topModelsRaw
    };
}

registry.registerPath({
    method: "get",
    path: "/org/{orgId}/logs/ai/usage/overview",
    description: "Query the AI usage analytics overview for an organization",
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

export type QueryAiUsageOverviewResponse = Awaited<ReturnType<typeof query>>;

export async function queryAiUsageOverview(
    req: Request,
    res: Response,
    next: NextFunction
): Promise<any> {
    try {
        const parsedQuery = aiUsageAnalyticsFiltersQuery.safeParse(req.query);
        if (!parsedQuery.success) {
            return next(
                createHttpError(HttpCode.BAD_REQUEST, fromError(parsedQuery.error))
            );
        }

        const parsedParams = aiUsageAnalyticsParams.safeParse(req.params);
        if (!parsedParams.success) {
            return next(
                createHttpError(HttpCode.BAD_REQUEST, fromError(parsedParams.error))
            );
        }

        const data = await query({ ...parsedQuery.data, ...parsedParams.data });

        return response<QueryAiUsageOverviewResponse>(res, {
            data,
            success: true,
            error: false,
            message: "AI usage overview retrieved successfully",
            status: HttpCode.OK
        });
    } catch (error) {
        logger.error(error);
        return next(
            createHttpError(HttpCode.INTERNAL_SERVER_ERROR, "An error occurred")
        );
    }
}
