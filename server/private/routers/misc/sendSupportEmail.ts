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
import { sendEmail } from "@server/emails";
import SupportEmail from "@server/emails/templates/SupportEmail";
import config from "@server/lib/config";

const bodySchema = z
    .object({
        body: z.string().min(1),
        subject: z.string().min(1).max(255)
    })
    .strict();

export async function sendSupportEmail(
    req: Request,
    res: Response,
    next: NextFunction
): Promise<any> {
    try {
        const parsedBody = bodySchema.safeParse(req.body);
        if (!parsedBody.success) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    fromError(parsedBody.error).toString()
                )
            );
        }

        const { body, subject } = parsedBody.data;
        const user = req.user!;

        if (!user?.email) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    "User does not have an email associated with their account"
                )
            );
        }

        try {
            await sendEmail(
                SupportEmail({
                    username: user.username,
                    email: user.email,
                    subject,
                    body
                }),
                {
                    name: req.user?.email || "Support User",
                    to: "support@pangolin.net",
                    from: config.getNoReplyEmail(),
                    subject: `Support Request: ${subject}`
                }
            );
            return sendResponse(res, {
                data: {},
                success: true,
                error: false,
                message: "Sent support email successfully",
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
