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

import { registry } from "@server/openApi";
import { NextFunction } from "express";
import { Request, Response } from "express";
import { OpenAPITags } from "@server/openApi";
import createHttpError from "http-errors";
import HttpCode from "@server/types/HttpCode";
import { fromError } from "zod-validation-error";
import { z } from "zod";
import logger from "@server/logger";
import {
    queryAccessAuditLogsParams,
    queryAccessAuditLogsQuery,
    queryAccess,
    countAccessQuery
} from "./queryAccessAuditLog";
import { generateCSV } from "@server/routers/auditLogs/generateCSV";
import { MAX_EXPORT_LIMIT } from "@server/routers/auditLogs";

registry.registerPath({
    method: "get",
    path: "/org/{orgId}/logs/access/export",
    description: "Export the access audit log for an organization as CSV",
    tags: [OpenAPITags.Logs],
    request: {
        query: queryAccessAuditLogsQuery,
        params: queryAccessAuditLogsParams
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

export async function exportAccessAuditLogs(
    req: Request,
    res: Response,
    next: NextFunction
): Promise<any> {
    try {
        const parsedQuery = queryAccessAuditLogsQuery.safeParse(req.query);
        if (!parsedQuery.success) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    fromError(parsedQuery.error)
                )
            );
        }

        const parsedParams = queryAccessAuditLogsParams.safeParse(req.params);
        if (!parsedParams.success) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    fromError(parsedParams.error)
                )
            );
        }

        const data = { ...parsedQuery.data, ...parsedParams.data };
        const [{ count }] = await countAccessQuery(data);
        if (count > MAX_EXPORT_LIMIT) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    `Export limit exceeded. Your selection contains ${count} rows, but the maximum is ${MAX_EXPORT_LIMIT} rows. Please select a shorter time range to reduce the data.`
                )
            );
        }

        const baseQuery = queryAccess(data);

        const log = await baseQuery.limit(data.limit).offset(data.offset);

        const csvData = generateCSV(log);

        res.setHeader("Content-Type", "text/csv");
        res.setHeader(
            "Content-Disposition",
            `attachment; filename="access-audit-logs-${data.orgId}-${Date.now()}.csv"`
        );

        return res.send(csvData);
    } catch (error) {
        logger.error(error);
        return next(
            createHttpError(HttpCode.INTERNAL_SERVER_ERROR, "An error occurred")
        );
    }
}
