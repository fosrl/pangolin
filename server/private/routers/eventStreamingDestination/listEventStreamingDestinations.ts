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
import { eq, sql } from "drizzle-orm";
import { decrypt } from "@server/lib/crypto";
import config from "@server/lib/config";
import { createApiResponseSchema } from "@server/lib/openapi/createApiResponseSchema";

const paramsSchema = z.strictObject({
    orgId: z.string().nonempty()
});

const querySchema = z.strictObject({
    limit: z
        .string()
        .optional()
        .default("1000")
        .transform(Number)
        .pipe(z.int().nonnegative()),
    offset: z
        .string()
        .optional()
        .default("0")
        .transform(Number)
        .pipe(z.int().nonnegative())
});

export type ListEventStreamingDestinationsResponse = {
    destinations: {
        destinationId: number;
        orgId: string;
        type: string;
        config: string;
        enabled: boolean;
        lastError: string | null;
        lastErrorAt: number | null;
        createdAt: number;
        updatedAt: number;
        sendConnectionLogs: boolean;
        sendRequestLogs: boolean;
        sendActionLogs: boolean;
        sendAccessLogs: boolean;
    }[];
    pagination: {
        total: number;
        limit: number;
        offset: number;
    };
};

const ListEventStreamingDestinationsResponseDataSchema = z.object({
    destinations: z.array(
        z.object({
            destinationId: z.number(),
            orgId: z.string(),
            type: z.string(),
            config: z.string(),
            enabled: z.boolean(),
            lastError: z.string().nullable(),
            lastErrorAt: z.number().nullable(),
            createdAt: z.number(),
            updatedAt: z.number(),
            sendConnectionLogs: z.boolean(),
            sendRequestLogs: z.boolean(),
            sendActionLogs: z.boolean(),
            sendAccessLogs: z.boolean()
        })
    ),
    pagination: z.object({
        total: z.number(),
        limit: z.number(),
        offset: z.number()
    })
});

async function query(orgId: string, limit: number, offset: number) {
    const res = await db
        .select()
        .from(eventStreamingDestinations)
        .where(eq(eventStreamingDestinations.orgId, orgId))
        .orderBy(sql`${eventStreamingDestinations.createdAt} DESC`)
        .limit(limit)
        .offset(offset);
    return res;
}

registry.registerPath({
    method: "get",
    path: "/org/{orgId}/event-streaming-destination",
    description:
        "List all event streaming destinations for a specific organization.",
    tags: [OpenAPITags.Org],
    request: {
        query: querySchema,
        params: paramsSchema
    },
    responses: {
        200: {
            description: "Successful response",
            content: {
                "application/json": {
                    schema: createApiResponseSchema(
                        ListEventStreamingDestinationsResponseDataSchema
                    )
                }
            }
        }
    }
});

export async function listEventStreamingDestinations(
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
        const { limit, offset } = parsedQuery.data;

        const list = await query(orgId, limit, offset);

        const [{ count }] = await db
            .select({ count: sql<number>`count(*)` })
            .from(eventStreamingDestinations)
            .where(eq(eventStreamingDestinations.orgId, orgId));

        const key = config.getRawConfig().server.secret!;
        const decryptedList = list.map((dest) => {
            try {
                return { ...dest, config: decrypt(dest.config, key) };
            } catch (err) {
                logger.error(
                    `listEventStreamingDestinations: failed to decrypt config for destination ${dest.destinationId}`,
                    err
                );
                return { ...dest, config: "" };
            }
        });

        return response<ListEventStreamingDestinationsResponse>(res, {
            data: {
                destinations: decryptedList,
                pagination: {
                    total: count,
                    limit,
                    offset
                }
            },
            success: true,
            error: false,
            message: "Event streaming destinations retrieved successfully",
            status: HttpCode.OK
        });
    } catch (error) {
        logger.error(error);
        return next(
            createHttpError(HttpCode.INTERNAL_SERVER_ERROR, "An error occurred")
        );
    }
}
