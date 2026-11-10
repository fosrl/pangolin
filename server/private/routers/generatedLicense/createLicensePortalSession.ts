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
import config from "@server/lib/config";
import { response as sendResponse } from "@server/lib/response";
import { fromError } from "zod-validation-error";
import stripe from "#private/lib/stripe";
import {
    licenseKeyParamsSchema,
    resolveLicenseSubscription
} from "./licenseSubscription";

/**
 * Opens the Stripe customer portal for a paid license key (payment methods,
 * invoices, billing details). Each website checkout creates its own Stripe
 * customer, separate from the org's cloud billing customer, so the portal is
 * per license rather than one for the whole org.
 */
export async function createLicensePortalSession(
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

        const { orgId, licenseKey } = parsedParams.data;

        const resolved = await resolveLicenseSubscription(orgId, licenseKey);
        if ("error" in resolved) {
            return next(resolved.error);
        }
        const { subscription } = resolved;

        const customerId =
            typeof subscription.customer === "string"
                ? subscription.customer
                : subscription.customer.id;

        const portalSession = await stripe!.billingPortal.sessions.create({
            customer: customerId,
            return_url: `${config.getRawConfig().app.dashboard_url}/${orgId}/settings/license`
        });

        return sendResponse<string>(res, {
            data: portalSession.url,
            success: true,
            error: false,
            message: "Portal session created",
            status: HttpCode.OK
        });
    } catch (error) {
        logger.error(error);
        return next(
            createHttpError(
                HttpCode.INTERNAL_SERVER_ERROR,
                "An error occurred while opening the billing portal"
            )
        );
    }
}
