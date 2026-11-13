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
    buildStateItems,
    getLicenseCounts,
    LicenseState,
    licenseTierFor,
    stateMetadata
} from "#private/lib/billing/selfHostedLicense";
import { SELF_HOSTED_LIMITS } from "@server/lib/billing/selfHostedLicenseLimits";
import { UpdateLicenseResponse } from "@server/routers/generatedLicense/types";
import {
    isEditable,
    licensedState,
    licenseKeyParamsSchema,
    licenseQuantitiesSchema,
    planChange,
    resolveLicenseSubscription,
    sameState,
    toGeneratedLicenseKey,
    supportNeedsMoreUsers
} from "./licenseSubscription";

/**
 * Changes a license's users, sites, machine clients, high availability and
 * support (see planChange). Raises apply now and are charged for the rest of
 * the period; reductions apply at renewal. The subscription is stepped
 * through up to three states:
 * 1. what is already paid for this period (without proration), when the
 *    subscription is below it because of a reduction waiting for renewal;
 * 2. what the key allows from now on, the higher of old and new, with the
 *    prorated difference invoiced and charged right away. If the charge
 *    fails Stripe rejects this update and step 1 is undone, so nothing
 *    changes;
 * 3. the requested state, without proration, so the renewal bills it.
 * High availability and support are a percentage of the base price, so they
 * are repriced in each step. The key then gets the allowed state; reductions
 * reach it when the renewal invoice is paid (handleSelfHostedInvoicePaid).
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
        const target: LicenseState = {
            users: parsedBody.data.users,
            sites: parsedBody.data.sites,
            machines: parsedBody.data.machineClients,
            highAvailability: parsedBody.data.highAvailability,
            support: parsedBody.data.support
        };

        if (supportNeedsMoreUsers(target)) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    `Email and priority support need more than ${SELF_HOSTED_LIMITS.supportAboveUsers} users`
                )
            );
        }

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
        if (sameState(current, target)) {
            return next(
                createHttpError(HttpCode.BAD_REQUEST, "Nothing to change")
            );
        }

        const licensed = licensedState(license);
        const plan = planChange(licensed, target);

        const setState = (
            sub: Stripe.Subscription,
            to: LicenseState,
            charge: boolean
        ) =>
            stripe!.subscriptions.update(sub.id, {
                items: buildStateItems(sub, to),
                metadata: stateMetadata(sub, to),
                ...(charge
                    ? {
                          proration_behavior: "always_invoice",
                          payment_behavior: "error_if_incomplete"
                      }
                    : { proration_behavior: "none" })
            });

        let updated = subscription;
        if (!plan.raises) {
            updated = await setState(subscription, target, false);
        } else {
            // Charge from what was paid for, not from where a pending
            // reduction left the subscription
            if (!sameState(current, licensed)) {
                updated = await setState(updated, licensed, false);
            }
            try {
                updated = await setState(updated, plan.allowed, true);
            } catch (error) {
                if (updated !== subscription) {
                    await setState(updated, current, false).catch((e) =>
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
            if (plan.reduces) {
                try {
                    updated = await setState(updated, target, false);
                } catch (error) {
                    // The charge went through, so the key still gets what
                    // was paid for; only the renewal state is wrong
                    logger.error(
                        `Subscription ${subscription.id} was charged for its raise but its reductions could not be scheduled for renewal:`,
                        error
                    );
                }
            }
        }

        // The webhooks only ever raise the key's values mid-period; set them
        // here so the dashboard shows the new limits right away.
        const result = await extendLicense({
            subscriptionId: subscription.id,
            users: plan.allowed.users,
            sites: plan.allowed.sites,
            machines: plan.allowed.machines,
            tier: licenseTierFor(plan.allowed.highAvailability),
            support: plan.allowed.support
        });
        if (!result.ok) {
            logger.error(
                `Subscription ${subscription.id} was updated but the Fossorial API returned ${result.status} updating its license: ${result.body}`
            );
        }

        logger.info(
            `License for subscription ${subscription.id} in org ${orgId} changed to ${target.users} users, ${target.sites} sites, ${target.machines} machine clients, high availability ${target.highAvailability ? "on" : "off"}, ${target.support} support${plan.reduces ? " (reductions apply at renewal)" : ""}.`
        );

        return sendResponse<UpdateLicenseResponse>(res, {
            data: toGeneratedLicenseKey(
                {
                    ...license,
                    users: plan.allowed.users,
                    sites: plan.allowed.sites,
                    machines: plan.allowed.machines,
                    tier: licenseTierFor(plan.allowed.highAvailability),
                    support: plan.allowed.support
                },
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
