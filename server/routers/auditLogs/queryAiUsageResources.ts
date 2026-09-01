import { db, logsDb, aiUsageRecords, resources, siteResources } from "@server/db";
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

// Composite key namespacing resourceId ("r-") vs siteResourceId ("s-") since
// the two id spaces are independent and can overlap numerically. Uses a dash
// rather than a colon so the key stays safe to use as a CSS custom-property
// name suffix (e.g. --color-r-1) on the client.
function resourceKey(resourceId: number | null, siteResourceId: number | null) {
    if (resourceId != null) return `r-${resourceId}`;
    if (siteResourceId != null) return `s-${siteResourceId}`;
    return "none";
}

async function query(data: Q) {
    const roleUserIds = await resolveRoleUserIds(data.orgId, data.roleId);
    const baseConditions = buildAiUsageWhere(data, roleUserIds);
    const dayExpr = dayBucketExpr();

    const resourceByDay = await logsDb
        .select({
            day: dayExpr.as("day"),
            resourceId: aiUsageRecords.resourceId,
            siteResourceId: aiUsageRecords.siteResourceId,
            cost: sql<number>`COALESCE(SUM(${aiUsageRecords.costUsd}), 0)`,
            tokens: sql<number>`COALESCE(SUM(${aiUsageRecords.totalTokens}), 0)`
        })
        .from(aiUsageRecords)
        .where(baseConditions)
        .groupBy(dayExpr, aiUsageRecords.resourceId, aiUsageRecords.siteResourceId)
        .orderBy(dayExpr);

    const costTotals = new Map<string, number>();
    const tokenTotals = new Map<string, number>();
    for (const row of resourceByDay) {
        const key = resourceKey(row.resourceId, row.siteResourceId);
        costTotals.set(key, (costTotals.get(key) ?? 0) + row.cost);
        tokenTotals.set(key, (tokenTotals.get(key) ?? 0) + row.tokens);
    }

    const topByCost = pickTopNKeys(costTotals);
    const topByTokens = pickTopNKeys(tokenTotals);

    const resourceCostPerDay = bucketTopNPerDay(
        resourceByDay.map((r) => ({
            day: r.day,
            key: resourceKey(r.resourceId, r.siteResourceId),
            value: r.cost
        })),
        topByCost
    );
    const resourceTokensPerDay = bucketTopNPerDay(
        resourceByDay.map((r) => ({
            day: r.day,
            key: resourceKey(r.resourceId, r.siteResourceId),
            value: r.tokens
        })),
        topByTokens
    );

    const topResourcesRaw = await logsDb
        .select({
            resourceId: aiUsageRecords.resourceId,
            siteResourceId: aiUsageRecords.siteResourceId,
            requests: count(),
            totalTokens: sql<number>`COALESCE(SUM(${aiUsageRecords.totalTokens}), 0)`,
            costUsd: sql<number>`COALESCE(SUM(${aiUsageRecords.costUsd}), 0)`
        })
        .from(aiUsageRecords)
        .where(baseConditions)
        .groupBy(aiUsageRecords.resourceId, aiUsageRecords.siteResourceId)
        .orderBy(desc(sql`COALESCE(SUM(${aiUsageRecords.costUsd}), 0)`))
        .limit(DISTINCT_LIMIT + 1);

    if (topResourcesRaw.length > DISTINCT_LIMIT) {
        throw createHttpError(
            HttpCode.BAD_REQUEST,
            "Too many distinct resources. Please narrow your query."
        );
    }

    const resourceIds = topResourcesRaw
        .map((r) => r.resourceId)
        .filter((id): id is number => id !== null);
    const siteResourceIds = topResourcesRaw
        .map((r) => r.siteResourceId)
        .filter((id): id is number => id !== null);

    const nameMap = new Map<string, string | null>();
    if (resourceIds.length > 0) {
        const resourceDetails = await db
            .select({ resourceId: resources.resourceId, name: resources.name })
            .from(resources)
            .where(inArray(resources.resourceId, resourceIds));
        for (const r of resourceDetails) {
            nameMap.set(`r-${r.resourceId}`, r.name);
        }
    }
    if (siteResourceIds.length > 0) {
        const siteResourceDetails = await db
            .select({
                siteResourceId: siteResources.siteResourceId,
                name: siteResources.name
            })
            .from(siteResources)
            .where(inArray(siteResources.siteResourceId, siteResourceIds));
        for (const r of siteResourceDetails) {
            nameMap.set(`s-${r.siteResourceId}`, r.name);
        }
    }

    const topResources = topResourcesRaw.map((r) => {
        const key = resourceKey(r.resourceId, r.siteResourceId);
        return {
            key,
            resourceId: r.resourceId,
            siteResourceId: r.siteResourceId,
            type:
                r.resourceId != null
                    ? ("public" as const)
                    : r.siteResourceId != null
                      ? ("site" as const)
                      : null,
            name: nameMap.get(key) ?? null,
            requests: r.requests,
            totalTokens: r.totalTokens,
            costUsd: r.costUsd
        };
    });

    return {
        resourceCostPerDay,
        resourceTokensPerDay,
        topResources
    };
}

registry.registerPath({
    method: "get",
    path: "/org/{orgId}/logs/ai/usage/resources",
    description: "Query the AI usage analytics resource breakdown for an organization",
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

export type QueryAiUsageResourcesResponse = Awaited<ReturnType<typeof query>>;

export async function queryAiUsageResources(
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

        return response<QueryAiUsageResourcesResponse>(res, {
            data,
            success: true,
            error: false,
            message: "AI usage resource breakdown retrieved successfully",
            status: HttpCode.OK
        });
    } catch (error) {
        logger.error(error);
        return next(
            createHttpError(HttpCode.INTERNAL_SERVER_ERROR, "An error occurred")
        );
    }
}
