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
import { createNewLicense } from "./generateNewLicense";
import config from "@server/lib/config";
import { getLicensePriceSet, LicenseId } from "@server/lib/billing/licenses";
import stripe from "#private/lib/stripe";
import { customers, db } from "@server/db";
import { fromError } from "zod-validation-error";
import z from "zod";
import { eq } from "drizzle-orm";
import { log } from "winston";

const generateNewEnterpriseLicenseParamsSchema = z.strictObject({
    orgId: z.string()
});

export async function generateNewEnterpriseLicense(
    req: Request,
    res: Response,
    next: NextFunction
): Promise<any> {
    try {
        const parsedParams = generateNewEnterpriseLicenseParamsSchema.safeParse(
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

        const { orgId } = parsedParams.data;

        if (!orgId) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    "Organization ID is required"
                )
            );
        }

        logger.debug(`Generating new license for orgId: ${orgId}`);

        const licenseData = req.body;

        if (licenseData.tier != "tier2" && licenseData.tier != "tier1") {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    "Invalid tier specified. Must be either 'tier2' or 'tier1'."
                )
            );
        }

        const apiResponse = await createNewLicense(orgId, licenseData);

        // Check if the API call was successful
        if (!apiResponse.success || apiResponse.error) {
            return next(
                createHttpError(
                    apiResponse.status || HttpCode.BAD_REQUEST,
                    apiResponse.message ||
                        "Failed to create license from Fossorial API"
                )
            );
        }

        const keyId = apiResponse?.data?.licenseKey?.id;
        if (!keyId) {
            return next(
                createHttpError(
                    HttpCode.INTERNAL_SERVER_ERROR,
                    "Fossorial API did not return a valid license key ID"
                )
            );
        }

        const licenseKeyValue = apiResponse?.data?.licenseKey?.licenseKey;

        // check if we already have a customer for this org
        const [customer] = await db
            .select()
            .from(customers)
            .where(eq(customers.orgId, orgId))
            .limit(1);

        // If we don't have a customer, create one
        if (!customer) {
            // error
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    "No customer found for this organization"
                )
            );
        }

        const tier =
            licenseData.tier === "tier2" ? LicenseId.TIER2 : LicenseId.TIER1;
        const tierPrice = getLicensePriceSet()[tier];

        const session = await stripe!.checkout.sessions.create({
            client_reference_id: keyId.toString(),
            billing_address_collection: "required",
            line_items: [
                {
                    price: tierPrice, // Use the standard tier
                    quantity: 1
                }
            ], // Start with the standard feature set that matches the free limits
            customer: customer.customerId,
            mode: "subscription",
            subscription_data: {
                description: licenseKeyValue
                    ? `License ${licenseKeyValue}`
                    : `License key ID ${keyId}`,
                metadata: {
                    licenseKeyId: keyId.toString(),
                    licenseKey: licenseKeyValue ?? "",
                    tier: licenseData.tier
                }
            },
            allow_promotion_codes: true,
            success_url: `${config.getRawConfig().app.dashboard_url}/${orgId}/settings/license?success=true&session_id={CHECKOUT_SESSION_ID}`,
            cancel_url: `${config.getRawConfig().app.dashboard_url}/${orgId}/settings/license?canceled=true`
        });

        return sendResponse<string>(res, {
            data: session.url,
            success: true,
            error: false,
            message: "License and checkout session created successfully",
            status: HttpCode.CREATED
        });
    } catch (error) {
        logger.error(error);
        return next(
            createHttpError(
                HttpCode.INTERNAL_SERVER_ERROR,
                "An error occurred while generating new license."
            )
        );
    }
}
