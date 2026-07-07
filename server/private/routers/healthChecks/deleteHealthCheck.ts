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
import { db, targetHealthCheck, newts, sites } from "@server/db";
import response from "@server/lib/response";
import HttpCode from "@server/types/HttpCode";
import createHttpError from "http-errors";
import logger from "@server/logger";
import { fromError } from "zod-validation-error";
import { OpenAPITags, registry } from "@server/openApi";
import { and, eq, isNull } from "drizzle-orm";
import { removeStandaloneHealthCheck } from "@server/routers/newt/targets";

const paramsSchema = z
    .object({
        orgId: z.string().nonempty(),
        healthCheckId: z
            .string()
            .transform(Number)
            .pipe(z.number().int().positive())
    })
    .strict();

registry.registerPath({
    method: "delete",
    path: "/org/{orgId}/health-check/{healthCheckId}",
    description: "Delete a health check for a specific organization.",
    tags: [OpenAPITags.Org],
    request: {
        params: paramsSchema
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

export async function deleteHealthCheck(
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

        await db
            .delete(targetHealthCheck)
            .where(
                and(
                    eq(targetHealthCheck.targetHealthCheckId, healthCheckId),
                    eq(targetHealthCheck.orgId, orgId),
                    isNull(targetHealthCheck.targetId)
                )
            );

        // Remove health check from newt if the site is a newt site
        const [newt] = await db
            .select()
            .from(newts)
            .where(eq(newts.siteId, existing.siteId))
            .limit(1);

        if (newt) {
            await removeStandaloneHealthCheck(
                newt.newtId,
                healthCheckId,
                newt.version
            );
        }

        return response<null>(res, {
            data: null,
            success: true,
            error: false,
            message: "Standalone health check deleted successfully",
            status: HttpCode.OK
        });
    } catch (error) {
        logger.error(error);
        return next(
            createHttpError(HttpCode.INTERNAL_SERVER_ERROR, "An error occurred")
        );
    }
}
