/*
 * This file is part of a proprietary work.
 *
 * Copyright (c) 2025-2026 Fossorial, Inc.
 * All rights reserved.
 *
 * This file is licensed under the Fossorial Commercial License.
 * You may not use this file except in compliance with the License.
 * Unauthorized use, copying, modification, or distribution is strictly prohibited.
 *
 * This file is not licensed under the AGPLv3.
 */

import { Request, Response, NextFunction } from "express";
import { z } from "zod";
import { clients, db, dnsBlockLog, driver, logsDb, users } from "@server/db";
import response from "@server/lib/response";
import HttpCode from "@server/types/HttpCode";
import createHttpError from "http-errors";
import logger from "@server/logger";
import { fromError } from "zod-validation-error";
import { OpenAPITags, registry } from "@server/openApi";
import { and, desc, eq, gte, inArray, like, lte, sql } from "drizzle-orm";
import { getSevenDaysAgo } from "@app/lib/getSevenDaysAgo";
import type {
    DnsBlockAnalyticsResponse,
    DnsBlockLogRow,
    QueryDnsBlockLogsResponse
} from "@server/routers/dnsBlocking/types";

const paramsSchema = z.strictObject({
    orgId: z.string().nonempty()
});

const isoToEpoch = (val: string) => Math.floor(new Date(val).getTime() / 1000);

const timeRangeShape = {
    timeStart: z
        .string()
        .refine((val) => !isNaN(Date.parse(val)), {
            error: "timeStart must be a valid ISO date string"
        })
        .transform(isoToEpoch)
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
        .transform(isoToEpoch)
        .prefault(() => new Date().toISOString())
        .openapi({
            type: "string",
            format: "date-time",
            description: "End time as ISO date string (defaults to now)"
        })
};

const analyticsQuerySchema = z.object(timeRangeShape);

const logsQuerySchema = z.object({
    ...timeRangeShape,
    domain: z.string().trim().max(253).optional(),
    userId: z.string().optional(),
    limit: z.coerce.number<string>().int().positive().max(1000).default(50),
    offset: z.coerce.number<string>().int().min(0).default(0)
});

const TOP_N = 10;

registry.registerPath({
    method: "get",
    path: "/org/{orgId}/logs/dns-blocks",
    description: "Query blocked DNS requests, grouped by domain and device.",
    tags: [OpenAPITags.Logs],
    request: { params: paramsSchema, query: logsQuerySchema },
    responses: { 200: { description: "Successful response" } }
});

export async function queryDnsBlockLogs(
    req: Request,
    res: Response,
    next: NextFunction
): Promise<any> {
    try {
        const parsedParams = paramsSchema.safeParse(req.params);
        const parsedQuery = logsQuerySchema.safeParse(req.query);
        if (!parsedParams.success || !parsedQuery.success) {
            const error = !parsedParams.success
                ? parsedParams.error
                : parsedQuery.error!;
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    fromError(error).toString()
                )
            );
        }
        const { orgId } = parsedParams.data;
        const q = parsedQuery.data;

        const conditions = [
            eq(dnsBlockLog.orgId, orgId),
            gte(dnsBlockLog.timestamp, q.timeStart),
            lte(dnsBlockLog.timestamp, q.timeEnd)
        ];
        if (q.domain) {
            conditions.push(
                like(dnsBlockLog.domain, `%${q.domain.toLowerCase()}%`)
            );
        }
        if (q.userId) conditions.push(eq(dnsBlockLog.userId, q.userId));
        const where = and(...conditions);

        const grouped = logsDb
            .select({
                domain: dnsBlockLog.domain,
                userId: dnsBlockLog.userId,
                clientId: dnsBlockLog.clientId,
                count: sql<number>`SUM(${dnsBlockLog.count})`
                    .mapWith(Number)
                    .as("total_count"),
                lastBlocked: sql<number>`MAX(${dnsBlockLog.timestamp})`
                    .mapWith(Number)
                    .as("last_blocked")
            })
            .from(dnsBlockLog)
            .where(where)
            .groupBy(
                dnsBlockLog.domain,
                dnsBlockLog.userId,
                dnsBlockLog.clientId
            );

        const total = await logsDb.$count(grouped.as("grouped"));

        const rows = await grouped
            .orderBy(desc(sql`total_count`))
            .limit(q.limit)
            .offset(q.offset);

        // Names live in the main database, which may differ from the logs one.
        const userIds = [
            ...new Set(rows.map((r) => r.userId).filter(Boolean))
        ] as string[];
        const clientIds = [
            ...new Set(rows.map((r) => r.clientId).filter((c) => c !== null))
        ] as number[];
        const userRows = userIds.length
            ? await db
                  .select({ userId: users.userId, username: users.username })
                  .from(users)
                  .where(inArray(users.userId, userIds))
            : [];
        const clientRows = clientIds.length
            ? await db
                  .select({ clientId: clients.clientId, name: clients.name })
                  .from(clients)
                  .where(inArray(clients.clientId, clientIds))
            : [];
        const usernames = new Map(userRows.map((u) => [u.userId, u.username]));
        const clientNames = new Map(
            clientRows.map((c) => [c.clientId, c.name])
        );

        const data: DnsBlockLogRow[] = rows.map((r) => ({
            domain: r.domain,
            count: r.count,
            lastBlocked: r.lastBlocked,
            userId: r.userId,
            username: r.userId ? (usernames.get(r.userId) ?? null) : null,
            clientId: r.clientId,
            clientName:
                r.clientId !== null
                    ? (clientNames.get(r.clientId) ?? null)
                    : null
        }));

        return response<QueryDnsBlockLogsResponse>(res, {
            data: {
                rows: data,
                pagination: { total, limit: q.limit, offset: q.offset }
            },
            success: true,
            error: false,
            message: "DNS block logs retrieved successfully",
            status: HttpCode.OK
        });
    } catch (error) {
        logger.error(error);
        return next(
            createHttpError(HttpCode.INTERNAL_SERVER_ERROR, "An error occurred")
        );
    }
}

registry.registerPath({
    method: "get",
    path: "/org/{orgId}/logs/dns-blocks/analytics",
    description: "Analytics for blocked DNS requests in an organization.",
    tags: [OpenAPITags.Logs],
    request: { params: paramsSchema, query: analyticsQuerySchema },
    responses: { 200: { description: "Successful response" } }
});

export async function queryDnsBlockAnalytics(
    req: Request,
    res: Response,
    next: NextFunction
): Promise<any> {
    try {
        const parsedParams = paramsSchema.safeParse(req.params);
        const parsedQuery = analyticsQuerySchema.safeParse(req.query);
        if (!parsedParams.success || !parsedQuery.success) {
            const error = !parsedParams.success
                ? parsedParams.error
                : parsedQuery.error!;
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    fromError(error).toString()
                )
            );
        }
        const { orgId } = parsedParams.data;
        const { timeStart, timeEnd } = parsedQuery.data;

        const where = and(
            eq(dnsBlockLog.orgId, orgId),
            gte(dnsBlockLog.timestamp, timeStart),
            lte(dnsBlockLog.timestamp, timeEnd)
        );

        const sumCount =
            sql<number>`COALESCE(SUM(${dnsBlockLog.count}), 0)`.mapWith(Number);

        const [totals] = await logsDb
            .select({
                totalBlocked: sumCount,
                uniqueDomains:
                    sql<number>`COUNT(DISTINCT ${dnsBlockLog.domain})`.mapWith(
                        Number
                    ),
                activeClients:
                    sql<number>`COUNT(DISTINCT ${dnsBlockLog.clientId})`.mapWith(
                        Number
                    )
            })
            .from(dnsBlockLog)
            .where(where);

        const topDomains = await logsDb
            .select({
                domain: dnsBlockLog.domain,
                count: sql<number>`SUM(${dnsBlockLog.count})`
                    .mapWith(Number)
                    .as("total_count")
            })
            .from(dnsBlockLog)
            .where(where)
            .groupBy(dnsBlockLog.domain)
            .orderBy(desc(sql`total_count`))
            .limit(TOP_N);

        const topUserRows = await logsDb
            .select({
                userId: dnsBlockLog.userId,
                count: sql<number>`SUM(${dnsBlockLog.count})`
                    .mapWith(Number)
                    .as("total_count")
            })
            .from(dnsBlockLog)
            .where(where)
            .groupBy(dnsBlockLog.userId)
            .orderBy(desc(sql`total_count`))
            .limit(TOP_N);

        const topUserIds = topUserRows
            .map((r) => r.userId)
            .filter((id): id is string => !!id);
        const userRows = topUserIds.length
            ? await db
                  .select({ userId: users.userId, username: users.username })
                  .from(users)
                  .where(inArray(users.userId, topUserIds))
            : [];
        const usernames = new Map(userRows.map((u) => [u.userId, u.username]));

        const dayBucket =
            driver === "pg"
                ? sql<string>`DATE_TRUNC('day', TO_TIMESTAMP(${dnsBlockLog.timestamp}))`
                : sql<string>`DATE(${dnsBlockLog.timestamp}, 'unixepoch')`;

        const perDay = await logsDb
            .select({
                day: dayBucket.as("day"),
                count: sql<number>`SUM(${dnsBlockLog.count})`.as("day_count")
            })
            .from(dnsBlockLog)
            .where(where)
            .groupBy(dayBucket)
            .orderBy(dayBucket);

        return response<DnsBlockAnalyticsResponse>(res, {
            data: {
                totalBlocked: totals?.totalBlocked ?? 0,
                uniqueDomains: totals?.uniqueDomains ?? 0,
                activeClients: totals?.activeClients ?? 0,
                topDomains,
                topUsers: topUserRows.map((r) => ({
                    userId: r.userId,
                    username: r.userId
                        ? (usernames.get(r.userId) ?? null)
                        : null,
                    count: r.count
                })),
                timeSeries: perDay.map((d) => ({
                    day: String(d.day),
                    count: Number(d.count)
                }))
            },
            success: true,
            error: false,
            message: "DNS block analytics retrieved successfully",
            status: HttpCode.OK
        });
    } catch (error) {
        logger.error(error);
        return next(
            createHttpError(HttpCode.INTERNAL_SERVER_ERROR, "An error occurred")
        );
    }
}
