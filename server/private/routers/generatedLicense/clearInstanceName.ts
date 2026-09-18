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
import HttpCode from "@server/types/HttpCode";
import createHttpError from "http-errors";
import logger from "@server/logger";
import { response as sendResponse } from "@server/lib/response";
import privateConfig from "#private/lib/config";
import z from "zod";
import { fromError } from "zod-validation-error";

const clearInstanceNameParamsSchema = z.object({
    orgId: z.string(),
    licenseKey: z.string()
});

export async function clearInstanceName(
    req: Request,
    res: Response,
    next: NextFunction
): Promise<any> {
    try {
        const parsedParams = clearInstanceNameParamsSchema.safeParse(
            req.params
        );
        if (!parsedParams.success) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    fromError(parsedParams.error).toString()
                )
            );
        }

        const { licenseKey } = parsedParams.data;

        const apiResponse = await fetch(
            `${privateConfig.getRawPrivateConfig().server.fossorial_api}/api/v1/license-internal/enterprise/clear-instance-name`,
            {
                method: "POST",
                headers: {
                    "api-key":
                        privateConfig.getRawPrivateConfig().server
                            .fossorial_api_key!,
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({ licenseKey })
            }
        );

        const data = await apiResponse.json();

        if (!data.success || data.error) {
            return next(
                createHttpError(
                    data.status || HttpCode.BAD_REQUEST,
                    data.message ||
                        "Failed to clear server ID from Fossorial API"
                )
            );
        }

        return sendResponse<null>(res, {
            data: null,
            success: true,
            error: false,
            message: "Server ID cleared successfully",
            status: HttpCode.OK
        });
    } catch (error) {
        logger.error(error);
        return next(
            createHttpError(
                HttpCode.INTERNAL_SERVER_ERROR,
                "An error occurred while clearing the server ID."
            )
        );
    }
}
