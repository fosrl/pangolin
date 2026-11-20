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

import Stripe from "stripe";
import { customers, db, subscriptions } from "@server/db";
import { eq } from "drizzle-orm";
import logger from "@server/logger";
import { generateId } from "@server/auth/sessions/app";
import { handleSubscriptionLifesycle } from "../subscriptionLifecycle";

export async function handleCustomerCreated(
    customer: Stripe.Customer
): Promise<void> {
    try {
        const [existingCustomer] = await db
            .select()
            .from(customers)
            .where(eq(customers.customerId, customer.id))
            .limit(1);

        if (existingCustomer) {
            logger.info(`Customer with ID ${customer.id} already exists.`);
            return;
        }

        if (!customer.metadata.orgId) {
            // this could be expected when buying a license from the website
            logger.debug(
                `Customer with ID ${customer.id} does not have an orgId in metadata.`
            );
            return;
        }

        await db.transaction(async (trx) => {
            await trx.insert(customers).values({
                customerId: customer.id,
                orgId: customer.metadata.orgId,
                email: customer.email || null,
                name: customer.name || null,
                createdAt: customer.created,
                updatedAt: customer.created
            });

            // Insert a 14-day trial subscription at tier3
            const now = Math.floor(Date.now() / 1000);
            const trialExpiresAt = now + 10 * 24 * 60 * 60;
            const subscriptionId = `trial-${generateId(15)}`;
            await trx.insert(subscriptions).values({
                subscriptionId,
                customerId: customer.id,
                status: "active",
                type: "tier3",
                createdAt: now,
                expiresAt: trialExpiresAt,
                trial: true
            });

            // update to the business limits for the trial
            await handleSubscriptionLifesycle(
                customer.metadata.orgId,
                "active",
                "tier3"
            );
        });

        logger.info(`Customer with ID ${customer.id} created successfully.`);
    } catch (error) {
        logger.error(
            `Error handling customer created event for ID ${customer.id}:`,
            error
        );
    }
    return;
}
