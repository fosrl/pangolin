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
import {
    subscriptions,
    db,
    subscriptionItems,
    customers,
    userOrgs,
    users
} from "@server/db";
import { eq, and } from "drizzle-orm";
import logger from "@server/logger";
import { handleSubscriptionLifesycle } from "../subscriptionLifecycle";
import { getSubType } from "./getSubType";
import stripe from "#private/lib/stripe";
import privateConfig from "#private/lib/config";
import { handleTierChange } from "../featureLifecycle";

export async function handleSubscriptionDeleted(
    subscription: Stripe.Subscription
): Promise<void> {
    try {
        // Fetch the subscription from Stripe with expanded price.tiers
        const fullSubscription = await stripe!.subscriptions.retrieve(
            subscription.id,
            {
                expand: ["items.data.price.tiers"]
            }
        );

        const [existingSubscription] = await db
            .select()
            .from(subscriptions)
            .where(eq(subscriptions.subscriptionId, subscription.id))
            .limit(1);

        if (!existingSubscription) {
            logger.info(
                `Subscription with ID ${subscription.id} does not exist.`
            );
            return;
        }

        // If the subscription has been manually overridden, we lock it down
        // so Stripe can no longer change (or delete) its status locally.
        if (existingSubscription.override === true) {
            logger.info(
                `Subscription ${subscription.id} is locked (override=true). Ignoring deletion event from Stripe.`
            );
            return;
        }

        await db
            .delete(subscriptions)
            .where(eq(subscriptions.subscriptionId, subscription.id));

        await db
            .delete(subscriptionItems)
            .where(eq(subscriptionItems.subscriptionId, subscription.id));

        // Lookup customer to get orgId
        const [customer] = await db
            .select()
            .from(customers)
            .where(eq(customers.customerId, subscription.customer as string))
            .limit(1);

        if (!customer) {
            logger.error(
                `Customer with ID ${subscription.customer} not found for subscription ${subscription.id}.`
            );
            return;
        }

        const type = getSubType(fullSubscription);
        if (type == "tier1" || type == "tier2" || type == "tier3") {
            logger.debug(
                `Handling SaaS subscription deletion for orgId ${customer.orgId} and subscription ID ${subscription.id}`
            );

            await handleSubscriptionLifesycle(
                customer.orgId,
                subscription.status,
                type
            );

            // Handle feature lifecycle for cancellation - disable all tier-specific features
            logger.info(
                `Disabling tier-specific features for org ${customer.orgId} due to subscription deletion`
            );
            await handleTierChange(customer.orgId, null, type);

            const [orgUserRes] = await db
                .select()
                .from(userOrgs)
                .where(
                    and(
                        eq(userOrgs.orgId, customer.orgId),
                        eq(userOrgs.isOwner, true)
                    )
                )
                .innerJoin(users, eq(userOrgs.userId, users.userId));

            if (orgUserRes) {
                const email = orgUserRes.user.email;

                if (email) {
                    // TODO: update user in Sendy
                }
            }
        } else if (type === "license") {
            logger.debug(
                `Handling license subscription deletion for orgId ${customer.orgId} and subscription ID ${subscription.id}`
            );
            try {
                // WARNING:
                // this invalidates ALL OF THE ENTERPRISE LICENSES for this orgId
                await fetch(
                    `${privateConfig.getRawPrivateConfig().server.fossorial_api}/api/v1/license-internal/enterprise/invalidate`,
                    {
                        method: "POST",
                        headers: {
                            "api-key":
                                privateConfig.getRawPrivateConfig().server
                                    .fossorial_api_key!,
                            "Content-Type": "application/json"
                        },
                        body: JSON.stringify({
                            orgId: customer.orgId,
                        })
                    }
                );
            } catch (error) {
                logger.error(
                    `Error notifying Fossorial API of license subscription deletion for orgId ${customer.orgId} and subscription ID ${subscription.id}:`,
                    error
                );
            }
        }
    } catch (error) {
        logger.error(
            `Error handling subscription updated event for ID ${subscription.id}:`,
            error
        );
    }
    return;
}
