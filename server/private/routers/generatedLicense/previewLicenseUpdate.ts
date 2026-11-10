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
import { fromError } from "zod-validation-error";
import stripe from "#private/lib/stripe";
import { buildQuantityItems } from "#private/lib/billing/selfHostedLicense";
import { PreviewLicenseUpdateResponse } from "@server/routers/generatedLicense/types";
import {
    annualTotalCents,
    chargeEquivalentCounts,
    isEditable,
    licenseKeyParamsSchema,
    licenseQuantitiesSchema,
    periodEnd,
    planQuantityChange,
    resolveLicenseSubscription
} from "./licenseSubscription";

/**
 * What changing a license's quantities would cost: the prorated amount
 * charged now for raises beyond what is paid for, when reductions apply, and
 * the new yearly price. Nothing is changed. See updateLicense.
 */
export async function previewLicenseUpdate(
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

        const licensed = {
            users: license.users,
            sites: license.sites,
            machines: license.machines
        };
        const plan = planQuantityChange(licensed, counts);

        let amountDue = 0;
        if (plan.raises) {
            const preview = await stripe!.invoices.createPreview({
                customer: subscription.customer as string,
                subscription: subscription.id,
                subscription_details: {
                    items: buildQuantityItems(
                        subscription,
                        chargeEquivalentCounts(subscription, licensed, counts)
                    ),
                    proration_behavior: "always_invoice"
                }
            });
            amountDue = preview.total;
        }

        return sendResponse<PreviewLicenseUpdateResponse>(res, {
            data: {
                amountDue,
                reductionsApplyAt: plan.reduces
                    ? new Date(periodEnd(subscription) * 1000).toISOString()
                    : null,
                newAnnualTotal: annualTotalCents(subscription, counts),
                currency: subscription.currency
            },
            success: true,
            error: false,
            message: "Preview created",
            status: HttpCode.OK
        });
    } catch (error) {
        logger.error(error);
        return next(
            createHttpError(
                HttpCode.INTERNAL_SERVER_ERROR,
                "An error occurred while previewing the license change"
            )
        );
    }
}
