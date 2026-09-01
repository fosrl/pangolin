import {
    db,
    logsDb,
    aiUsageRecords,
    users,
    roles,
    userOrgRoles
} from "@server/db";
import { registry } from "@server/openApi";
import { NextFunction } from "express";
import { Request, Response } from "express";
import { and, count, desc, eq, inArray, sql } from "drizzle-orm";
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

const UNKNOWN_USER_KEY = "unknown";

async function query(data: Q) {
    const roleUserIds = await resolveRoleUserIds(data.orgId, data.roleId);
    const baseConditions = buildAiUsageWhere(data, roleUserIds);
    const dayExpr = dayBucketExpr();

    // Per (day, user) is the common granularity both the user trend charts and
    // the role trend charts are built from - a usage record only stores
    // userId, so role totals are derived by expanding each user's usage into
    // every role they hold in the org (per-role double counting for
    // multi-role users is expected/accepted).
    const userByDay = await logsDb
        .select({
            day: dayExpr.as("day"),
            userId: aiUsageRecords.userId,
            cost: sql<number>`COALESCE(SUM(${aiUsageRecords.costUsd}), 0)`,
            tokens: sql<number>`COALESCE(SUM(${aiUsageRecords.totalTokens}), 0)`
        })
        .from(aiUsageRecords)
        .where(baseConditions)
        .groupBy(dayExpr, aiUsageRecords.userId)
        .orderBy(dayExpr);

    const userTotalsRaw = await logsDb
        .select({
            userId: aiUsageRecords.userId,
            requests: count(),
            totalTokens: sql<number>`COALESCE(SUM(${aiUsageRecords.totalTokens}), 0)`,
            costUsd: sql<number>`COALESCE(SUM(${aiUsageRecords.costUsd}), 0)`
        })
        .from(aiUsageRecords)
        .where(baseConditions)
        .groupBy(aiUsageRecords.userId)
        .orderBy(desc(sql`COALESCE(SUM(${aiUsageRecords.costUsd}), 0)`))
        .limit(DISTINCT_LIMIT + 1);

    if (userTotalsRaw.length > DISTINCT_LIMIT) {
        throw createHttpError(
            HttpCode.BAD_REQUEST,
            "Too many distinct users. Please narrow your query."
        );
    }

    const userIds = userTotalsRaw
        .map((r) => r.userId)
        .filter((id): id is string => id !== null);

    const emailMap = new Map<string, string | null>();
    if (userIds.length > 0) {
        const userDetails = await db
            .select({ userId: users.userId, email: users.email })
            .from(users)
            .where(inArray(users.userId, userIds));
        for (const u of userDetails) {
            emailMap.set(u.userId, u.email);
        }
    }

    const topUsers = userTotalsRaw.map((r) => ({
        userId: r.userId,
        email: r.userId ? emailMap.get(r.userId) ?? null : null,
        requests: r.requests,
        totalTokens: r.totalTokens,
        costUsd: r.costUsd
    }));

    const userCostTotals = new Map<string, number>();
    const userTokenTotals = new Map<string, number>();
    for (const row of userByDay) {
        const key = row.userId ?? UNKNOWN_USER_KEY;
        userCostTotals.set(key, (userCostTotals.get(key) ?? 0) + row.cost);
        userTokenTotals.set(key, (userTokenTotals.get(key) ?? 0) + row.tokens);
    }
    const topUsersByCost = pickTopNKeys(userCostTotals);
    const topUsersByTokens = pickTopNKeys(userTokenTotals);

    const userCostPerDay = bucketTopNPerDay(
        userByDay.map((r) => ({
            day: r.day,
            key: r.userId ?? UNKNOWN_USER_KEY,
            value: r.cost
        })),
        topUsersByCost
    );
    const userTokensPerDay = bucketTopNPerDay(
        userByDay.map((r) => ({
            day: r.day,
            key: r.userId ?? UNKNOWN_USER_KEY,
            value: r.tokens
        })),
        topUsersByTokens
    );

    // Resolve every user's role membership(s) in this org so usage can be
    // expanded into per-role totals.
    const userToRoles = new Map<string, { roleId: number; name: string | null }[]>();
    if (userIds.length > 0) {
        const roleRows = await db
            .select({
                userId: userOrgRoles.userId,
                roleId: roles.roleId,
                name: roles.name
            })
            .from(userOrgRoles)
            .innerJoin(roles, eq(userOrgRoles.roleId, roles.roleId))
            .where(
                and(
                    eq(userOrgRoles.orgId, data.orgId),
                    inArray(userOrgRoles.userId, userIds)
                )
            );
        for (const row of roleRows) {
            const existing = userToRoles.get(row.userId) ?? [];
            existing.push({ roleId: row.roleId, name: row.name });
            userToRoles.set(row.userId, existing);
        }
    }

    const roleTotals = new Map<
        number,
        { name: string | null; requests: number; totalTokens: number; costUsd: number }
    >();
    for (const r of userTotalsRaw) {
        if (!r.userId) continue;
        const userRoles = userToRoles.get(r.userId) ?? [];
        for (const role of userRoles) {
            const existing = roleTotals.get(role.roleId) ?? {
                name: role.name,
                requests: 0,
                totalTokens: 0,
                costUsd: 0
            };
            existing.requests += r.requests;
            existing.totalTokens += r.totalTokens;
            existing.costUsd += r.costUsd;
            roleTotals.set(role.roleId, existing);
        }
    }

    const topRoles = [...roleTotals.entries()]
        .map(([roleId, v]) => ({ roleId, ...v }))
        .sort((a, b) => b.costUsd - a.costUsd);

    const roleCostRows: { day: string; key: string; value: number }[] = [];
    const roleTokenRows: { day: string; key: string; value: number }[] = [];
    for (const row of userByDay) {
        if (!row.userId) continue;
        const userRoles = userToRoles.get(row.userId) ?? [];
        for (const role of userRoles) {
            roleCostRows.push({ day: row.day, key: String(role.roleId), value: row.cost });
            roleTokenRows.push({ day: row.day, key: String(role.roleId), value: row.tokens });
        }
    }

    const roleCostTotals = new Map<string, number>();
    const roleTokenTotals = new Map<string, number>();
    for (const row of roleCostRows) {
        roleCostTotals.set(row.key, (roleCostTotals.get(row.key) ?? 0) + row.value);
    }
    for (const row of roleTokenRows) {
        roleTokenTotals.set(row.key, (roleTokenTotals.get(row.key) ?? 0) + row.value);
    }
    const topRolesByCost = pickTopNKeys(roleCostTotals);
    const topRolesByTokens = pickTopNKeys(roleTokenTotals);

    const roleCostPerDay = bucketTopNPerDay(roleCostRows, topRolesByCost);
    const roleTokensPerDay = bucketTopNPerDay(roleTokenRows, topRolesByTokens);

    return {
        topUsers,
        userCostPerDay,
        userTokensPerDay,
        topRoles,
        roleCostPerDay,
        roleTokensPerDay
    };
}

registry.registerPath({
    method: "get",
    path: "/org/{orgId}/logs/ai/usage/users-roles",
    description:
        "Query the AI usage analytics user and role breakdown for an organization",
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

export type QueryAiUsageUsersRolesResponse = Awaited<ReturnType<typeof query>>;

export async function queryAiUsageUsersRoles(
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

        return response<QueryAiUsageUsersRolesResponse>(res, {
            data,
            success: true,
            error: false,
            message: "AI usage user/role breakdown retrieved successfully",
            status: HttpCode.OK
        });
    } catch (error) {
        logger.error(error);
        return next(
            createHttpError(HttpCode.INTERNAL_SERVER_ERROR, "An error occurred")
        );
    }
}
