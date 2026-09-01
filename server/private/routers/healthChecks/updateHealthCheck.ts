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
import { createApiResponseSchema } from "@server/lib/openapi/createApiResponseSchema";
import { db, targetHealthCheck, newts, sites } from "@server/db";
import response from "@server/lib/response";
import HttpCode from "@server/types/HttpCode";
import createHttpError from "http-errors";
import logger from "@server/logger";
import { fromError } from "zod-validation-error";
import { OpenAPITags, registry } from "@server/openApi";
import { and, eq, isNull } from "drizzle-orm";
import { addStandaloneHealthCheck } from "@server/routers/newt/targets";
import {
    fireHealthCheckUnhealthyAlert,
    fireHealthCheckUnknownAlert,
    fireHealthCheckHealthyAlert
} from "@server/lib/alerts";

const paramsSchema = z
    .object({
        orgId: z.string().nonempty(),
        healthCheckId: z
            .string()
            .transform(Number)
            .pipe(z.number().int().positive())
    })
    .strict();

const bodySchema = z.strictObject({
    name: z.string().nonempty().optional(),
    siteId: z.number().int().positive().optional(),
    hcEnabled: z.boolean().optional(),
    hcMode: z.string().optional(),
    hcHostname: z.string().optional(),
    hcPort: z.number().int().min(1).max(65535).optional(),
    hcPath: z.string().optional(),
    hcScheme: z.string().optional(),
    hcMethod: z.string().optional(),
    hcInterval: z.number().int().positive().optional(),
    hcUnhealthyInterval: z.number().int().positive().optional(),
    hcTimeout: z.number().int().positive().optional(),
    hcHeaders: z.string().optional().nullable(),
    hcFollowRedirects: z.boolean().optional(),
    hcStatus: z.number().int().optional().nullable(),
    hcTlsServerName: z.string().optional(),
    hcHealthyThreshold: z.number().int().positive().optional(),
    hcUnhealthyThreshold: z.number().int().positive().optional()
});

export type UpdateHealthCheckResponse = {
    targetHealthCheckId: number;
    name: string | null;
    siteId: number | null;
    hcEnabled: boolean;
    hcHealth: string | null;
    hcMode: string | null;
    hcHostname: string | null;
    hcPort: number | null;
    hcPath: string | null;
    hcScheme: string | null;
    hcMethod: string | null;
    hcInterval: number | null;
    hcUnhealthyInterval: number | null;
    hcTimeout: number | null;
    hcHeaders: string | null;
    hcFollowRedirects: boolean | null;
    hcStatus: number | null;
    hcTlsServerName: string | null;
    hcHealthyThreshold: number | null;
    hcUnhealthyThreshold: number | null;
};
const UpdateHealthCheckResponseDataSchema = z.object({
    targetHealthCheckId: z.number(),
    name: z.string().nullable(),
    siteId: z.number().nullable(),
    hcEnabled: z.boolean(),
    hcHealth: z.string().nullable(),
    hcMode: z.string().nullable(),
    hcHostname: z.string().nullable(),
    hcPort: z.number().nullable(),
    hcPath: z.string().nullable(),
    hcScheme: z.string().nullable(),
    hcMethod: z.string().nullable(),
    hcInterval: z.number().nullable(),
    hcUnhealthyInterval: z.number().nullable(),
    hcTimeout: z.number().nullable(),
    hcHeaders: z.string().nullable(),
    hcFollowRedirects: z.boolean().nullable(),
    hcStatus: z.number().nullable(),
    hcTlsServerName: z.string().nullable(),
    hcHealthyThreshold: z.number().nullable(),
    hcUnhealthyThreshold: z.number().nullable()
});

registry.registerPath({
    method: "post",
    path: "/org/{orgId}/health-check/{healthCheckId}",
    description: "Update a health check for a specific organization.",
    tags: [OpenAPITags.HealthCheck],
    request: {
        params: paramsSchema,
        body: {
            content: {
                "application/json": {
                    schema: bodySchema
                }
            }
        }
    },
    responses: {
        200: {
            description: "Successful response",
            content: {
                "application/json": {
                    schema: createApiResponseSchema(
                        UpdateHealthCheckResponseDataSchema
                    )
                }
            }
        }
    }
});

export async function updateHealthCheck(
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

        const { orgId, healthCheckId } = parsedParams.data;

        const parsedBody = bodySchema.safeParse(req.body);
        if (!parsedBody.success) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    fromError(parsedBody.error).toString()
                )
            );
        }

        const [existing] = await db
            .select()
            .from(targetHealthCheck)
            .where(
                and(
                    eq(targetHealthCheck.targetHealthCheckId, healthCheckId),
                    eq(targetHealthCheck.orgId, orgId),
                    isNull(targetHealthCheck.targetId)
                )
            );

        if (!existing) {
            return next(
                createHttpError(
                    HttpCode.NOT_FOUND,
                    "Standalone health check not found"
                )
            );
        }

        const {
            name,
            siteId,
            hcEnabled,
            hcMode,
            hcHostname,
            hcPort,
            hcPath,
            hcScheme,
            hcMethod,
            hcInterval,
            hcUnhealthyInterval,
            hcTimeout,
            hcHeaders,
            hcFollowRedirects,
            hcStatus,
            hcTlsServerName,
            hcHealthyThreshold,
            hcUnhealthyThreshold
        } = parsedBody.data;

        const updateData: Record<string, unknown> = {};

        const [existingHealthCheck] = await db
            .select()
            .from(targetHealthCheck)
            .where(
                and(
                    eq(targetHealthCheck.targetHealthCheckId, healthCheckId),
                    eq(targetHealthCheck.orgId, orgId)
                )
            )
            .limit(1);

        if (!existingHealthCheck) {
            return next(
                createHttpError(
                    HttpCode.NOT_FOUND,
                    "Standalone health check not found"
                )
            );
        }

        const nextHcEnabled = hcEnabled ?? existingHealthCheck.hcEnabled;
        const nextHcHostname =
            hcHostname !== undefined
                ? hcHostname
                : existingHealthCheck.hcHostname;
        const hcHostnameMissing =
            !nextHcHostname || nextHcHostname.trim().length === 0;

        if (nextHcEnabled && hcHostnameMissing) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    "hcHostname is required when hcEnabled is true"
                )
            );
        }

        if (name !== undefined) updateData.name = name;
        if (siteId !== undefined) updateData.siteId = siteId;
        if (hcEnabled !== undefined) updateData.hcEnabled = hcEnabled;
        if (hcMode !== undefined) updateData.hcMode = hcMode;
        if (hcHostname !== undefined) updateData.hcHostname = hcHostname;
        if (hcPort !== undefined) updateData.hcPort = hcPort;
        if (hcPath !== undefined) updateData.hcPath = hcPath;
        if (hcScheme !== undefined) updateData.hcScheme = hcScheme;
        if (hcMethod !== undefined) updateData.hcMethod = hcMethod;
        if (hcInterval !== undefined) updateData.hcInterval = hcInterval;
        if (hcUnhealthyInterval !== undefined)
            updateData.hcUnhealthyInterval = hcUnhealthyInterval;
        if (hcTimeout !== undefined) updateData.hcTimeout = hcTimeout;
        if (hcHeaders !== undefined) updateData.hcHeaders = hcHeaders;
        if (hcFollowRedirects !== undefined)
            updateData.hcFollowRedirects = hcFollowRedirects;
        if (hcStatus !== undefined) updateData.hcStatus = hcStatus;
        if (hcTlsServerName !== undefined)
            updateData.hcTlsServerName = hcTlsServerName;
        if (hcHealthyThreshold !== undefined)
            updateData.hcHealthyThreshold = hcHealthyThreshold;
        if (hcUnhealthyThreshold !== undefined)
            updateData.hcUnhealthyThreshold = hcUnhealthyThreshold;

        const hcEnabledTurnedOn =
            parsedBody.data.hcEnabled === true &&
            existingHealthCheck.hcEnabled === false;

        let hcHealthValue: "unknown" | "healthy" | "unhealthy" | undefined;
        if (
            parsedBody.data.hcEnabled === false ||
            parsedBody.data.hcEnabled === null
        ) {
            hcHealthValue = "unknown";
        } else if (hcEnabledTurnedOn) {
            hcHealthValue = "unhealthy";
        } else {
            hcHealthValue = undefined;
        }

        if (hcHealthValue) {
            updateData.hcHealth = hcHealthValue;
        }

        const [updated] = await db
            .update(targetHealthCheck)
            .set(updateData)
            .where(
                and(
                    eq(targetHealthCheck.targetHealthCheckId, healthCheckId),
                    eq(targetHealthCheck.orgId, orgId),
                    isNull(targetHealthCheck.targetId)
                )
            )
            .returning();

        if (
            updated.hcHealth === "unhealthy" &&
            existingHealthCheck.hcHealth !== "unhealthy"
        ) {
            await fireHealthCheckUnhealthyAlert(
                updated.orgId,
                updated.targetHealthCheckId,
                updated.name || "",
                undefined,
                undefined,
                false // dont send the alert because we just want to create the alert, not notify users yet
            );
        } else if (
            updated.hcHealth === "unknown" &&
            existingHealthCheck.hcHealth !== "unknown"
        ) {
            // if the health is unknown, we want to fire an alert to notify users to enable health checks
            await fireHealthCheckUnknownAlert(
                updated.orgId,
                updated.targetHealthCheckId,
                updated.name,
                undefined,
                undefined,
                false // dont send the alert because we just want to create the alert, not notify users yet
            );
        } else if (
            updated.hcHealth === "healthy" &&
            existingHealthCheck.hcHealth !== "healthy"
        ) {
            await fireHealthCheckHealthyAlert(
                updated.orgId,
                updated.targetHealthCheckId,
                updated.name,
                undefined,
                undefined,
                false // dont send the alert because we just want to create the alert, not notify users yet
            );
        }

        // Push updated health check to newt if the site is a newt site
        const [newt] = await db
            .select()
            .from(newts)
            .where(eq(newts.siteId, updated.siteId))
            .limit(1);

        if (newt) {
            await addStandaloneHealthCheck(newt.newtId, updated, newt.version);
        }

        return response<UpdateHealthCheckResponse>(res, {
            data: {
                targetHealthCheckId: updated.targetHealthCheckId,
                siteId: updated.siteId ?? null,
                name: updated.name ?? null,
                hcEnabled: updated.hcEnabled,
                hcHealth: updated.hcHealth ?? null,
                hcMode: updated.hcMode ?? null,
                hcHostname: updated.hcHostname ?? null,
                hcPort: updated.hcPort ?? null,
                hcPath: updated.hcPath ?? null,
                hcScheme: updated.hcScheme ?? null,
                hcMethod: updated.hcMethod ?? null,
                hcInterval: updated.hcInterval ?? null,
                hcUnhealthyInterval: updated.hcUnhealthyInterval ?? null,
                hcTimeout: updated.hcTimeout ?? null,
                hcHeaders: updated.hcHeaders ?? null,
                hcFollowRedirects: updated.hcFollowRedirects ?? null,
                hcStatus: updated.hcStatus ?? null,
                hcTlsServerName: updated.hcTlsServerName ?? null,
                hcHealthyThreshold: updated.hcHealthyThreshold ?? null,
                hcUnhealthyThreshold: updated.hcUnhealthyThreshold ?? null
            },
            success: true,
            error: false,
            message: "Standalone health check updated successfully",
            status: HttpCode.OK
        });
    } catch (error) {
        logger.error(error);
        return next(
            createHttpError(HttpCode.INTERNAL_SERVER_ERROR, "An error occurred")
        );
    }
}
