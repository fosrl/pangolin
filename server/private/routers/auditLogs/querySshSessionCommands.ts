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

import { logsDb, sshCommandLog, sshSessionLog } from "@server/db";
import { registry } from "@server/openApi";
import { NextFunction } from "express";
import { Request, Response } from "express";
import { and, asc, count, eq } from "drizzle-orm";
import { OpenAPITags } from "@server/openApi";
import { z } from "zod";
import createHttpError from "http-errors";
import HttpCode from "@server/types/HttpCode";
import { fromError } from "zod-validation-error";
import { QuerySshSessionCommandsResponse } from "@server/routers/auditLogs/types";
import response from "@server/lib/response";
import logger from "@server/logger";

const querySshSessionCommandsQuery = z.object({
    limit: z
        .string()
        .optional()
        .default("1000")
        .transform(Number)
        .pipe(z.int().positive().max(5000)),
    offset: z
        .string()
        .optional()
        .default("0")
        .transform(Number)
        .pipe(z.int().nonnegative())
});

const querySshSessionCommandsParams = z.object({
    orgId: z.string(),
    sshSessionLogId: z.string().transform(Number).pipe(z.int().positive())
});

registry.registerPath({
    method: "get",
    path: "/org/{orgId}/logs/ssh/{sshSessionLogId}/commands",
    description: "List the commands run in an SSH session",
    tags: [OpenAPITags.Logs],
    request: {
        query: querySshSessionCommandsQuery,
        params: querySshSessionCommandsParams
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

export async function querySshSessionCommands(
    req: Request,
    res: Response,
    next: NextFunction
): Promise<any> {
    try {
        const parsedQuery = querySshSessionCommandsQuery.safeParse(req.query);
        if (!parsedQuery.success) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    fromError(parsedQuery.error)
                )
            );
        }
        const parsedParams = querySshSessionCommandsParams.safeParse(
            req.params
        );
        if (!parsedParams.success) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    fromError(parsedParams.error)
                )
            );
        }

        const { orgId, sshSessionLogId } = parsedParams.data;
        const { limit, offset } = parsedQuery.data;

        const [session] = await logsDb
            .select({ id: sshSessionLog.id })
            .from(sshSessionLog)
            .where(
                and(
                    eq(sshSessionLog.id, sshSessionLogId),
                    eq(sshSessionLog.orgId, orgId)
                )
            )
            .limit(1);

        if (!session) {
            return next(
                createHttpError(HttpCode.NOT_FOUND, "SSH session not found")
            );
        }

        const where = and(
            eq(sshCommandLog.sshSessionLogId, sshSessionLogId),
            eq(sshCommandLog.orgId, orgId)
        );

        const commands = await logsDb
            .select({
                id: sshCommandLog.id,
                command: sshCommandLog.command,
                channel: sshCommandLog.channel,
                inexact: sshCommandLog.inexact,
                timestamp: sshCommandLog.timestamp
            })
            .from(sshCommandLog)
            .where(where)
            .orderBy(asc(sshCommandLog.timestamp), asc(sshCommandLog.id))
            .limit(limit)
            .offset(offset);

        const [{ count: total }] = await logsDb
            .select({ count: count() })
            .from(sshCommandLog)
            .where(where);

        return response<QuerySshSessionCommandsResponse>(res, {
            data: {
                commands,
                pagination: { total, limit, offset }
            },
            success: true,
            error: false,
            message: "SSH session commands retrieved successfully",
            status: HttpCode.OK
        });
    } catch (error) {
        logger.error(error);
        return next(
            createHttpError(HttpCode.INTERNAL_SERVER_ERROR, "An error occurred")
        );
    }
}
