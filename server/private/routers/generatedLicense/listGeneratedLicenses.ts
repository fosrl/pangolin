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
import { getFirstString } from "@server/lib/requestParams";
import stripe from "#private/lib/stripe";
import { listOrgLicenses } from "#private/lib/billing/licenseApi";
import { ListGeneratedLicenseKeysResponse } from "@server/routers/generatedLicense/types";
import { toGeneratedLicenseKey } from "./licenseSubscription";

export async function listSaasLicenseKeys(
    req: Request,
    res: Response,
    next: NextFunction
): Promise<any> {
    try {
        const orgId = getFirstString(req.params.orgId);

        if (!orgId) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    "Organization ID is required"
                )
            );
        }

        const result = await listOrgLicenses(orgId);
        if (!result.ok) {
            throw new Error(
                `Fossorial API returned ${result.status} listing licenses for org ${orgId}: ${result.body}`
            );
        }

        // Paid keys show their subscription's state (renewal date, whether
        // it is set to cancel, whether it can be edited).
        const keys = await Promise.all(
            result.data.licenseKeys.map(async (license) => {
                if (!license.stripeSubscriptionId) {
                    return toGeneratedLicenseKey(license, null);
                }
                try {
                    const subscription = await stripe!.subscriptions.retrieve(
                        license.stripeSubscriptionId
                    );
                    return toGeneratedLicenseKey(license, subscription);
                } catch (error) {
                    logger.error(
                        `Failed to load subscription ${license.stripeSubscriptionId} for a license in org ${orgId}:`,
                        error
                    );
                    return toGeneratedLicenseKey(license, null);
                }
            })
        );

        return sendResponse<ListGeneratedLicenseKeysResponse>(res, {
            data: keys,
            success: true,
            error: false,
            message: "Successfully retrieved license keys",
            status: HttpCode.OK
        });
    } catch (error) {
        logger.error(error);
        return next(
            createHttpError(
                HttpCode.INTERNAL_SERVER_ERROR,
                "An error occurred while fetching license keys"
            )
        );
    }
}
