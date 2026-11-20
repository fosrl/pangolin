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

import stripe from "#private/lib/stripe";
import privateConfig from "#private/lib/config";
import logger from "@server/logger";
import createHttpError from "http-errors";
import { response } from "@server/lib/response";
import { Request, Response, NextFunction } from "express";
import HttpCode from "@server/types/HttpCode";
import Stripe from "stripe";
import { handleCustomerCreated } from "./hooks/handleCustomerCreated";
import { handleSubscriptionCreated } from "./hooks/handleSubscriptionCreated";
import { handleSubscriptionUpdated } from "./hooks/handleSubscriptionUpdated";
import { handleCustomerUpdated } from "./hooks/handleCustomerUpdated";
import { handleSubscriptionDeleted } from "./hooks/handleSubscriptionDeleted";
import { handleCustomerDeleted } from "./hooks/handleCustomerDeleted";
import {
    handleSelfHostedCheckoutCompleted,
    handleSelfHostedInvoicePaid
} from "./hooks/handleSelfHostedLicense";

export async function billingWebhookHandler(
    req: Request,
    res: Response,
    next: NextFunction
): Promise<any> {
    let event: Stripe.Event = req.body;
    const endpointSecret =
        privateConfig.getRawPrivateConfig().stripe?.webhook_secret;
    if (!endpointSecret) {
        logger.warn(
            "Stripe webhook secret is not configured. Webhook events will not be priocessed."
        );
        return next(createHttpError(HttpCode.INTERNAL_SERVER_ERROR, ""));
    }

    // Only verify the event if you have an endpoint secret defined.
    // Otherwise use the basic event deserialized with JSON.parse
    if (endpointSecret) {
        // Get the signature sent by Stripe
        const signature = req.headers["stripe-signature"];

        if (!signature) {
            logger.info("No stripe signature found in headers.");
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    "No stripe signature found in headers"
                )
            );
        }

        try {
            event = stripe!.webhooks.constructEvent(
                req.body,
                signature,
                endpointSecret
            );
        } catch (err) {
            logger.error(`Webhook signature verification failed.`, err);
            return next(
                createHttpError(
                    HttpCode.UNAUTHORIZED,
                    "Webhook signature verification failed"
                )
            );
        }
    }
    let subscription;
    let previousAttributes;
    // Handle the event
    switch (event.type) {
        case "customer.created":
            const customer = event.data.object;
            logger.info("Customer created: ", customer);
            handleCustomerCreated(customer);
            break;
        case "customer.updated":
            const customerUpdated = event.data.object;
            logger.info("Customer updated: ", customerUpdated);
            handleCustomerUpdated(customerUpdated);
            break;
        case "customer.deleted":
            const customerDeleted = event.data.object;
            logger.info("Customer deleted: ", customerDeleted);
            handleCustomerDeleted(customerDeleted);
            break;
        case "customer.subscription.paused":
            subscription = event.data.object;
            previousAttributes = event.data.previous_attributes;
            handleSubscriptionUpdated(subscription, previousAttributes);
            break;
        case "customer.subscription.resumed":
            subscription = event.data.object;
            previousAttributes = event.data.previous_attributes;
            handleSubscriptionUpdated(subscription, previousAttributes);
            break;
        case "customer.subscription.deleted":
            subscription = event.data.object;
            handleSubscriptionDeleted(subscription);
            break;
        case "customer.subscription.created":
            subscription = event.data.object;
            handleSubscriptionCreated(subscription);
            break;
        case "customer.subscription.updated":
            subscription = event.data.object;
            previousAttributes = event.data.previous_attributes;
            handleSubscriptionUpdated(subscription, previousAttributes);
            break;
        case "checkout.session.completed":
        case "checkout.session.async_payment_succeeded":
            // Only self-hosted license checkouts from the website act on
            // this; SaaS checkouts are handled via the subscription events.
            handleSelfHostedCheckoutCompleted(event.data.object);
            break;
        case "invoice.paid":
            handleSelfHostedInvoicePaid(event.data.object);
            break;
        case "customer.subscription.trial_will_end":
            subscription = event.data.object;
            // Then define and call a method to handle the subscription trial ending.
            // handleSubscriptionTrialEnding(subscription);
            break;
        case "entitlements.active_entitlement_summary.updated":
            subscription = event.data.object;
            logger.info(
                `Active entitlement summary updated for ${subscription}.`
            );
            // Then define and call a method to handle active entitlement summary updated
            // handleEntitlementUpdated(subscription);
            break;
        default:
            // Unexpected event type
            logger.info(`Unhandled event type ${event.type}.`);
    }
    // Return a 200 response to acknowledge receipt of the event
    return response(res, {
        data: null,
        success: true,
        error: false,
        message: "Webhook event processed successfully",
        status: HttpCode.CREATED
    });
}
