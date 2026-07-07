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

import { db, targetHealthCheck, targets, resources, sites } from "@server/db";
import response from "@server/lib/response";
import HttpCode from "@server/types/HttpCode";
import createHttpError from "http-errors";
import logger from "@server/logger";
import { OpenAPITags, registry } from "@server/openApi";
import { and, eq, exists, isNotNull, like, sql } from "drizzle-orm";
import { NextFunction, Request, Response } from "express";
import { z } from "zod";
import { fromError } from "zod-validation-error";
import { ListHealthChecksResponse } from "@server/routers/healthChecks/types";

const paramsSchema = z.strictObject({
    orgId: z.string().nonempty()
});

const querySchema = z.object({
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
        .pipe(z.int().nonnegative()),
    query: z.string().optional(),
    hcMode: z.enum(["http", "tcp", "snmp", "ping"]).optional(),
    siteId: z
        .string()
        .optional()
        .transform((s) => (s == null || s === "" ? undefined : Number(s)))
        .pipe(z.union([z.undefined(), z.number().int().positive()])),
    resourceId: z
        .string()
        .optional()
        .transform((s) => (s == null || s === "" ? undefined : Number(s)))
        .pipe(z.union([z.undefined(), z.number().int().positive()])),
    hcHealth: z.enum(["healthy", "unhealthy", "unknown"]).optional(),
    hcEnabled: z
        .enum(["true", "false"])
        .optional()
        .transform((v) => (v === undefined ? undefined : v === "true"))
});

registry.registerPath({
    method: "get",
    path: "/org/{orgId}/health-checks",
    description: "List health checks for an organization.",
    tags: [OpenAPITags.Org],
    request: {
        params: paramsSchema,
        query: querySchema
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

export async function listHealthChecks(
    req: Request,
    res: Response,
    next: NextFunction
): Promise<any> {
    try {
        const parsedParams = paramsSchema.safeParse(req.params);
        if (!parsedParams.success) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    fromError(parsedParams.error).toString()
                )
            );
        }
        const { orgId } = parsedParams.data;

        const parsedQuery = querySchema.safeParse(req.query);
        if (!parsedQuery.success) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    fromError(parsedQuery.error).toString()
                )
            );
        }
        const {
            limit,
            offset,
            query,
            hcMode,
            siteId,
            resourceId,
            hcHealth,
            hcEnabled
        } = parsedQuery.data;

        const resourceIdFilter = resourceId
            ? exists(
                  db
                      .select()
                      .from(targets)
                      .where(
                          and(
                              eq(targets.targetId, targetHealthCheck.targetId),
                              eq(targets.resourceId, resourceId)
                          )
                      )
              )
            : undefined;

        const whereClause = and(
            eq(targetHealthCheck.orgId, orgId),
            isNotNull(targetHealthCheck.hcMode), // filter out the null ones attached to targets
            query
                ? like(
                      sql`LOWER(${targetHealthCheck.name})`,
                      `%${query.toLowerCase()}%`
                  )
                : undefined,
            hcMode ? eq(targetHealthCheck.hcMode, hcMode) : undefined,
            siteId ? eq(targetHealthCheck.siteId, siteId) : undefined,
            resourceIdFilter,
            hcHealth ? eq(targetHealthCheck.hcHealth, hcHealth) : undefined,
            hcEnabled !== undefined
                ? eq(targetHealthCheck.hcEnabled, hcEnabled)
                : undefined
        );

        const list = await db
            .select({
                targetHealthCheckId: targetHealthCheck.targetHealthCheckId,
                name: targetHealthCheck.name,
                siteId: targetHealthCheck.siteId,
                siteName: sites.name,
                siteNiceId: sites.niceId,
                hcEnabled: targetHealthCheck.hcEnabled,
                hcHealth: targetHealthCheck.hcHealth,
                hcMode: targetHealthCheck.hcMode,
                hcHostname: targetHealthCheck.hcHostname,
                hcPort: targetHealthCheck.hcPort,
                hcPath: targetHealthCheck.hcPath,
                hcScheme: targetHealthCheck.hcScheme,
                hcMethod: targetHealthCheck.hcMethod,
                hcInterval: targetHealthCheck.hcInterval,
                hcUnhealthyInterval: targetHealthCheck.hcUnhealthyInterval,
                hcTimeout: targetHealthCheck.hcTimeout,
                hcHeaders: targetHealthCheck.hcHeaders,
                hcFollowRedirects: targetHealthCheck.hcFollowRedirects,
                hcStatus: targetHealthCheck.hcStatus,
                hcTlsServerName: targetHealthCheck.hcTlsServerName,
                hcHealthyThreshold: targetHealthCheck.hcHealthyThreshold,
                hcUnhealthyThreshold: targetHealthCheck.hcUnhealthyThreshold,
                resourceId: resources.resourceId,
                resourceName: resources.name,
                resourceNiceId: resources.niceId
            })
            .from(targetHealthCheck)
            .leftJoin(targets, eq(targetHealthCheck.targetId, targets.targetId))
            .leftJoin(resources, eq(targets.resourceId, resources.resourceId))
            .leftJoin(sites, eq(targetHealthCheck.siteId, sites.siteId))
            .where(whereClause)
            .orderBy(sql`${targetHealthCheck.targetHealthCheckId} DESC`)
            .limit(limit)
            .offset(offset);

        const [{ count }] = await db
            .select({ count: sql<number>`count(*)` })
            .from(targetHealthCheck)
            .where(whereClause);

        return response<ListHealthChecksResponse>(res, {
            data: {
                healthChecks: list.map((row) => ({
                    targetHealthCheckId: row.targetHealthCheckId,
                    name: row.name ?? "",
                    siteId: row.siteId ?? null,
                    siteName: row.siteName ?? null,
                    siteNiceId: row.siteNiceId ?? null,
                    hcEnabled: row.hcEnabled,
                    hcHealth: (row.hcHealth ?? "unknown") as
                        | "unknown"
                        | "healthy"
                        | "unhealthy",
                    hcMode: row.hcMode ?? null,
                    hcHostname: row.hcHostname ?? null,
                    hcPort: row.hcPort ?? null,
                    hcPath: row.hcPath ?? null,
                    hcScheme: row.hcScheme ?? null,
                    hcMethod: row.hcMethod ?? null,
                    hcInterval: row.hcInterval ?? null,
                    hcUnhealthyInterval: row.hcUnhealthyInterval ?? null,
                    hcTimeout: row.hcTimeout ?? null,
                    hcHeaders: row.hcHeaders ?? null,
                    hcFollowRedirects: row.hcFollowRedirects ?? null,
                    hcStatus: row.hcStatus ?? null,
                    hcTlsServerName: row.hcTlsServerName ?? null,
                    hcHealthyThreshold: row.hcHealthyThreshold ?? null,
                    hcUnhealthyThreshold: row.hcUnhealthyThreshold ?? null,
                    resourceId: row.resourceId ?? null,
                    resourceName: row.resourceName ?? null,
                    resourceNiceId: row.resourceNiceId ?? null
                })),
                pagination: {
                    total: count,
                    limit,
                    offset
                }
            },
            success: true,
            error: false,
            message: "Standalone health checks retrieved successfully",
            status: HttpCode.OK
        });
    } catch (error) {
        logger.error(error);
        return next(
            createHttpError(HttpCode.INTERNAL_SERVER_ERROR, "An error occurred")
        );
    }
}
