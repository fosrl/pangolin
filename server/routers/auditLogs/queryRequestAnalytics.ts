import { db, requestAuditLog, driver } from "@server/db";
import { registry } from "@server/openApi";
import { NextFunction } from "express";
import { Request, Response } from "express";
import { eq, gte, lte, and, count, sql, desc, not, isNull } from "drizzle-orm";
import { OpenAPITags } from "@server/openApi";
import { z } from "zod";
import createHttpError from "http-errors";
import HttpCode from "@server/types/HttpCode";
import { fromError } from "zod-validation-error";
import response from "@server/lib/response";
import logger from "@server/logger";
import { getSevenDaysAgo } from "@app/lib/getSevenDaysAgo";

const queryAccessAuditLogsQuery = z.object({
    // iso string just validate its a parseable date
    timeStart: z
        .string()
        .refine((val) => !isNaN(Date.parse(val)), {
            error: "timeStart must be a valid ISO date string"
        })
        .transform((val) => Math.floor(new Date(val).getTime() / 1000))
        .optional()
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
    resourceId: z
        .string()
        .optional()
        .transform(Number)
        .pipe(z.int().positive())
        .optional()
});

const queryRequestAuditLogsParams = z.object({
    orgId: z.string()
});

const queryRequestAuditLogsCombined = queryAccessAuditLogsQuery.merge(
    queryRequestAuditLogsParams
);

type Q = z.infer<typeof queryRequestAuditLogsCombined>;

async function query(query: Q) {
    let baseConditions = and(
        eq(requestAuditLog.orgId, query.orgId),
        gte(requestAuditLog.timestamp, query.timeStart),
        lte(requestAuditLog.timestamp, query.timeEnd)
    );

    if (query.resourceId) {
        baseConditions = and(
            baseConditions,
            eq(requestAuditLog.resourceId, query.resourceId)
        );
    }

    const [all] = await db
        .select({ total: count() })
        .from(requestAuditLog)
        .where(baseConditions);

    const [blocked] = await db
        .select({ total: count() })
        .from(requestAuditLog)
        .where(and(baseConditions, eq(requestAuditLog.action, false)));

    const totalQ = sql<number>`count(${requestAuditLog.id})`
        .mapWith(Number)
        .as("total");

    const requestsPerCountry = await db
        .selectDistinct({
            code: requestAuditLog.location,
            count: totalQ
        })
        .from(requestAuditLog)
        .where(and(baseConditions, not(isNull(requestAuditLog.location))))
        .groupBy(requestAuditLog.location)
        .orderBy(desc(totalQ));

    const groupByDayFunction =
        driver === "pg"
            ? sql<string>`DATE_TRUNC('day', TO_TIMESTAMP(${requestAuditLog.timestamp}))`
            : sql<string>`DATE(${requestAuditLog.timestamp}, 'unixepoch')`;

    const booleanTrue = driver === "pg" ? sql`true` : sql`1`;
    const booleanFalse = driver === "pg" ? sql`false` : sql`0`;

    const requestsPerDay = await db
        .select({
            day: groupByDayFunction.as("day"),
            allowedCount:
                sql<number>`SUM(CASE WHEN ${requestAuditLog.action} = ${booleanTrue} THEN 1 ELSE 0 END)`.as(
                    "allowed_count"
                ),
            blockedCount:
                sql<number>`SUM(CASE WHEN ${requestAuditLog.action} = ${booleanFalse} THEN 1 ELSE 0 END)`.as(
                    "blocked_count"
                ),
            totalCount: sql<number>`COUNT(*)`.as("total_count")
        })
        .from(requestAuditLog)
        .where(and(baseConditions))
        .groupBy(groupByDayFunction)
        .orderBy(groupByDayFunction);

    return {
        requestsPerCountry: requestsPerCountry as Array<{
            code: string;
            count: number;
        }>,
        requestsPerDay,
        totalBlocked: blocked.total,
        totalRequests: all.total
    };
}

registry.registerPath({
    method: "get",
    path: "/org/{orgId}/logs/analytics",
    description: "Query the request audit analytics for an organization",
    tags: [OpenAPITags.Org],
    request: {
        query: queryAccessAuditLogsQuery,
        params: queryRequestAuditLogsParams
    },
    responses: {}
});

export type QueryRequestAnalyticsResponse = Awaited<ReturnType<typeof query>>;

export async function queryRequestAnalytics(
    req: Request,
    res: Response,
    next: NextFunction
): Promise<any> {
    try {
        const parsedQuery = queryAccessAuditLogsQuery.safeParse(req.query);
        if (!parsedQuery.success) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    fromError(parsedQuery.error)
                )
            );
        }

        const parsedParams = queryRequestAuditLogsParams.safeParse(req.params);
        if (!parsedParams.success) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    fromError(parsedParams.error)
                )
            );
        }

        const params = { ...parsedQuery.data, ...parsedParams.data };

        const data = await query(params);

        return response<QueryRequestAnalyticsResponse>(res, {
            data,
            success: true,
            error: false,
            message: "Request audit analytics retrieved successfully",
            status: HttpCode.OK
        });
    } catch (error) {
        logger.error(error);
        return next(
            createHttpError(HttpCode.INTERNAL_SERVER_ERROR, "An error occurred")
        );
    }
}
