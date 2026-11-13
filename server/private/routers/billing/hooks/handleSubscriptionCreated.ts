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
    customers,
    subscriptions,
    db,
    subscriptionItems,
    userOrgs,
    users
} from "@server/db";
import { eq, and } from "drizzle-orm";
import logger from "@server/logger";
import stripe from "#private/lib/stripe";
import { handleSubscriptionLifesycle } from "../subscriptionLifecycle";
import { getSubType } from "./getSubType";
import { getFeatureIdByPriceId } from "@server/lib/billing/features";
import { handleTierChange } from "../featureLifecycle";
import { isSelfHostedLicense } from "./handleSelfHostedLicense";

export async function handleSubscriptionCreated(
    subscription: Stripe.Subscription
): Promise<void> {
    if (isSelfHostedLicense(subscription.metadata)) {
        // Website license purchases have no org; the license is created from
        // checkout.session.completed (handleSelfHostedCheckoutCompleted).
        logger.debug(
            `Subscription ${subscription.id} is a self-hosted license purchase; handled at checkout completion.`
        );
        return;
    }

    try {
        // Fetch the subscription from Stripe with expanded price.tiers
        const fullSubscription = await stripe!.subscriptions.retrieve(
            subscription.id,
            {
                expand: ["items.data.price.tiers"]
            }
        );

        logger.info(JSON.stringify(fullSubscription, null, 2));
        // Check if subscription already exists
        const [existingSubscription] = await db
            .select()
            .from(subscriptions)
            .where(eq(subscriptions.subscriptionId, subscription.id))
            .limit(1);

        if (existingSubscription) {
            logger.info(
                `Subscription with ID ${subscription.id} already exists.`
            );
            return;
        }

        const type = getSubType(fullSubscription);

        const newSubscription = {
            subscriptionId: subscription.id,
            customerId: subscription.customer as string,
            status: subscription.status,
            canceledAt: subscription.canceled_at
                ? subscription.canceled_at
                : null,
            createdAt: subscription.created,
            type: type,
            version: 1 // we are hardcoding the initial version when the subscription is created, and then we will increment it on every update
        };

        await db.insert(subscriptions).values(newSubscription);
        logger.info(
            `Subscription with ID ${subscription.id} created successfully.`
        );

        // Insert subscription items
        if (Array.isArray(fullSubscription.items?.data)) {
            const itemsToInsertPromises = fullSubscription.items.data.map(
                async (item) => {
                    // try to get the product name from stripe and add it to the item
                    let name = null;
                    if (item.price.product) {
                        const product = await stripe!.products.retrieve(
                            item.price.product as string
                        );
                        name = product.name || null;
                    }

                    // Get the feature ID from the price ID
                    const featureId = getFeatureIdByPriceId(item.price.id);

                    return {
                        stripeSubscriptionItemId: item.id,
                        subscriptionId: subscription.id,
                        planId: item.plan.id,
                        priceId: item.price.id,
                        featureId: featureId || null,
                        meterId: item.plan.meter,
                        unitAmount: item.price.unit_amount || 0,
                        currentPeriodStart: item.current_period_start,
                        currentPeriodEnd: item.current_period_end,
                        tiers: item.price.tiers
                            ? JSON.stringify(item.price.tiers)
                            : null,
                        interval: item.plan.interval,
                        name
                    };
                }
            );

            // wait for all items to be processed
            const itemsToInsert = await Promise.all(itemsToInsertPromises);

            if (itemsToInsert.length > 0) {
                await db.insert(subscriptionItems).values(itemsToInsert);
                logger.info(
                    `Inserted ${itemsToInsert.length} subscription items for subscription ${subscription.id}.`
                );
            }
        }

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

        if (type === "tier1" || type === "tier2" || type === "tier3") {
            logger.debug(
                `Handling SAAS subscription lifecycle for org ${customer.orgId} with type ${type}`
            );
            // we only need to handle the limit lifecycle for saas subscriptions not for the licenses
            await handleSubscriptionLifesycle(
                customer.orgId,
                subscription.status,
                type
            );

            // Handle initial tier setup - disable features not available in this tier
            logger.info(
                `Setting up initial tier features for org ${customer.orgId} with type ${type}`
            );
            await handleTierChange(customer.orgId, type);

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

            // delete the trial subscrition if we have one
            await db
                .delete(subscriptions)
                .where(
                    and(
                        eq(
                            subscriptions.customerId,
                            subscription.customer as string
                        ),
                        eq(subscriptions.trial, true)
                    )
                );
        } else if (type === "license") {
            // Old in-app license subscriptions are no longer sold; existing
            // ones are kept up to date by handleSubscriptionUpdated/Deleted.
            logger.debug(
                `Legacy license subscription ${subscription.id} created for org ${customer.orgId}; nothing to do.`
            );
        }
    } catch (error) {
        logger.error(
            `Error handling subscription created event for ID ${subscription.id}:`,
            error
        );
    }
    return;
}
