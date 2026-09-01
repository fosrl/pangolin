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

import response from "@server/lib/response";
import {
    getBatchedStatusHistory,
    type BatchedStatusHistoryResponse
} from "@server/lib/statusHistory";
import logger from "@server/logger";
import HttpCode from "@server/types/HttpCode";
import { NextFunction, Request, Response } from "express";
import createHttpError from "http-errors";
import { z } from "zod";
import { fromError } from "zod-validation-error";

const healthCheckIdParamsSchema = z.object({
    days: z
        .string()
        .optional()
        .transform((v) => (v ? parseInt(v, 10) : 90)),
    // Minutes to add to UTC to get the requesting client's local time
    // (e.g. Australia/Sydney standard time is 600). Optional and
    // defaults to 0 (UTC) so older clients keep the prior behavior.
    tzOffsetMinutes: z
        .string()
        .optional()
        .transform((v) => (v ? parseInt(v, 10) : 0)),
    healthCheckIds: z
        .preprocess((val) => {
            if (val === undefined || val === null || val === "") {
                return undefined;
            }
            const raw = Array.isArray(val) ? val : [val];
            const nums = raw
                .map((v) =>
                    typeof v === "string" ? parseInt(v, 10) : Number(v)
                )
                .filter((n) => Number.isInteger(n) && n > 0);
            const unique = [...new Set(nums)];
            return unique.length ? unique : undefined;
        }, z.array(z.number().int().positive()))
        .openapi({
            description: "Filter by healthCheckIds (repeat query param)"
        })
});

export async function getBatchedHealthCheckStatusHistory(
    req: Request,
    res: Response,
    next: NextFunction
): Promise<any> {
    try {
        const parsedQuery = healthCheckIdParamsSchema.safeParse(req.query);
        if (!parsedQuery.success) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    fromError(parsedQuery.error).toString()
                )
            );
        }

        const entityType = "health_check";
        const { days, healthCheckIds, tzOffsetMinutes } = parsedQuery.data;

        const data = await getBatchedStatusHistory(
            entityType,
            healthCheckIds,
            days,
            tzOffsetMinutes
        );

        return response<BatchedStatusHistoryResponse>(res, {
            data,
            success: true,
            error: false,
            message: "Status history retrieved successfully",
            status: HttpCode.OK
        });
    } catch (error) {
        logger.error(error);
        return next(
            createHttpError(HttpCode.INTERNAL_SERVER_ERROR, "An error occurred")
        );
    }
}
