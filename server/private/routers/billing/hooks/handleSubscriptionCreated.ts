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
import privateConfig from "#private/lib/config";
import { getLicensePriceSet, LicenseId } from "@server/lib/billing/licenses";
import { sendEmail } from "@server/emails";
import EnterpriseEditionKeyGenerated from "@server/emails/templates/EnterpriseEditionKeyGenerated";
import config from "@server/lib/config";
import { getFeatureIdByPriceId } from "@server/lib/billing/features";
import { handleTierChange } from "../featureLifecycle";

export async function handleSubscriptionCreated(
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
            logger.debug(
                `License subscription created for org ${customer.orgId}, no lifecycle handling needed.`
            );

            // Retrieve the client_reference_id from the checkout session
            let licenseId: string | null = null;

            try {
                const sessions = await stripe!.checkout.sessions.list({
                    subscription: subscription.id,
                    limit: 1
                });
                if (sessions.data.length > 0) {
                    licenseId = sessions.data[0].client_reference_id || null;
                }

                if (!licenseId) {
                    logger.error(
                        `No client_reference_id found for subscription ${subscription.id}`
                    );
                    return;
                }

                logger.debug(
                    `Retrieved licenseId ${licenseId} from checkout session for subscription ${subscription.id}`
                );

                // Determine users and sites based on license type
                const priceSet = getLicensePriceSet();
                const subscriptionPriceId =
                    fullSubscription.items.data[0]?.price.id;

                let numUsers: number;
                let numSites: number;
                let tier = "enterprise";

                if (subscriptionPriceId === priceSet[LicenseId.TIER1]) {
                    numUsers = 25;
                    numSites = 25;
                    tier = "tier1";
                } else if (subscriptionPriceId === priceSet[LicenseId.TIER2]) {
                    numUsers = 50;
                    numSites = 100;
                    tier = "tier2";
                } else {
                    logger.error(
                        `Unknown price ID ${subscriptionPriceId} for subscription ${subscription.id}`
                    );
                    return;
                }

                logger.debug(
                    `License type determined: ${numUsers} users, ${numSites} sites for subscription ${subscription.id}`
                );

                // Grace period of 5 days added on top of the current billing
                // period end (usually ~1 year out) before the license expires
                const currentPeriodEnd =
                    fullSubscription.items.data[0]?.current_period_end;
                const expiresAt =
                    (currentPeriodEnd ?? subscription.created) +
                    5 * 24 * 60 * 60;

                const response = await fetch(
                    `${privateConfig.getRawPrivateConfig().server.fossorial_api}/api/v1/license-internal/enterprise/paid-for`,
                    {
                        method: "POST",
                        headers: {
                            "api-key":
                                privateConfig.getRawPrivateConfig().server
                                    .fossorial_api_key!,
                            "Content-Type": "application/json"
                        },
                        body: JSON.stringify({
                            licenseId: parseInt(licenseId),
                            paidFor: true,
                            users: numUsers,
                            sites: numSites,
                            tier: tier,
                            expiresAt: expiresAt
                        })
                    }
                );

                const data = await response.json();

                logger.debug(`Fossorial API response: ${JSON.stringify(data)}`);

                if (!response.ok || !data.success) {
                    logger.error(
                        `Fossorial API returned ${response.status} when setting paid-for for orgId ${customer.orgId} and subscription ID ${subscription.id}: ${JSON.stringify(data)}`
                    );
                    return;
                }

                if (customer.email) {
                    logger.debug(
                        `Sending license key email to ${customer.email} for subscription ${subscription.id}`
                    );
                    await sendEmail(
                        EnterpriseEditionKeyGenerated({
                            keyValue: data.data.licenseKey,
                            personalUseOnly: false,
                            users: numUsers,
                            sites: numSites,
                            modifySubscriptionLink: `${config.getRawConfig().app.dashboard_url}/${customer.orgId}/settings/billing`
                        }),
                        {
                            to: customer.email,
                            from: config.getNoReplyEmail(),
                            subject:
                                "Your Enterprise Edition license key is ready"
                        }
                    );
                } else {
                    logger.error(
                        `No email found for customer ${customer.customerId} to send license key.`
                    );
                }

                return data;
            } catch (error) {
                console.error("Error creating new license:", error);
                throw error;
            }
        }
    } catch (error) {
        logger.error(
            `Error handling subscription created event for ID ${subscription.id}:`,
            error
        );
    }
    return;
}
