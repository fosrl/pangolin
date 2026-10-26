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
import { OpenAPITags } from "@server/openApi";
import createHttpError from "http-errors";
import HttpCode from "@server/types/HttpCode";
import { fromError } from "zod-validation-error";
import { z } from "zod";
import { asc, count, eq } from "drizzle-orm";
import logger from "@server/logger";
import {
    querySshSessionLogsParams,
    querySshSessionLogsQuery,
    getSshSessionWhere
} from "./querySshSessionLog";
import { generateCSV } from "@server/routers/auditLogs/generateCSV";
import { MAX_EXPORT_LIMIT } from "@server/routers/auditLogs";

registry.registerPath({
    method: "get",
    path: "/org/{orgId}/logs/ssh/export",
    description:
        "Export the SSH session log for an organization as CSV, one row per command",
    tags: [OpenAPITags.Logs],
    request: {
        query: querySshSessionLogsQuery.omit({ limit: true, offset: true }),
        params: querySshSessionLogsParams
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

export async function exportSshSessionLogs(
    req: Request,
    res: Response,
    next: NextFunction
): Promise<any> {
    try {
        const parsedQuery = querySshSessionLogsQuery.safeParse(req.query);
        if (!parsedQuery.success) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    fromError(parsedQuery.error)
                )
            );
        }

        const parsedParams = querySshSessionLogsParams.safeParse(req.params);
        if (!parsedParams.success) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    fromError(parsedParams.error)
                )
            );
        }

        const data = { ...parsedQuery.data, ...parsedParams.data };
        const where = getSshSessionWhere(data);

        const [{ count: rowCount }] = await logsDb
            .select({ count: count() })
            .from(sshCommandLog)
            .innerJoin(
                sshSessionLog,
                eq(sshCommandLog.sshSessionLogId, sshSessionLog.id)
            )
            .where(where);
        if (rowCount > MAX_EXPORT_LIMIT) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    `Export limit exceeded. Your selection contains ${rowCount} rows, but the maximum is ${MAX_EXPORT_LIMIT} rows. Please select a shorter time range to reduce the data.`
                )
            );
        }

        const log = await logsDb
            .select({
                timestamp: sshCommandLog.timestamp,
                sessionId: sshSessionLog.sessionId,
                siteId: sshSessionLog.siteId,
                siteResourceId: sshSessionLog.siteResourceId,
                resourceId: sshSessionLog.resourceId,
                clientId: sshSessionLog.clientId,
                userId: sshSessionLog.userId,
                transport: sshSessionLog.transport,
                username: sshSessionLog.username,
                authMethod: sshSessionLog.authMethod,
                sourceAddr: sshSessionLog.sourceAddr,
                destAddr: sshSessionLog.destAddr,
                channel: sshCommandLog.channel,
                command: sshCommandLog.command,
                inexact: sshCommandLog.inexact
            })
            .from(sshCommandLog)
            .innerJoin(
                sshSessionLog,
                eq(sshCommandLog.sshSessionLogId, sshSessionLog.id)
            )
            .where(where)
            .orderBy(asc(sshCommandLog.timestamp), asc(sshCommandLog.id))
            .limit(MAX_EXPORT_LIMIT);

        const csvData = generateCSV(log);

        res.setHeader("Content-Type", "text/csv; charset=utf-8");
        res.setHeader(
            "Content-Disposition",
            `attachment; filename="ssh-session-logs-${data.orgId}-${Date.now()}.csv"`
        );

        return res.send(csvData);
    } catch (error) {
        logger.error(error);
        return next(
            createHttpError(HttpCode.INTERNAL_SERVER_ERROR, "An error occurred")
        );
    }
}
