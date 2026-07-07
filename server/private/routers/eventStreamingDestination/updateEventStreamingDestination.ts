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
import { db } from "@server/db";
import { eventStreamingDestinations } from "@server/db";
import response from "@server/lib/response";
import HttpCode from "@server/types/HttpCode";
import createHttpError from "http-errors";
import logger from "@server/logger";
import { fromError } from "zod-validation-error";
import { OpenAPITags, registry } from "@server/openApi";
import { and, eq } from "drizzle-orm";
import { encrypt } from "@server/lib/crypto";
import config from "@server/lib/config";

const paramsSchema = z
    .object({
        orgId: z.string().nonempty(),
        destinationId: z.coerce.number<number>()
    })
    .strict();

const bodySchema = z.strictObject({
    type: z.string().optional(),
    config: z.string().optional(),
    enabled: z.boolean().optional(),
    sendConnectionLogs: z.boolean().optional(),
    sendRequestLogs: z.boolean().optional(),
    sendActionLogs: z.boolean().optional(),
    sendAccessLogs: z.boolean().optional()
});

export type UpdateEventStreamingDestinationResponse = {
    destinationId: number;
};
const UpdateEventStreamingDestinationResponseDataSchema = z.object({
    destinationId: z.number()
});


registry.registerPath({
    method: "post",
    path: "/org/{orgId}/event-streaming-destination/{destinationId}",
    description: "Update an event streaming destination for a specific organization.",
    tags: [OpenAPITags.Org],
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
                    schema: createApiResponseSchema(UpdateEventStreamingDestinationResponseDataSchema)
                }
            }
        }
    }
});

export async function updateEventStreamingDestination(
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

        const { type, config: configToUpdate, enabled, sendAccessLogs, sendActionLogs, sendConnectionLogs, sendRequestLogs } = parsedBody.data;

        const updateData: Record<string, unknown> = {
            updatedAt: Date.now()
        };

        if (type !== undefined) updateData.type = type;
        if (configToUpdate !== undefined) {
            const key = config.getRawConfig().server.secret!;
            updateData.config = encrypt(configToUpdate, key);
        }
        if (enabled !== undefined) updateData.enabled = enabled;
        if (sendAccessLogs !== undefined) updateData.sendAccessLogs = sendAccessLogs;
        if (sendActionLogs !== undefined) updateData.sendActionLogs = sendActionLogs;
        if (sendConnectionLogs !== undefined) updateData.sendConnectionLogs = sendConnectionLogs;
        if (sendRequestLogs !== undefined) updateData.sendRequestLogs = sendRequestLogs;

        await db
            .update(eventStreamingDestinations)
            .set(updateData)
            .where(
                and(
                    eq(eventStreamingDestinations.destinationId, destinationId),
                    eq(eventStreamingDestinations.orgId, orgId)
                )
            );


        return response<UpdateEventStreamingDestinationResponse>(res, {
            data: {
                destinationId
            },
            success: true,
            error: false,
            message: "Event streaming destination updated successfully",
            status: HttpCode.OK
        });
    } catch (error) {
        logger.error(error);
        return next(
            createHttpError(HttpCode.INTERNAL_SERVER_ERROR, "An error occurred")
        );
    }
}
