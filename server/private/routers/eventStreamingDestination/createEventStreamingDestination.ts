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
import { logStreamingManager } from "#private/lib/logStreaming";
import response from "@server/lib/response";
import HttpCode from "@server/types/HttpCode";
import createHttpError from "http-errors";
import logger from "@server/logger";
import { fromError } from "zod-validation-error";
import { OpenAPITags, registry } from "@server/openApi";
import { encrypt } from "@server/lib/crypto";
import config from "@server/lib/config";

const paramsSchema = z.strictObject({
    orgId: z.string().nonempty()
});

const bodySchema = z.strictObject({
    type: z.string().nonempty(),
    config: z.string().nonempty(),
    enabled: z.boolean().optional().default(true),
    sendConnectionLogs: z.boolean().optional().default(false),
    sendRequestLogs: z.boolean().optional().default(false),
    sendActionLogs: z.boolean().optional().default(false),
    sendAccessLogs: z.boolean().optional().default(false)
});

export type CreateEventStreamingDestinationResponse = {
    destinationId: number;
};
const CreateEventStreamingDestinationResponseDataSchema = z.object({
    destinationId: z.number()
});


registry.registerPath({
    method: "put",
    path: "/org/{orgId}/event-streaming-destination",
    description: "Create an event streaming destination for a specific organization.",
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
                    schema: createApiResponseSchema(CreateEventStreamingDestinationResponseDataSchema)
                }
            }
        }
    }
});

export async function createEventStreamingDestination(
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

        const parsedBody = bodySchema.safeParse(req.body);
        if (!parsedBody.success) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    fromError(parsedBody.error).toString()
                )
            );
        }

        const { type, config: configToSet, enabled } = parsedBody.data;

        const key = config.getRawConfig().server.secret!;
        const encryptedConfig = encrypt(configToSet, key);

        const now = Date.now();

        const [destination] = await db
            .insert(eventStreamingDestinations)
            .values({
                orgId,
                type,
                config: encryptedConfig,
                enabled,
                createdAt: now,
                updatedAt: now,
                sendAccessLogs: parsedBody.data.sendAccessLogs,
                sendActionLogs: parsedBody.data.sendActionLogs,
                sendConnectionLogs: parsedBody.data.sendConnectionLogs,
                sendRequestLogs: parsedBody.data.sendRequestLogs
            })
            .returning();

        // Seed cursors at the current max row id for every log type so this
        // destination only receives events written *after* it was created.
        // Fire-and-forget: a failure here is non-fatal; the manager has a lazy
        // fallback that will seed at the next poll if these rows are missing.
        logStreamingManager
            .initializeCursorsForDestination(destination.destinationId, orgId)
            .catch((err) =>
                logger.error(
                    "createEventStreamingDestination: failed to initialise streaming cursors",
                    err
                )
            );

        return response<CreateEventStreamingDestinationResponse>(res, {
            data: {
                destinationId: destination.destinationId
            },
            success: true,
            error: false,
            message: "Event streaming destination created successfully",
            status: HttpCode.CREATED
        });
    } catch (error) {
        logger.error(error);
        return next(
            createHttpError(HttpCode.INTERNAL_SERVER_ERROR, "An error occurred")
        );
    }
}
