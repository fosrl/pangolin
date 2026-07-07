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

import {
    accessAuditLog,
    logsDb,
    resources,
    siteResources,
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
        gt(accessAuditLog.timestamp, data.timeStart),
        lt(accessAuditLog.timestamp, data.timeEnd),
        eq(accessAuditLog.orgId, data.orgId),
        data.resourceId
            ? or(
                  eq(accessAuditLog.resourceId, data.resourceId),
                  eq(accessAuditLog.siteResourceId, data.resourceId)
              )
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
    return logsDb
        .select({
            orgId: accessAuditLog.orgId,
            action: accessAuditLog.action,
            actorType: accessAuditLog.actorType,
            actorId: accessAuditLog.actorId,
            resourceId: accessAuditLog.resourceId,
            siteResourceId: accessAuditLog.siteResourceId,
            ip: accessAuditLog.ip,
            location: accessAuditLog.location,
            userAgent: accessAuditLog.userAgent,
            metadata: accessAuditLog.metadata,
            type: accessAuditLog.type,
            timestamp: accessAuditLog.timestamp,
            actor: accessAuditLog.actor
        })
        .from(accessAuditLog)
        .where(getWhere(data))
        .orderBy(desc(accessAuditLog.timestamp), desc(accessAuditLog.id));
}

async function enrichWithResourceDetails(
    logs: Awaited<ReturnType<typeof queryAccess>>
) {
    const resourceIds = logs
        .map((log) => log.resourceId)
        .filter((id): id is number => id !== null && id !== undefined);

    const siteResourceIds = logs
        .filter((log) => log.resourceId == null && log.siteResourceId != null)
        .map((log) => log.siteResourceId)
        .filter((id): id is number => id !== null && id !== undefined);

    if (resourceIds.length === 0 && siteResourceIds.length === 0) {
        return logs.map((log) => ({
            ...log,
            resourceName: null,
            resourceNiceId: null
        }));
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

    // Enrich logs with resource details
    return logs.map((log) => {
        if (log.resourceId != null) {
            const details = resourceMap.get(log.resourceId);
            return {
                ...log,
                resourceName: details?.name ?? null,
                resourceNiceId: details?.niceId ?? null
            };
        } else if (log.siteResourceId != null) {
            const details = siteResourceMap.get(log.siteResourceId);
            return {
                ...log,
                resourceName: details?.name ?? null,
                resourceNiceId: details?.niceId ?? null
            };
        }
        return { ...log, resourceName: null, resourceNiceId: null };
    });
}

export function countAccessQuery(data: Q) {
    const countQuery = logsDb
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
    const uniqueActors = await logsDb
        .selectDistinct({
            actor: accessAuditLog.actor
        })
        .from(accessAuditLog)
        .where(baseConditions);

    // Get unique locations
    const uniqueLocations = await logsDb
        .selectDistinct({
            locations: accessAuditLog.location
        })
        .from(accessAuditLog)
        .where(baseConditions);

    // Get unique resources with names
    const uniqueResources = await logsDb
        .selectDistinct({
            id: accessAuditLog.resourceId
        })
        .from(accessAuditLog)
        .where(baseConditions);

    // Get unique siteResources (only for logs where resourceId is null)
    const uniqueSiteResources = await logsDb
        .selectDistinct({
            id: accessAuditLog.siteResourceId
        })
        .from(accessAuditLog)
        .where(and(baseConditions, isNull(accessAuditLog.resourceId)));

    // Fetch resource names from main database for the unique resource IDs
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

    return {
        actors: uniqueActors
            .map((row) => row.actor)
            .filter((actor): actor is string => actor !== null),
        resources: sortNamedFilterOptions(resourcesWithNames),
        locations: uniqueLocations
            .map((row) => row.locations)
            .filter((location): location is string => location !== null)
    };
}

registry.registerPath({
    method: "get",
    path: "/org/{orgId}/logs/access",
    description: "Query the access audit log for an organization",
    tags: [OpenAPITags.Logs],
    request: {
        query: queryAccessAuditLogsQuery,
        params: queryAccessAuditLogsParams
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

        const logsRaw = await baseQuery.limit(data.limit).offset(data.offset);

        // Enrich with resource details (handles cross-database scenario)
        const log = await enrichWithResourceDetails(logsRaw);

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
