/*
 * This file is part of a proprietary work.
 *
 * Copyright (c) 2025 Fossorial, Inc.
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
import license from "#private/license/license";

export async function recheckStatus(
    req: Request,
    res: Response,
    next: NextFunction
): Promise<any> {
    try {
        try {
            const status = await license.forceRecheck();
            return sendResponse(res, {
                data: status,
                success: true,
                error: false,
                message: "License status rechecked successfully",
                status: HttpCode.OK
            });
        } catch (e) {
            logger.error(e);
            return next(
                createHttpError(HttpCode.INTERNAL_SERVER_ERROR, `${e}`)
            );
        }
    } catch (error) {
        logger.error(error);
        return next(
            createHttpError(HttpCode.INTERNAL_SERVER_ERROR, "An error occurred")
        );
    }
}
