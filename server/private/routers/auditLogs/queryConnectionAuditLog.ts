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
    connectionAuditLog,
    logsDb,
    siteResources,
    sites,
    clients,
    users,
    primaryDb
} from "@server/db";
import { registry } from "@server/openApi";
import { NextFunction } from "express";
import { Request, Response } from "express";
import { eq, gt, lt, and, count, desc, inArray } from "drizzle-orm";
import { OpenAPITags } from "@server/openApi";
import { z } from "zod";
import createHttpError from "http-errors";
import HttpCode from "@server/types/HttpCode";
import { fromError } from "zod-validation-error";
import { QueryConnectionAuditLogResponse } from "@server/routers/auditLogs/types";
import response from "@server/lib/response";
import logger from "@server/logger";
import { getSevenDaysAgo } from "@app/lib/getSevenDaysAgo";

export const queryConnectionAuditLogsQuery = z.object({
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
    protocol: z.string().optional(),
    sourceAddr: z.string().optional(),
    destAddr: z.string().optional(),
    clientId: z
        .string()
        .optional()
        .transform(Number)
        .pipe(z.int().positive())
        .optional(),
    siteId: z
        .string()
        .optional()
        .transform(Number)
        .pipe(z.int().positive())
        .optional(),
    siteResourceId: z
        .string()
        .optional()
        .transform(Number)
        .pipe(z.int().positive())
        .optional(),
    userId: z.string().optional(),
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

export const queryConnectionAuditLogsParams = z.object({
    orgId: z.string()
});

export const queryConnectionAuditLogsCombined =
    queryConnectionAuditLogsQuery.merge(queryConnectionAuditLogsParams);
type Q = z.infer<typeof queryConnectionAuditLogsCombined>;

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
        gt(connectionAuditLog.startedAt, data.timeStart),
        lt(connectionAuditLog.startedAt, data.timeEnd),
        eq(connectionAuditLog.orgId, data.orgId),
        data.protocol
            ? eq(connectionAuditLog.protocol, data.protocol)
            : undefined,
        data.sourceAddr
            ? eq(connectionAuditLog.sourceAddr, data.sourceAddr)
            : undefined,
        data.destAddr
            ? eq(connectionAuditLog.destAddr, data.destAddr)
            : undefined,
        data.clientId
            ? eq(connectionAuditLog.clientId, data.clientId)
            : undefined,
        data.siteId ? eq(connectionAuditLog.siteId, data.siteId) : undefined,
        data.siteResourceId
            ? eq(connectionAuditLog.siteResourceId, data.siteResourceId)
            : undefined,
        data.userId ? eq(connectionAuditLog.userId, data.userId) : undefined
    );
}

export function queryConnection(data: Q) {
    return logsDb
        .select({
            sessionId: connectionAuditLog.sessionId,
            siteResourceId: connectionAuditLog.siteResourceId,
            orgId: connectionAuditLog.orgId,
            siteId: connectionAuditLog.siteId,
            clientId: connectionAuditLog.clientId,
            clientEndpoint: connectionAuditLog.clientEndpoint,
            userId: connectionAuditLog.userId,
            sourceAddr: connectionAuditLog.sourceAddr,
            destAddr: connectionAuditLog.destAddr,
            protocol: connectionAuditLog.protocol,
            startedAt: connectionAuditLog.startedAt,
            endedAt: connectionAuditLog.endedAt,
            bytesTx: connectionAuditLog.bytesTx,
            bytesRx: connectionAuditLog.bytesRx
        })
        .from(connectionAuditLog)
        .where(getWhere(data))
        .orderBy(
            desc(connectionAuditLog.startedAt),
            desc(connectionAuditLog.id)
        );
}

export function countConnectionQuery(data: Q) {
    const countQuery = logsDb
        .select({ count: count() })
        .from(connectionAuditLog)
        .where(getWhere(data));
    return countQuery;
}

async function enrichWithDetails(
    logs: Awaited<ReturnType<typeof queryConnection>>
) {
    // Collect unique IDs from logs
    const siteResourceIds = [
        ...new Set(
            logs
                .map((log) => log.siteResourceId)
                .filter((id): id is number => id !== null && id !== undefined)
        )
    ];
    const siteIds = [
        ...new Set(
            logs
                .map((log) => log.siteId)
                .filter((id): id is number => id !== null && id !== undefined)
        )
    ];
    const clientIds = [
        ...new Set(
            logs
                .map((log) => log.clientId)
                .filter((id): id is number => id !== null && id !== undefined)
        )
    ];
    const userIds = [
        ...new Set(
            logs
                .map((log) => log.userId)
                .filter((id): id is string => id !== null && id !== undefined)
        )
    ];

    // Fetch resource details from main database
    const resourceMap = new Map<number, { name: string; niceId: string }>();
    if (siteResourceIds.length > 0) {
        const resourceDetails = await primaryDb
            .select({
                siteResourceId: siteResources.siteResourceId,
                name: siteResources.name,
                niceId: siteResources.niceId
            })
            .from(siteResources)
            .where(inArray(siteResources.siteResourceId, siteResourceIds));

        for (const r of resourceDetails) {
            resourceMap.set(r.siteResourceId, {
                name: r.name,
                niceId: r.niceId
            });
        }
    }

    // Fetch site details from main database
    const siteMap = new Map<number, { name: string; niceId: string }>();
    if (siteIds.length > 0) {
        const siteDetails = await primaryDb
            .select({
                siteId: sites.siteId,
                name: sites.name,
                niceId: sites.niceId
            })
            .from(sites)
            .where(inArray(sites.siteId, siteIds));

        for (const s of siteDetails) {
            siteMap.set(s.siteId, { name: s.name, niceId: s.niceId });
        }
    }

    // Fetch client details from main database
    const clientMap = new Map<
        number,
        { name: string; niceId: string; type: string }
    >();
    if (clientIds.length > 0) {
        const clientDetails = await primaryDb
            .select({
                clientId: clients.clientId,
                name: clients.name,
                niceId: clients.niceId,
                type: clients.type
            })
            .from(clients)
            .where(inArray(clients.clientId, clientIds));

        for (const c of clientDetails) {
            clientMap.set(c.clientId, {
                name: c.name,
                niceId: c.niceId,
                type: c.type
            });
        }
    }

    // Fetch user details from main database
    const userMap = new Map<string, { email: string | null }>();
    if (userIds.length > 0) {
        const userDetails = await primaryDb
            .select({
                userId: users.userId,
                email: users.email
            })
            .from(users)
            .where(inArray(users.userId, userIds));

        for (const u of userDetails) {
            userMap.set(u.userId, { email: u.email });
        }
    }

    // Enrich logs with details
    return logs.map((log) => ({
        ...log,
        resourceName: log.siteResourceId
            ? (resourceMap.get(log.siteResourceId)?.name ?? null)
            : null,
        resourceNiceId: log.siteResourceId
            ? (resourceMap.get(log.siteResourceId)?.niceId ?? null)
            : null,
        siteName: log.siteId ? (siteMap.get(log.siteId)?.name ?? null) : null,
        siteNiceId: log.siteId
            ? (siteMap.get(log.siteId)?.niceId ?? null)
            : null,
        clientName: log.clientId
            ? (clientMap.get(log.clientId)?.name ?? null)
            : null,
        clientNiceId: log.clientId
            ? (clientMap.get(log.clientId)?.niceId ?? null)
            : null,
        clientType: log.clientId
            ? (clientMap.get(log.clientId)?.type ?? null)
            : null,
        userEmail: log.userId ? (userMap.get(log.userId)?.email ?? null) : null
    }));
}

async function queryUniqueFilterAttributes(
    timeStart: number,
    timeEnd: number,
    orgId: string
) {
    const baseConditions = and(
        gt(connectionAuditLog.startedAt, timeStart),
        lt(connectionAuditLog.startedAt, timeEnd),
        eq(connectionAuditLog.orgId, orgId)
    );

    // Get unique protocols
    const uniqueProtocols = await logsDb
        .selectDistinct({
            protocol: connectionAuditLog.protocol
        })
        .from(connectionAuditLog)
        .where(baseConditions);

    // Get unique destination addresses
    const uniqueDestAddrs = await logsDb
        .selectDistinct({
            destAddr: connectionAuditLog.destAddr
        })
        .from(connectionAuditLog)
        .where(baseConditions);

    // Get unique client IDs
    const uniqueClients = await logsDb
        .selectDistinct({
            clientId: connectionAuditLog.clientId
        })
        .from(connectionAuditLog)
        .where(baseConditions);

    // Get unique resource IDs
    const uniqueResources = await logsDb
        .selectDistinct({
            siteResourceId: connectionAuditLog.siteResourceId
        })
        .from(connectionAuditLog)
        .where(baseConditions);

    // Get unique user IDs
    const uniqueUsers = await logsDb
        .selectDistinct({
            userId: connectionAuditLog.userId
        })
        .from(connectionAuditLog)
        .where(baseConditions);

    // Enrich client IDs with names from main database
    const clientIds = uniqueClients
        .map((row) => row.clientId)
        .filter((id): id is number => id !== null);

    let clientsWithNames: Array<{ id: number; name: string }> = [];
    if (clientIds.length > 0) {
        const clientDetails = await primaryDb
            .select({
                clientId: clients.clientId,
                name: clients.name
            })
            .from(clients)
            .where(inArray(clients.clientId, clientIds));

        clientsWithNames = clientDetails.map((c) => ({
            id: c.clientId,
            name: c.name
        }));
    }

    // Enrich resource IDs with names from main database
    const resourceIds = uniqueResources
        .map((row) => row.siteResourceId)
        .filter((id): id is number => id !== null);

    let resourcesWithNames: Array<{ id: number; name: string | null }> = [];
    if (resourceIds.length > 0) {
        const resourceDetails = await primaryDb
            .select({
                siteResourceId: siteResources.siteResourceId,
                name: siteResources.name
            })
            .from(siteResources)
            .where(inArray(siteResources.siteResourceId, resourceIds));

        resourcesWithNames = resourceDetails.map((r) => ({
            id: r.siteResourceId,
            name: r.name
        }));
    }

    // Enrich user IDs with emails from main database
    const userIdsList = uniqueUsers
        .map((row) => row.userId)
        .filter((id): id is string => id !== null);

    let usersWithEmails: Array<{ id: string; email: string | null }> = [];
    if (userIdsList.length > 0) {
        const userDetails = await primaryDb
            .select({
                userId: users.userId,
                email: users.email
            })
            .from(users)
            .where(inArray(users.userId, userIdsList));

        usersWithEmails = userDetails.map((u) => ({
            id: u.userId,
            email: u.email
        }));
    }

    return {
        protocols: uniqueProtocols
            .map((row) => row.protocol)
            .filter((protocol): protocol is string => protocol !== null),
        destAddrs: uniqueDestAddrs
            .map((row) => row.destAddr)
            .filter((addr): addr is string => addr !== null),
        clients: clientsWithNames,
        resources: sortNamedFilterOptions(resourcesWithNames),
        users: usersWithEmails
    };
}

registry.registerPath({
    method: "get",
    path: "/org/{orgId}/logs/connection",
    description: "Query the connection audit log for an organization",
    tags: [OpenAPITags.Logs],
    request: {
        query: queryConnectionAuditLogsQuery,
        params: queryConnectionAuditLogsParams
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

export async function queryConnectionAuditLogs(
    req: Request,
    res: Response,
    next: NextFunction
): Promise<any> {
    try {
        const parsedQuery = queryConnectionAuditLogsQuery.safeParse(req.query);
        if (!parsedQuery.success) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    fromError(parsedQuery.error)
                )
            );
        }
        const parsedParams = queryConnectionAuditLogsParams.safeParse(
            req.params
        );
        if (!parsedParams.success) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    fromError(parsedParams.error)
                )
            );
        }

        const data = { ...parsedQuery.data, ...parsedParams.data };

        const baseQuery = queryConnection(data);

        const logsRaw = await baseQuery.limit(data.limit).offset(data.offset);

        // Enrich with resource, site, client, and user details
        const log = await enrichWithDetails(logsRaw);

        const totalCountResult = await countConnectionQuery(data);
        const totalCount = totalCountResult[0].count;

        const filterAttributes = await queryUniqueFilterAttributes(
            data.timeStart,
            data.timeEnd,
            data.orgId
        );

        return response<QueryConnectionAuditLogResponse>(res, {
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
            message: "Connection audit logs retrieved successfully",
            status: HttpCode.OK
        });
    } catch (error) {
        logger.error(error);
        return next(
            createHttpError(HttpCode.INTERNAL_SERVER_ERROR, "An error occurred")
        );
    }
}
