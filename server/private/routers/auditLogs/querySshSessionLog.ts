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
    sshSessionLog,
    logsDb,
    resources,
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
import { QuerySshSessionLogResponse } from "@server/routers/auditLogs/types";
import response from "@server/lib/response";
import logger from "@server/logger";
import { getSevenDaysAgo } from "@app/lib/getSevenDaysAgo";

export const querySshSessionLogsQuery = z.object({
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
        .prefault(() => new Date().toISOString())
        .openapi({
            type: "string",
            format: "date-time",
            description:
                "End time as ISO date string (defaults to current time)"
        }),
    siteResourceId: z
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
        .optional()
        .openapi({
            type: "integer",
            description:
                "Public resource, for sessions opened in the browser terminal"
        }),
    siteId: z
        .string()
        .optional()
        .transform(Number)
        .pipe(z.int().positive())
        .optional(),
    transport: z.enum(["ssh", "browser"]).optional(),
    clientId: z
        .string()
        .optional()
        .transform(Number)
        .pipe(z.int().positive())
        .optional(),
    userId: z.string().optional(),
    username: z.string().optional(),
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

export const querySshSessionLogsParams = z.object({
    orgId: z.string()
});

export const querySshSessionLogsCombined = querySshSessionLogsQuery.merge(
    querySshSessionLogsParams
);
type Q = z.infer<typeof querySshSessionLogsCombined>;

const DISTINCT_LIMIT = 500;

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

export function getSshSessionWhere(data: Q) {
    return and(
        gt(sshSessionLog.startedAt, data.timeStart),
        lt(sshSessionLog.startedAt, data.timeEnd),
        eq(sshSessionLog.orgId, data.orgId),
        data.siteResourceId
            ? eq(sshSessionLog.siteResourceId, data.siteResourceId)
            : undefined,
        data.resourceId
            ? eq(sshSessionLog.resourceId, data.resourceId)
            : undefined,
        data.siteId ? eq(sshSessionLog.siteId, data.siteId) : undefined,
        data.transport
            ? eq(sshSessionLog.transport, data.transport)
            : undefined,
        data.clientId ? eq(sshSessionLog.clientId, data.clientId) : undefined,
        data.userId ? eq(sshSessionLog.userId, data.userId) : undefined,
        data.username ? eq(sshSessionLog.username, data.username) : undefined
    );
}

export function querySshSession(data: Q) {
    return logsDb
        .select({
            id: sshSessionLog.id,
            sessionId: sshSessionLog.sessionId,
            orgId: sshSessionLog.orgId,
            siteId: sshSessionLog.siteId,
            siteResourceId: sshSessionLog.siteResourceId,
            resourceId: sshSessionLog.resourceId,
            clientId: sshSessionLog.clientId,
            userId: sshSessionLog.userId,
            transport: sshSessionLog.transport,
            sourceAddr: sshSessionLog.sourceAddr,
            destAddr: sshSessionLog.destAddr,
            username: sshSessionLog.username,
            authMethod: sshSessionLog.authMethod,
            keyFingerprint: sshSessionLog.keyFingerprint,
            certKeyId: sshSessionLog.certKeyId,
            commandCount: sshSessionLog.commandCount,
            startedAt: sshSessionLog.startedAt,
            endedAt: sshSessionLog.endedAt
        })
        .from(sshSessionLog)
        .where(getSshSessionWhere(data))
        .orderBy(desc(sshSessionLog.startedAt), desc(sshSessionLog.id));
}

export function countSshSessionQuery(data: Q) {
    return logsDb
        .select({ count: count() })
        .from(sshSessionLog)
        .where(getSshSessionWhere(data));
}

async function enrichWithDetails(
    logs: Awaited<ReturnType<typeof querySshSession>>
): Promise<QuerySshSessionLogResponse["log"]> {
    const unique = <T>(values: (T | null)[]) => [
        ...new Set(values.filter((v): v is T => v !== null && v !== undefined))
    ];
    const siteResourceIds = unique(logs.map((log) => log.siteResourceId));
    const resourceIds = unique(logs.map((log) => log.resourceId));
    const siteIds = unique(logs.map((log) => log.siteId));
    const clientIds = unique(logs.map((log) => log.clientId));
    const userIds = unique(logs.map((log) => log.userId));

    const [
        siteResourceDetails,
        resourceDetails,
        siteDetails,
        clientDetails,
        userDetails
    ] = await Promise.all([
        siteResourceIds.length > 0
            ? primaryDb
                  .select({
                      id: siteResources.siteResourceId,
                      name: siteResources.name,
                      niceId: siteResources.niceId
                  })
                  .from(siteResources)
                  .where(inArray(siteResources.siteResourceId, siteResourceIds))
            : [],
        resourceIds.length > 0
            ? primaryDb
                  .select({
                      id: resources.resourceId,
                      name: resources.name,
                      niceId: resources.niceId
                  })
                  .from(resources)
                  .where(inArray(resources.resourceId, resourceIds))
            : [],
        siteIds.length > 0
            ? primaryDb
                  .select({
                      id: sites.siteId,
                      name: sites.name,
                      niceId: sites.niceId
                  })
                  .from(sites)
                  .where(inArray(sites.siteId, siteIds))
            : [],
        clientIds.length > 0
            ? primaryDb
                  .select({
                      id: clients.clientId,
                      name: clients.name,
                      niceId: clients.niceId,
                      type: clients.type
                  })
                  .from(clients)
                  .where(inArray(clients.clientId, clientIds))
            : [],
        userIds.length > 0
            ? primaryDb
                  .select({ id: users.userId, email: users.email })
                  .from(users)
                  .where(inArray(users.userId, userIds))
            : []
    ]);

    const siteResourceMap = new Map(siteResourceDetails.map((r) => [r.id, r]));
    const resourceMap = new Map(resourceDetails.map((r) => [r.id, r]));
    const siteMap = new Map(siteDetails.map((s) => [s.id, s]));
    const clientMap = new Map(clientDetails.map((c) => [c.id, c]));
    const userMap = new Map(userDetails.map((u) => [u.id, u]));

    return logs.map((log) => {
        const resource = log.siteResourceId
            ? siteResourceMap.get(log.siteResourceId)
            : log.resourceId
              ? resourceMap.get(log.resourceId)
              : undefined;
        const site = siteMap.get(log.siteId);
        const client = log.clientId ? clientMap.get(log.clientId) : undefined;
        const user = log.userId ? userMap.get(log.userId) : undefined;
        return {
            ...log,
            resourceType: log.siteResourceId
                ? ("site" as const)
                : log.resourceId
                  ? ("public" as const)
                  : null,
            resourceName: resource?.name ?? null,
            resourceNiceId: resource?.niceId ?? null,
            siteName: site?.name ?? null,
            siteNiceId: site?.niceId ?? null,
            clientName: client?.name ?? null,
            clientNiceId: client?.niceId ?? null,
            clientType: client?.type ?? null,
            userEmail: user?.email ?? null
        };
    });
}

async function queryUniqueFilterAttributes(
    timeStart: number,
    timeEnd: number,
    orgId: string
): Promise<QuerySshSessionLogResponse["filterAttributes"]> {
    const baseConditions = and(
        gt(sshSessionLog.startedAt, timeStart),
        lt(sshSessionLog.startedAt, timeEnd),
        eq(sshSessionLog.orgId, orgId)
    );

    const [
        uniqueSiteResources,
        uniquePublicResources,
        uniqueSites,
        uniqueClients,
        uniqueUsers,
        uniqueUsernames
    ] = await Promise.all([
        logsDb
            .selectDistinct({ id: sshSessionLog.siteResourceId })
            .from(sshSessionLog)
            .where(baseConditions)
            .limit(DISTINCT_LIMIT + 1),
        logsDb
            .selectDistinct({ id: sshSessionLog.resourceId })
            .from(sshSessionLog)
            .where(baseConditions)
            .limit(DISTINCT_LIMIT + 1),
        logsDb
            .selectDistinct({ id: sshSessionLog.siteId })
            .from(sshSessionLog)
            .where(baseConditions)
            .limit(DISTINCT_LIMIT + 1),
        logsDb
            .selectDistinct({ id: sshSessionLog.clientId })
            .from(sshSessionLog)
            .where(baseConditions)
            .limit(DISTINCT_LIMIT + 1),
        logsDb
            .selectDistinct({ id: sshSessionLog.userId })
            .from(sshSessionLog)
            .where(baseConditions)
            .limit(DISTINCT_LIMIT + 1),
        logsDb
            .selectDistinct({ username: sshSessionLog.username })
            .from(sshSessionLog)
            .where(baseConditions)
            .limit(DISTINCT_LIMIT + 1)
    ]);

    const ids = <T>(rows: { id: T | null }[]) =>
        rows.map((row) => row.id).filter((id): id is T => id !== null);

    const siteResourceIds = ids(uniqueSiteResources);
    const publicResourceIds = ids(uniquePublicResources);
    const siteIds = ids(uniqueSites);
    const clientIds = ids(uniqueClients);
    const userIds = ids(uniqueUsers);

    const [
        siteResourceDetails,
        publicResourceDetails,
        siteDetails,
        clientDetails,
        userDetails
    ] = await Promise.all([
        siteResourceIds.length > 0
            ? primaryDb
                  .select({
                      id: siteResources.siteResourceId,
                      name: siteResources.name
                  })
                  .from(siteResources)
                  .where(inArray(siteResources.siteResourceId, siteResourceIds))
            : [],
        publicResourceIds.length > 0
            ? primaryDb
                  .select({ id: resources.resourceId, name: resources.name })
                  .from(resources)
                  .where(inArray(resources.resourceId, publicResourceIds))
            : [],
        siteIds.length > 0
            ? primaryDb
                  .select({ id: sites.siteId, name: sites.name })
                  .from(sites)
                  .where(inArray(sites.siteId, siteIds))
            : [],
        clientIds.length > 0
            ? primaryDb
                  .select({ id: clients.clientId, name: clients.name })
                  .from(clients)
                  .where(inArray(clients.clientId, clientIds))
            : [],
        userIds.length > 0
            ? primaryDb
                  .select({ id: users.userId, email: users.email })
                  .from(users)
                  .where(inArray(users.userId, userIds))
            : []
    ]);

    return {
        resources: sortNamedFilterOptions([
            ...siteResourceDetails.map((r) => ({
                ...r,
                type: "site" as const
            })),
            ...publicResourceDetails.map((r) => ({
                ...r,
                type: "public" as const
            }))
        ]),
        sites: sortNamedFilterOptions(siteDetails),
        clients: clientDetails,
        users: userDetails,
        usernames: uniqueUsernames.map((row) => row.username).sort()
    };
}

registry.registerPath({
    method: "get",
    path: "/org/{orgId}/logs/ssh",
    description: "Query the SSH session log for an organization",
    tags: [OpenAPITags.Logs],
    request: {
        query: querySshSessionLogsQuery,
        params: querySshSessionLogsParams
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

export async function querySshSessionLogs(
    req: Request,
    res: Response,
    next: NextFunction
): Promise<any> {
    try {
        const parsedQuery = querySshSessionLogsQuery.safeParse(req.query);
        if (!parsedQuery.success) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    fromError(parsedQuery.error)
                )
            );
        }
        const parsedParams = querySshSessionLogsParams.safeParse(req.params);
        if (!parsedParams.success) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    fromError(parsedParams.error)
                )
            );
        }

        const data = { ...parsedQuery.data, ...parsedParams.data };

        const logsRaw = await querySshSession(data)
            .limit(data.limit)
            .offset(data.offset);

        const log = await enrichWithDetails(logsRaw);

        const [{ count: totalCount }] = await countSshSessionQuery(data);

        const filterAttributes = await queryUniqueFilterAttributes(
            data.timeStart,
            data.timeEnd,
            data.orgId
        );

        return response<QuerySshSessionLogResponse>(res, {
            data: {
                log,
                pagination: {
                    total: totalCount,
                    limit: data.limit,
                    offset: data.offset
                },
                filterAttributes
            },
            success: true,
            error: false,
            message: "SSH session logs retrieved successfully",
            status: HttpCode.OK
        });
    } catch (error) {
        logger.error(error);
        return next(
            createHttpError(HttpCode.INTERNAL_SERVER_ERROR, "An error occurred")
        );
    }
}
