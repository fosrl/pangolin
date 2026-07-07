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
import { z } from "zod";
import { customers, db, subscriptions, subscriptionItems } from "@server/db";
import { eq, and, or } from "drizzle-orm";
import response from "@server/lib/response";
import HttpCode from "@server/types/HttpCode";
import createHttpError from "http-errors";
import logger from "@server/logger";
import { fromError } from "zod-validation-error";
import stripe from "#private/lib/stripe";
import {
    getTier1FeaturePriceSet,
    getTier3FeaturePriceSet,
    getTier2FeaturePriceSet,
    LimitId,
    type FeaturePriceSet
} from "@server/lib/billing";
import { getLineItems } from "@server/lib/billing/getLineItems";

const changeTierSchema = z.strictObject({
    orgId: z.string()
});

const changeTierBodySchema = z.strictObject({
    tier: z.enum(["tier1", "tier2", "tier3"])
});

export async function changeTier(
    req: Request,
    res: Response,
    next: NextFunction
): Promise<any> {
    try {
        const parsedParams = changeTierSchema.safeParse(req.params);
        if (!parsedParams.success) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    fromError(parsedParams.error).toString()
                )
            );
        }

        const { orgId } = parsedParams.data;

        const parsedBody = changeTierBodySchema.safeParse(req.body);
        if (!parsedBody.success) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    fromError(parsedBody.error).toString()
                )
            );
        }

        const { tier } = parsedBody.data;

        // Get the customer for this org
        const [customer] = await db
            .select()
            .from(customers)
            .where(eq(customers.orgId, orgId))
            .limit(1);

        if (!customer) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    "No customer found for this organization"
                )
            );
        }

        // Get the active subscription for this customer
        const [subscription] = await db
            .select()
            .from(subscriptions)
            .where(
                and(
                    eq(subscriptions.customerId, customer.customerId),
                    eq(subscriptions.status, "active"),
                    or(
                        eq(subscriptions.type, "tier1"),
                        eq(subscriptions.type, "tier2"),
                        eq(subscriptions.type, "tier3")
                    )
                )
            )
            .limit(1);

        if (!subscription) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    "No active subscription found for this organization"
                )
            );
        }

        // Get the target tier's price set
        let targetPriceSet: FeaturePriceSet;
        if (tier === "tier1") {
            targetPriceSet = getTier1FeaturePriceSet();
        } else if (tier === "tier2") {
            targetPriceSet = getTier2FeaturePriceSet();
        } else if (tier === "tier3") {
            targetPriceSet = getTier3FeaturePriceSet();
        } else {
            return next(createHttpError(HttpCode.BAD_REQUEST, "Invalid tier"));
        }

        // Get current subscription items from our database
        const currentItems = await db
            .select()
            .from(subscriptionItems)
            .where(
                eq(
                    subscriptionItems.subscriptionId,
                    subscription.subscriptionId
                )
            );

        if (currentItems.length === 0) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    "No subscription items found"
                )
            );
        }

        // Retrieve the full subscription from Stripe to get item IDs
        const stripeSubscription = await stripe!.subscriptions.retrieve(
            subscription.subscriptionId
        );

        // Determine if we're switching between different products
        // tier1 uses TIER1 product, tier2/tier3 use USERS product
        const currentTier = subscription.type;
        const switchingProducts =
            (currentTier === "tier1" &&
                (tier === "tier2" || tier === "tier3")) ||
            ((currentTier === "tier2" || currentTier === "tier3") &&
                tier === "tier1");

        let updatedSubscription;

        if (switchingProducts) {
            // When switching between different products, we need to:
            // 1. Delete old subscription items
            // 2. Add new subscription items
            logger.info(
                `Switching products from ${currentTier} to ${tier} for subscription ${subscription.subscriptionId}`
            );

            // Build array to delete all existing items and add new ones
            const itemsToUpdate: any[] = [];

            // Mark all existing items for deletion
            for (const stripeItem of stripeSubscription.items.data) {
                itemsToUpdate.push({
                    id: stripeItem.id,
                    deleted: true
                });
            }

            // Add new items for the target tier
            const newLineItems = await getLineItems(targetPriceSet, orgId);
            for (const lineItem of newLineItems) {
                itemsToUpdate.push(lineItem);
            }

            updatedSubscription = await stripe!.subscriptions.update(
                subscription.subscriptionId,
                {
                    items: itemsToUpdate,
                    proration_behavior: "create_prorations"
                }
            );
        } else {
            // Same product, different price tier (tier2 <-> tier3)
            // We can simply update the price
            logger.info(
                `Updating price from ${currentTier} to ${tier} for subscription ${subscription.subscriptionId}`
            );

            const itemsToUpdate = stripeSubscription.items.data.map(
                (stripeItem) => {
                    // Find the corresponding item in our database
                    const dbItem = currentItems.find(
                        (item) => item.priceId === stripeItem.price.id
                    );

                    if (!dbItem) {
                        // Keep the existing item unchanged if we can't find it
                        return {
                            id: stripeItem.id,
                            price: stripeItem.price.id,
                            quantity: stripeItem.quantity
                        };
                    }

                    // Map to the corresponding feature in the new tier
                    const newPriceId = targetPriceSet[LimitId.USERS];

                    if (newPriceId) {
                        return {
                            id: stripeItem.id,
                            price: newPriceId,
                            quantity: stripeItem.quantity
                        };
                    }

                    // If no mapping found, keep existing
                    return {
                        id: stripeItem.id,
                        price: stripeItem.price.id,
                        quantity: stripeItem.quantity
                    };
                }
            );

            updatedSubscription = await stripe!.subscriptions.update(
                subscription.subscriptionId,
                {
                    items: itemsToUpdate,
                    proration_behavior: "create_prorations"
                }
            );
        }

        logger.info(
            `Successfully changed tier to ${tier} for org ${orgId}, subscription ${subscription.subscriptionId}`
        );

        return response<{ subscriptionId: string; newTier: string }>(res, {
            data: {
                subscriptionId: updatedSubscription.id,
                newTier: tier
            },
            success: true,
            error: false,
            message: "Tier change successful",
            status: HttpCode.OK
        });
    } catch (error) {
        logger.error("Error changing tier:", error);
        return next(
            createHttpError(
                HttpCode.INTERNAL_SERVER_ERROR,
                "An error occurred while changing tier"
            )
        );
    }
}
