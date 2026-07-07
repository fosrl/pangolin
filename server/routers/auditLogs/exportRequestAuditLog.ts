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
    queryAccessAuditLogsQuery,
    queryRequestAuditLogsParams,
    queryRequest,
    countRequestQuery
} from "./queryRequestAuditLog";
import { generateCSV } from "./generateCSV";

export const MAX_EXPORT_LIMIT = 50_000;

registry.registerPath({
    method: "get",
    path: "/org/{orgId}/logs/request",
    description: "Query the request audit log for an organization",
    tags: [OpenAPITags.Logs],
    request: {
        query: queryAccessAuditLogsQuery.omit({
            limit: true,
            offset: true
        }),
        params: queryRequestAuditLogsParams
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

export async function exportRequestAuditLogs(
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

        const parsedParams = queryRequestAuditLogsParams.safeParse(req.params);
        if (!parsedParams.success) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    fromError(parsedParams.error)
                )
            );
        }

        const data = { ...parsedQuery.data, ...parsedParams.data };

        const [{ count }] = await countRequestQuery(data);
        if (count > MAX_EXPORT_LIMIT) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    `Export limit exceeded. Your selection contains ${count} rows, but the maximum is ${MAX_EXPORT_LIMIT} rows. Please select a shorter time range to reduce the data.`
                )
            );
        }

        const baseQuery = queryRequest(data);

        const log = await baseQuery.limit(MAX_EXPORT_LIMIT);

        const csvData = generateCSV(log);

        res.setHeader("Content-Type", "text/csv");
        res.setHeader(
            "Content-Disposition",
            `attachment; filename="request-audit-logs-${data.orgId}-${Date.now()}.csv"`
        );

        return res.send(csvData);
    } catch (error) {
        logger.error(error);
        return next(
            createHttpError(HttpCode.INTERNAL_SERVER_ERROR, "An error occurred")
        );
    }
}
