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
import { db } from "@server/db";
import { eventStreamingDestinations } from "@server/db";
import response from "@server/lib/response";
import HttpCode from "@server/types/HttpCode";
import createHttpError from "http-errors";
import logger from "@server/logger";
import { fromError } from "zod-validation-error";
import { OpenAPITags, registry } from "@server/openApi";
import { and, eq } from "drizzle-orm";

const paramsSchema = z
    .object({
        orgId: z.string().nonempty(),
        destinationId: z.coerce.number<number>()
    })
    .strict();

registry.registerPath({
    method: "delete",
    path: "/org/{orgId}/event-streaming-destination/{destinationId}",
    description:
        "Delete an event streaming destination for a specific organization.",
    tags: [OpenAPITags.EventStreamingDestination],
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

export async function deleteEventStreamingDestination(
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

        const { orgId, destinationId } = parsedParams.data;

        const [existing] = await db
            .select()
            .from(eventStreamingDestinations)
            .where(
                and(
                    eq(eventStreamingDestinations.destinationId, destinationId),
                    eq(eventStreamingDestinations.orgId, orgId)
                )
            );

        if (!existing) {
            return next(
                createHttpError(
                    HttpCode.NOT_FOUND,
                    "Event streaming destination not found"
                )
            );
        }

        await db
            .delete(eventStreamingDestinations)
            .where(
                and(
                    eq(eventStreamingDestinations.destinationId, destinationId),
                    eq(eventStreamingDestinations.orgId, orgId)
                )
            );

        return response<null>(res, {
            data: null,
            success: true,
            error: false,
            message: "Event streaming destination deleted successfully",
            status: HttpCode.OK
        });
    } catch (error) {
        logger.error(error);
        return next(
            createHttpError(HttpCode.INTERNAL_SERVER_ERROR, "An error occurred")
        );
    }
}
