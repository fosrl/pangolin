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
import { z } from "zod";
import { fromError } from "zod-validation-error";
import { db } from "@server/db";
import { eq } from "drizzle-orm";
import { licenseKey } from "@server/db";
import license from "#private/license/license";

const paramsSchema = z
    .object({
        licenseKey: z.string().min(1).max(255)
    })
    .strict();

export async function deleteLicenseKey(
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

        const { licenseKey: key } = parsedParams.data;

        const [existing] = await db
            .select()
            .from(licenseKey)
            .where(eq(licenseKey.licenseKeyId, key))
            .limit(1);

        if (!existing) {
            return next(
                createHttpError(
                    HttpCode.NOT_FOUND,
                    `License key ${key} not found`
                )
            );
        }

        await db.delete(licenseKey).where(eq(licenseKey.licenseKeyId, key));

        const status = await license.forceRecheck();

        return sendResponse(res, {
            data: status,
            success: true,
            error: false,
            message: "License key deleted successfully",
            status: HttpCode.OK
        });
    } catch (error) {
        logger.error(error);
        return next(
            createHttpError(HttpCode.INTERNAL_SERVER_ERROR, "An error occurred")
        );
    }
}
