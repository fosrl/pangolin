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
import { z } from "zod";
import HttpCode from "@server/types/HttpCode";
import createHttpError from "http-errors";
import logger from "@server/logger";
import { response as sendResponse } from "@server/lib/response";
import { fromError } from "zod-validation-error";
import stripe from "#private/lib/stripe";
import { UpdateLicenseResponse } from "@server/routers/generatedLicense/types";
import {
    licenseKeyParamsSchema,
    resolveLicenseSubscription,
    toGeneratedLicenseKey
} from "./licenseSubscription";

const bodySchema = z.strictObject({
    // true: stop renewing at the end of the paid period; false: undo that
    cancel: z.boolean()
});

/**
 * Cancels a license's subscription at the end of its paid period (or undoes
 * that). The key keeps working until then; the subscription.deleted webhook
 * revokes it when the period ends.
 */
export async function cancelLicense(
    req: Request,
    res: Response,
    next: NextFunction
): Promise<any> {
    try {
        const parsedParams = licenseKeyParamsSchema.safeParse(req.params);
        if (!parsedParams.success) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    fromError(parsedParams.error).toString()
                )
            );
        }
        const parsedBody = bodySchema.safeParse(req.body);
        if (!parsedBody.success) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    fromError(parsedBody.error).toString()
                )
            );
        }

        const { orgId, licenseKey } = parsedParams.data;
        const { cancel } = parsedBody.data;

        const resolved = await resolveLicenseSubscription(orgId, licenseKey);
        if ("error" in resolved) {
            return next(resolved.error);
        }
        const { license, subscription } = resolved;

        if (
            subscription.status === "canceled" ||
            subscription.status === "incomplete_expired"
        ) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    "This license's subscription has already ended"
                )
            );
        }

        // Stripe rejects cancel_at_period_end and cancel_at together. To
        // resume, clear whichever one set the cancellation: the dashboard
        // sets cancel_at_period_end, the Stripe customer portal sets
        // cancel_at alone.
        const updated = await stripe!.subscriptions.update(
            subscription.id,
            cancel
                ? { cancel_at_period_end: true }
                : subscription.cancel_at_period_end
                  ? { cancel_at_period_end: false }
                  : { cancel_at: "" }
        );

        logger.info(
            `License subscription ${subscription.id} in org ${orgId} ${cancel ? "set to cancel at period end" : "will renew again"}.`
        );

        return sendResponse<UpdateLicenseResponse>(res, {
            data: toGeneratedLicenseKey(license, updated),
            success: true,
            error: false,
            message: cancel
                ? "License will be canceled at the end of the period"
                : "License will renew",
            status: HttpCode.OK
        });
    } catch (error) {
        logger.error(error);
        return next(
            createHttpError(
                HttpCode.INTERNAL_SERVER_ERROR,
                "An error occurred while canceling the license"
            )
        );
    }
}
