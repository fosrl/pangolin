/*
 * This file is part of a proprietary work.
 *
 * Copyright (c) 2025 Fossorial, Inc.
 * All rights reserved.
 *
 * This file is licensed under the Fossorial Commercial License.
 * You may not use this file except in compliance with the License.
 * Unauthorized use, copying, modification, or distribution is strictly prohibited.
 *
 * This file is not licensed under the AGPLv3.
 */

import { accessAuditLog, db, resources } from "@server/db";
import { registry } from "@server/openApi";
import { NextFunction } from "express";
import { Request, Response } from "express";
import { eq, gt, lt, and, count, desc } from "drizzle-orm";
import { OpenAPITags } from "@server/openApi";
import { z } from "zod";
import createHttpError from "http-errors";
import HttpCode from "@server/types/HttpCode";
import { fromError } from "zod-validation-error";
import { QueryAccessAuditLogResponse } from "@server/routers/auditLogs/types";
import response from "@server/lib/response";
import logger from "@server/logger";
import { getSevenDaysAgo } from "@app/lib/getSevenDaysAgo";

export const queryAccessAuditLogsQuery = z.object({
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
    action: z
        .union([z.boolean(), z.string()])
        .transform((val) => (typeof val === "string" ? val === "true" : val))
        .optional(),
    actorType: z.string().optional(),
    actorId: z.string().optional(),
    resourceId: z
        .string()
        .optional()
        .transform(Number)
        .pipe(z.int().positive())
        .optional(),
    actor: z.string().optional(),
    type: z.string().optional(),
    location: z.string().optional(),
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

export const queryAccessAuditLogsParams = z.object({
    orgId: z.string()
});

export const queryAccessAuditLogsCombined = queryAccessAuditLogsQuery.merge(
    queryAccessAuditLogsParams
);
type Q = z.infer<typeof queryAccessAuditLogsCombined>;

function getWhere(data: Q) {
    return and(
        gt(accessAuditLog.timestamp, data.timeStart),
        lt(accessAuditLog.timestamp, data.timeEnd),
        eq(accessAuditLog.orgId, data.orgId),
        data.resourceId
            ? eq(accessAuditLog.resourceId, data.resourceId)
            : undefined,
        data.actor ? eq(accessAuditLog.actor, data.actor) : undefined,
        data.actorType
            ? eq(accessAuditLog.actorType, data.actorType)
            : undefined,
        data.actorId ? eq(accessAuditLog.actorId, data.actorId) : undefined,
        data.location ? eq(accessAuditLog.location, data.location) : undefined,
        data.type ? eq(accessAuditLog.type, data.type) : undefined,
        data.action !== undefined
            ? eq(accessAuditLog.action, data.action)
            : undefined
    );
}

export function queryAccess(data: Q) {
    return db
        .select({
            orgId: accessAuditLog.orgId,
            action: accessAuditLog.action,
            actorType: accessAuditLog.actorType,
            actorId: accessAuditLog.actorId,
            resourceId: accessAuditLog.resourceId,
            resourceName: resources.name,
            resourceNiceId: resources.niceId,
            ip: accessAuditLog.ip,
            location: accessAuditLog.location,
            userAgent: accessAuditLog.userAgent,
            metadata: accessAuditLog.metadata,
            type: accessAuditLog.type,
            timestamp: accessAuditLog.timestamp,
            actor: accessAuditLog.actor
        })
        .from(accessAuditLog)
        .leftJoin(
            resources,
            eq(accessAuditLog.resourceId, resources.resourceId)
        )
        .where(getWhere(data))
        .orderBy(desc(accessAuditLog.timestamp), desc(accessAuditLog.id));
}

export function countAccessQuery(data: Q) {
    const countQuery = db
        .select({ count: count() })
        .from(accessAuditLog)
        .where(getWhere(data));
    return countQuery;
}

async function queryUniqueFilterAttributes(
    timeStart: number,
    timeEnd: number,
    orgId: string
) {
    const baseConditions = and(
        gt(accessAuditLog.timestamp, timeStart),
        lt(accessAuditLog.timestamp, timeEnd),
        eq(accessAuditLog.orgId, orgId)
    );

    // Get unique actors
    const uniqueActors = await db
        .selectDistinct({
            actor: accessAuditLog.actor
        })
        .from(accessAuditLog)
        .where(baseConditions);

    // Get unique locations
    const uniqueLocations = await db
        .selectDistinct({
            locations: accessAuditLog.location
        })
        .from(accessAuditLog)
        .where(baseConditions);

    // Get unique resources with names
    const uniqueResources = await db
        .selectDistinct({
            id: accessAuditLog.resourceId,
            name: resources.name
        })
        .from(accessAuditLog)
        .leftJoin(
            resources,
            eq(accessAuditLog.resourceId, resources.resourceId)
        )
        .where(baseConditions);

    return {
        actors: uniqueActors
            .map((row) => row.actor)
            .filter((actor): actor is string => actor !== null),
        resources: uniqueResources.filter(
            (row): row is { id: number; name: string | null } => row.id !== null
        ),
        locations: uniqueLocations
            .map((row) => row.locations)
            .filter((location): location is string => location !== null)
    };
}

registry.registerPath({
    method: "get",
    path: "/org/{orgId}/logs/access",
    description: "Query the access audit log for an organization",
    tags: [OpenAPITags.Org],
    request: {
        query: queryAccessAuditLogsQuery,
        params: queryAccessAuditLogsParams
    },
    responses: {}
});

export async function queryAccessAuditLogs(
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
        const parsedParams = queryAccessAuditLogsParams.safeParse(req.params);
        if (!parsedParams.success) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    fromError(parsedParams.error)
                )
            );
        }

        const data = { ...parsedQuery.data, ...parsedParams.data };

        const baseQuery = queryAccess(data);

        const log = await baseQuery.limit(data.limit).offset(data.offset);

        const totalCountResult = await countAccessQuery(data);
        const totalCount = totalCountResult[0].count;

        const filterAttributes = await queryUniqueFilterAttributes(
            data.timeStart,
            data.timeEnd,
            data.orgId
        );

        return response<QueryAccessAuditLogResponse>(res, {
            data: {
                log: log,
                pagination: {
                    total: totalCount,
                    limit: data.limit,
                    offset: data.offset
                },
                filterAttributes
            },
            success: true,
            error: false,
            message: "Access audit logs retrieved successfully",
            status: HttpCode.OK
        });
    } catch (error) {
        logger.error(error);
        return next(
            createHttpError(HttpCode.INTERNAL_SERVER_ERROR, "An error occurred")
        );
    }
}
