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

import { NextFunction } from "express";
import { Request, Response } from "express";
import { z } from "zod";
import createHttpError from "http-errors";
import HttpCode from "@server/types/HttpCode";
import { fromError } from "zod-validation-error";
import response from "@server/lib/response";
import logger from "@server/logger";
import { logAccessAudit } from "#private/lib/logAccessAudit";

export const logAccessAuditAttemptSchema = z.object({
    resourceId: z.number().int().positive(),
    action: z.boolean(),
    type: z.enum(["login", "ssh", "vnc", "rdp"])
});

export const logAccessAuditAttemptParams = z.object({
    orgId: z.string()
});

export async function logAccessAuditAttempt(
    req: Request,
    res: Response,
    next: NextFunction
): Promise<any> {
    try {
        const parsedBody = logAccessAuditAttemptSchema.safeParse(req.body);
        if (!parsedBody.success) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    fromError(parsedBody.error)
                )
            );
        }
        const parsedParams = logAccessAuditAttemptParams.safeParse(req.params);
        if (!parsedParams.success) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    fromError(parsedParams.error)
                )
            );
        }

        const { orgId } = parsedParams.data;
        const { resourceId, action, type } = parsedBody.data;

        const username = req.user?.username;
        const userId = req.user?.userId;

        await logAccessAudit({
            orgId: orgId,
            resourceId: resourceId,
            action: action,
            ...(username && userId
                ? {
                      user: {
                          username,
                          userId
                      }
                  }
                : {}),
            type: type,
            userAgent: req.headers["user-agent"],
            requestIp: req.ip
        });

        return response<null>(res, {
            data: null,
            success: true,
            error: false,
            message: "Access audit attempt logged successfully",
            status: HttpCode.OK
        });
    } catch (error) {
        logger.error(error);
        return next(
            createHttpError(HttpCode.INTERNAL_SERVER_ERROR, "An error occurred")
        );
    }
}
