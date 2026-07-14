import {
    logsDb,
    requestAuditLog,
    resources,
    siteResources,
    db,
    primaryDb
} from "@server/db";
import { registry } from "@server/openApi";
import { NextFunction } from "express";
import { Request, Response } from "express";
import { eq, gt, lt, and, count, desc, inArray, or } from "drizzle-orm";
import { OpenAPITags } from "@server/openApi";
import { z } from "zod";
import createHttpError from "http-errors";
import HttpCode from "@server/types/HttpCode";
import { fromError } from "zod-validation-error";
import { QueryRequestAuditLogResponse } from "@server/routers/auditLogs/types";
import response from "@server/lib/response";
import logger from "@server/logger";
import { getSevenDaysAgo } from "@app/lib/getSevenDaysAgo";

export const queryAccessAuditLogsQuery = z.strictObject({
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
    method: z.enum(["GET", "POST", "PUT", "DELETE", "PATCH"]).optional(),
    reason: z
        .string()
        .optional()
        .transform(Number)
        .pipe(z.int().positive())
        .optional(),
    resourceId: z
        .string()
        .optional()
        .transform(Number)
        .pipe(z.int().positive())
        .optional(),
    actor: z.string().optional(),
    location: z.string().optional(),
    host: z.string().optional(),
    path: z.string().optional(),
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

export const queryRequestAuditLogsParams = z.object({
    orgId: z.string()
});

export const queryRequestAuditLogsCombined = queryAccessAuditLogsQuery.merge(
    queryRequestAuditLogsParams
);
type Q = z.infer<typeof queryRequestAuditLogsCombined>;

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
        gt(requestAuditLog.timestamp, data.timeStart),
        lt(requestAuditLog.timestamp, data.timeEnd),
        eq(requestAuditLog.orgId, data.orgId),
        data.resourceId
            ? or(
                  eq(requestAuditLog.resourceId, data.resourceId),
                  eq(requestAuditLog.siteResourceId, data.resourceId)
              )
            : undefined,
        data.actor ? eq(requestAuditLog.actor, data.actor) : undefined,
        data.method ? eq(requestAuditLog.method, data.method) : undefined,
        data.reason ? eq(requestAuditLog.reason, data.reason) : undefined,
        data.host ? eq(requestAuditLog.host, data.host) : undefined,
        data.location ? eq(requestAuditLog.location, data.location) : undefined,
        data.path ? eq(requestAuditLog.path, data.path) : undefined,
        data.action !== undefined
            ? eq(requestAuditLog.action, data.action)
            : undefined
    );
}

export function queryRequest(data: Q) {
    return logsDb
        .select({
            id: requestAuditLog.id,
            timestamp: requestAuditLog.timestamp,
            orgId: requestAuditLog.orgId,
            action: requestAuditLog.action,
            reason: requestAuditLog.reason,
            actorType: requestAuditLog.actorType,
            actor: requestAuditLog.actor,
            actorId: requestAuditLog.actorId,
            resourceId: requestAuditLog.resourceId,
            siteResourceId: requestAuditLog.siteResourceId,
            ip: requestAuditLog.ip,
            location: requestAuditLog.location,
            userAgent: requestAuditLog.userAgent,
            metadata: requestAuditLog.metadata,
            headers: requestAuditLog.headers,
            query: requestAuditLog.query,
            originalRequestURL: requestAuditLog.originalRequestURL,
            scheme: requestAuditLog.scheme,
            host: requestAuditLog.host,
            path: requestAuditLog.path,
            method: requestAuditLog.method,
            tls: requestAuditLog.tls
        })
        .from(requestAuditLog)
        .where(getWhere(data))
        .orderBy(desc(requestAuditLog.timestamp));
}

async function enrichWithResourceDetails(
    logs: Awaited<ReturnType<typeof queryRequest>>
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
                resourceId: log.siteResourceId,
                resourceName: details?.name ?? null,
                resourceNiceId: details?.niceId ?? null
            };
        }
        return { ...log, resourceName: null, resourceNiceId: null };
    });
}

export function countRequestQuery(data: Q) {
    const countQuery = logsDb
        .select({ count: count() })
        .from(requestAuditLog)
        .where(getWhere(data));
    return countQuery;
}

registry.registerPath({
    method: "get",
    path: "/org/{orgId}/logs/request",
    description: "Query the request audit log for an organization",
    tags: [OpenAPITags.Logs],
    request: {
        query: queryAccessAuditLogsQuery,
        params: queryRequestAuditLogsParams
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
        gt(requestAuditLog.timestamp, timeStart),
        lt(requestAuditLog.timestamp, timeEnd),
        eq(requestAuditLog.orgId, orgId)
    );

    const DISTINCT_LIMIT = 500;

    // Previously this ran 6 separate SELECT DISTINCT queries, each of which
    // independently re-scanned every row in the org+time range (there's no
    // index on actor/location/host/path/resourceId/siteResourceId, so a
    // DISTINCT on any of them can't avoid scanning the whole matched range).
    // That was 6x the necessary I/O for what is fundamentally one scan.
    //
    // Instead we scan the matching rows once and compute all six distinct
    // sets in memory in the same pass. Each set is capped at
    // DISTINCT_LIMIT + 1 entries (mirroring the old per-query limits) so a
    // huge time range with e.g. thousands of unique paths can't blow up
    // memory.
    const actorSet = new Set<string>();
    const locationSet = new Set<string>();
    const hostSet = new Set<string>();
    const pathSet = new Set<string>();
    const resourceIdSet = new Set<number>();
    const siteResourceIdSet = new Set<number>();

    const rows = await logsDb
        .select({
            actor: requestAuditLog.actor,
            location: requestAuditLog.location,
            host: requestAuditLog.host,
            path: requestAuditLog.path,
            resourceId: requestAuditLog.resourceId,
            siteResourceId: requestAuditLog.siteResourceId
        })
        .from(requestAuditLog)
        .where(baseConditions);

    for (const row of rows) {
        if (row.actor !== null && actorSet.size <= DISTINCT_LIMIT) {
            actorSet.add(row.actor);
        }
        if (row.location !== null && locationSet.size <= DISTINCT_LIMIT) {
            locationSet.add(row.location);
        }
        if (row.host !== null && hostSet.size <= DISTINCT_LIMIT) {
            hostSet.add(row.host);
        }
        if (row.path !== null && pathSet.size <= DISTINCT_LIMIT) {
            pathSet.add(row.path);
        }
        if (row.resourceId !== null) {
            if (resourceIdSet.size <= DISTINCT_LIMIT) {
                resourceIdSet.add(row.resourceId);
            }
        } else if (
            row.siteResourceId !== null &&
            siteResourceIdSet.size <= DISTINCT_LIMIT
        ) {
            // Mirrors the original query's isNull(resourceId) condition:
            // a siteResourceId only counts when there's no resourceId.
            siteResourceIdSet.add(row.siteResourceId);
        }
    }

    const uniqueActors = Array.from(actorSet);
    const uniqueLocations = Array.from(locationSet);
    const uniqueHosts = Array.from(hostSet);
    const uniquePaths = Array.from(pathSet);

    // TODO: for stuff like the paths this is too restrictive so lets just show some of the paths and the user needs to
    // refine the time range to see what they need to see
    // if (
    //     uniqueActors.length > DISTINCT_LIMIT ||
    //     uniqueLocations.length > DISTINCT_LIMIT ||
    //     uniqueHosts.length > DISTINCT_LIMIT ||
    //     uniquePaths.length > DISTINCT_LIMIT ||
    //     resourceIdSet.size > DISTINCT_LIMIT
    // ) {
    //     throw new Error("Too many distinct filter attributes to retrieve. Please refine your time range.");
    // }

    // Fetch resource names from main database for the unique resource IDs
    const resourceIds = Array.from(resourceIdSet);
    const siteResourceIds = Array.from(siteResourceIdSet);

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
        actors: uniqueActors,
        resources: sortNamedFilterOptions(resourcesWithNames),
        locations: uniqueLocations,
        hosts: uniqueHosts,
        paths: uniquePaths
    };
}

export async function queryRequestAuditLogs(
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

        const data = { ...parsedQuery.data, ...parsedParams.data };

        const baseQuery = queryRequest(data);

        const logsRaw = await baseQuery.limit(data.limit).offset(data.offset);

        // Enrich with resource details (handles cross-database scenario)
        const log = await enrichWithResourceDetails(logsRaw);

        const totalCountResult = await countRequestQuery(data);
        const totalCount = totalCountResult[0].count;

        const filterAttributes = await queryUniqueFilterAttributes(
            data.timeStart,
            data.timeEnd,
            data.orgId
        );

        return response<QueryRequestAuditLogResponse>(res, {
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
            message: "Request audit logs retrieved successfully",
            status: HttpCode.OK
        });
    } catch (error) {
        logger.error(error);
        // if the message is "Too many distinct filter attributes to retrieve. Please refine your time range.", return a 400 and the message
        if (
            error instanceof Error &&
            error.message ===
                "Too many distinct filter attributes to retrieve. Please refine your time range."
        ) {
            return next(createHttpError(HttpCode.BAD_REQUEST, error.message));
        }
        return next(
            createHttpError(HttpCode.INTERNAL_SERVER_ERROR, "An error occurred")
        );
    }
}