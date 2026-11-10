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
import Stripe from "stripe";
import HttpCode from "@server/types/HttpCode";
import createHttpError from "http-errors";
import logger from "@server/logger";
import { response as sendResponse } from "@server/lib/response";
import { fromError } from "zod-validation-error";
import stripe from "#private/lib/stripe";
import { extendLicense } from "#private/lib/billing/licenseApi";
import {
    buildQuantityItems,
    getLicenseCounts,
    quantityMetadata
} from "#private/lib/billing/selfHostedLicense";
import { UpdateLicenseResponse } from "@server/routers/generatedLicense/types";
import {
    isEditable,
    LicenseCounts,
    licenseKeyParamsSchema,
    licenseQuantitiesSchema,
    planQuantityChange,
    resolveLicenseSubscription,
    sameCounts,
    toGeneratedLicenseKey
} from "./licenseSubscription";

/**
 * Changes a license's users, sites and machine clients (see
 * planQuantityChange). Two subscription updates:
 * 1. without proration: reductions, and raises back up to what is already
 *    paid for this period;
 * 2. with the prorated difference invoiced and charged right away: raises
 *    beyond that. If the charge fails Stripe rejects this update, and step 1
 *    is undone so nothing changes.
 * The key then gets the larger of its old and new counts; reductions reach
 * it when the renewal invoice is paid (handleSelfHostedInvoicePaid).
 */
export async function updateLicense(
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
        const parsedBody = licenseQuantitiesSchema.safeParse(req.body);
        if (!parsedBody.success) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    fromError(parsedBody.error).toString()
                )
            );
        }

        const { orgId, licenseKey } = parsedParams.data;
        const counts = {
            users: parsedBody.data.users,
            sites: parsedBody.data.sites,
            machines: parsedBody.data.machineClients
        };

        const resolved = await resolveLicenseSubscription(orgId, licenseKey);
        if ("error" in resolved) {
            return next(resolved.error);
        }
        const { license, subscription } = resolved;

        if (!isEditable(subscription)) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    "This license can't be changed right now"
                )
            );
        }

        const current = getLicenseCounts(subscription)!;
        if (sameCounts(current, counts)) {
            return next(
                createHttpError(HttpCode.BAD_REQUEST, "Nothing to change")
            );
        }

        const licensed: LicenseCounts = {
            users: license.users,
            sites: license.sites,
            machines: license.machines
        };
        const plan = planQuantityChange(licensed, counts);

        const setCounts = (
            sub: Stripe.Subscription,
            to: LicenseCounts,
            charge: boolean
        ) =>
            stripe!.subscriptions.update(sub.id, {
                items: buildQuantityItems(sub, to),
                metadata: quantityMetadata(sub, to),
                ...(charge
                    ? {
                          proration_behavior: "always_invoice",
                          payment_behavior: "error_if_incomplete"
                      }
                    : { proration_behavior: "none" })
            });

        let updated = subscription;
        if (!sameCounts(current, plan.unpaid)) {
            updated = await setCounts(subscription, plan.unpaid, false);
        }

        if (plan.raises) {
            try {
                updated = await setCounts(updated, counts, true);
            } catch (error) {
                if (updated !== subscription) {
                    await setCounts(updated, current, false).catch((e) =>
                        logger.error(
                            `Failed to undo the unprorated change to subscription ${subscription.id} after its charge failed:`,
                            e
                        )
                    );
                }
                if (error instanceof Stripe.errors.StripeCardError) {
                    return next(
                        createHttpError(
                            HttpCode.PAYMENT_REQUIRED,
                            `Payment failed: ${error.message}`
                        )
                    );
                }
                throw error;
            }
        }

        // The webhooks only ever raise the key's counts mid-period; set them
        // here so the dashboard shows the new limits right away.
        const result = await extendLicense({
            subscriptionId: subscription.id,
            users: plan.allowed.users,
            sites: plan.allowed.sites,
            machines: plan.allowed.machines
        });
        if (!result.ok) {
            logger.error(
                `Subscription ${subscription.id} was updated but the Fossorial API returned ${result.status} updating its license: ${result.body}`
            );
        }

        logger.info(
            `License for subscription ${subscription.id} in org ${orgId} changed to ${counts.users} users, ${counts.sites} sites, ${counts.machines} machine clients${plan.reduces ? " (reductions apply at renewal)" : ""}.`
        );

        return sendResponse<UpdateLicenseResponse>(res, {
            data: toGeneratedLicenseKey(
                { ...license, ...plan.allowed },
                updated
            ),
            success: true,
            error: false,
            message: "License updated",
            status: HttpCode.OK
        });
    } catch (error) {
        logger.error(error);
        return next(
            createHttpError(
                HttpCode.INTERNAL_SERVER_ERROR,
                "An error occurred while updating the license"
            )
        );
    }
}
