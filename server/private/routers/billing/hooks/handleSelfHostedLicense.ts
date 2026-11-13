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

/**
 * Webhook handling for self-hosted licenses bought through the website
 * checkout. These purchases have no local `customers` row; the license lives
 * in the Fossorial API keyed by the Stripe subscription ID.
 *
 * - checkout.session.completed / async_payment_succeeded: create the license,
 *   link it to the buyer's org, email the key, copy first/last name onto the
 *   Customer.
 * - invoice.paid: extend expiry to the new period end (renewals).
 * - customer.subscription.updated: sync quantities; revoke when it ends.
 * - customer.subscription.deleted: revoke.
 * - customer.updated (email changed): move the license to the new email,
 *   re-link the account, resend the key.
 */

import Stripe from "stripe";
import logger from "@server/logger";
import stripe from "#private/lib/stripe";
import {
    extendLicense,
    invalidateLicense,
    licensePaidFor,
    linkLicenseEmail
} from "#private/lib/billing/licenseApi";
import {
    findLicenseOrgForEmail,
    getExpiresAt,
    getLicenseCounts,
    isSelfHostedLicense,
    sendLicenseKeyEmail,
    licenseTierFor
} from "#private/lib/billing/selfHostedLicense";

export { isSelfHostedLicense };

function retrieveSubscription(
    subscriptionId: string
): Promise<Stripe.Subscription> {
    return stripe!.subscriptions.retrieve(subscriptionId);
}

function customFieldValue(
    session: Stripe.Checkout.Session,
    key: string
): string {
    return (
        session.custom_fields
            .find((field) => field.key === key)
            ?.text?.value?.trim() ?? ""
    );
}

/**
 * checkout.session.completed and checkout.session.async_payment_succeeded.
 * Creating the license is idempotent on the subscription ID, so a session
 * delivered under both events (or redelivered) gets one license and one email.
 */
export async function handleSelfHostedCheckoutCompleted(
    session: Stripe.Checkout.Session
): Promise<void> {
    try {
        if (!isSelfHostedLicense(session.metadata)) {
            logger.debug(
                `Checkout session ${session.id} is not a self-hosted license purchase; ignoring.`
            );
            return;
        }

        if (session.mode !== "subscription" || !session.subscription) {
            logger.error(
                `Self-hosted license checkout ${session.id} has no subscription.`
            );
            return;
        }

        // Delayed payment methods complete the session before the money
        // arrives; checkout.session.async_payment_succeeded follows.
        if (session.payment_status === "unpaid") {
            logger.info(
                `Self-hosted license checkout ${session.id} is awaiting payment; the license will be created when it succeeds.`
            );
            return;
        }

        const subscriptionId =
            typeof session.subscription === "string"
                ? session.subscription
                : session.subscription.id;
        const customerId =
            typeof session.customer === "string"
                ? session.customer
                : session.customer?.id;
        const email = session.customer_details?.email?.toLowerCase();

        if (!customerId || !email) {
            logger.error(
                `Self-hosted license checkout ${session.id} is missing the customer or email.`
            );
            return;
        }

        const subscription = await retrieveSubscription(subscriptionId);
        const counts = getLicenseCounts(subscription);
        if (!counts) {
            logger.error(
                `Self-hosted license subscription ${subscriptionId} is missing the users or sites item.`
            );
            return;
        }

        const firstName = customFieldValue(session, "first_name");
        const lastName = customFieldValue(session, "last_name");
        const company = session.customer_details?.business_name ?? "";

        // org_id is set when checkout was started from the dashboard; it is
        // only honored if the buyer's account owns that org.
        const orgId = await findLicenseOrgForEmail(
            email,
            session.metadata?.org_id
        );

        const result = await licensePaidFor({
            subscriptionId,
            customerId,
            email,
            orgId,
            tier: licenseTierFor(counts.highAvailability),
            users: counts.users,
            sites: counts.sites,
            machines: counts.machines,
            expiresAt: getExpiresAt(subscription),
            metadata: {
                checkoutSessionId: session.id,
                support: counts.support,
                highAvailability: String(counts.highAvailability),
                company,
                firstName,
                lastName
            }
        });

        if (!result.ok) {
            logger.error(
                `Fossorial API returned ${result.status} creating the license for subscription ${subscriptionId}: ${result.body}`
            );
            return;
        }

        const { license, created } = result.data;

        if (!created) {
            logger.info(
                `License ${license.id} already exists for subscription ${subscriptionId}; not sending the key again.`
            );
            return;
        }

        logger.info(
            `Created self-hosted license ${license.id} for subscription ${subscriptionId}${orgId ? ` linked to org ${orgId}` : " (not linked to an org yet)"}.`
        );

        await sendLicenseKeyEmail(email, license, orgId);

        // Stripe only keeps the first/last name on the Checkout Session, so
        // copy them to the Customer. Show the key on the subscription so
        // support can find it from the Stripe Dashboard.
        await Promise.all([
            stripe!.customers.update(customerId, {
                individual_name: `${firstName} ${lastName}`.trim() || undefined,
                metadata: { first_name: firstName, last_name: lastName }
            }),
            stripe!.subscriptions.update(subscriptionId, {
                description: `License ${license.licenseKey}`
            })
        ]);
    } catch (error) {
        logger.error(
            `Error handling self-hosted license checkout ${session.id}:`,
            error
        );
    }
}

/**
 * invoice.paid: a renewal (or a mid-term change) was paid, so extend the
 * license to the subscription's current period end. The first invoice is
 * handled by the checkout event.
 *
 * A renewal sets the key to exactly the subscription's quantities: this is
 * where reductions made during the last period take effect. Other invoices
 * (mid-period raises) only raise them.
 */
export async function handleSelfHostedInvoicePaid(
    invoice: Stripe.Invoice
): Promise<void> {
    try {
        const details = invoice.parent?.subscription_details;
        if (!details || !isSelfHostedLicense(details.metadata)) {
            return;
        }

        if (invoice.billing_reason === "subscription_create") {
            return;
        }

        const subscriptionId =
            typeof details.subscription === "string"
                ? details.subscription
                : details.subscription.id;

        const subscription = await retrieveSubscription(subscriptionId);
        const counts = getLicenseCounts(subscription);
        if (!counts) {
            return;
        }
        const expiresAt = getExpiresAt(subscription);

        const result = await extendLicense({
            subscriptionId,
            expiresAt,
            users: counts.users,
            sites: counts.sites,
            machines: counts.machines,
            tier: licenseTierFor(counts.highAvailability),
            support: counts.support,
            onlyIncrease: invoice.billing_reason !== "subscription_cycle"
        });

        if (!result.ok) {
            logger.error(
                `Fossorial API returned ${result.status} extending the license for subscription ${subscriptionId}: ${result.body}`
            );
            return;
        }

        logger.info(
            `Extended self-hosted license for subscription ${subscriptionId} to ${new Date(expiresAt * 1000).toISOString()} (invoice ${invoice.id}, ${invoice.billing_reason}).`
        );
    } catch (error) {
        logger.error(
            `Error handling paid invoice ${invoice.id} for a self-hosted license:`,
            error
        );
    }
}

/**
 * customer.subscription.updated (also paused/resumed): raise quantities that
 * went up (e.g. edited in the Stripe Dashboard) and revoke the key when the
 * subscription stops being paid for. Lower quantities are reductions paid
 * for until renewal; handleSelfHostedInvoicePaid applies them then. Expiry
 * only moves on invoice.paid, so a renewal that fails to pay does not extend
 * the key, and a key revoked for non-payment comes back when that invoice is
 * paid.
 *
 * Cancel-at-period-end needs nothing here: the key stays valid until its
 * expiry and customer.subscription.deleted revokes it when the period ends.
 */
export async function handleSelfHostedSubscriptionUpdated(
    eventSubscription: Stripe.Subscription
): Promise<void> {
    try {
        const subscription = await retrieveSubscription(eventSubscription.id);

        if (
            subscription.status === "canceled" ||
            subscription.status === "unpaid" ||
            subscription.status === "incomplete_expired" ||
            subscription.status === "paused"
        ) {
            return revoke(subscription.id);
        }

        const counts = getLicenseCounts(subscription);
        if (!counts) {
            return;
        }

        const result = await extendLicense({
            subscriptionId: subscription.id,
            users: counts.users,
            sites: counts.sites,
            machines: counts.machines,
            tier: licenseTierFor(counts.highAvailability),
            support: counts.support,
            onlyIncrease: true
        });

        if (!result.ok) {
            if (result.status === 404) {
                // Updates during checkout arrive before the license exists.
                logger.debug(
                    `No license yet for subscription ${subscription.id}; skipping update.`
                );
                return;
            }
            logger.error(
                `Fossorial API returned ${result.status} updating the license for subscription ${subscription.id}: ${result.body}`
            );
        }
    } catch (error) {
        logger.error(
            `Error handling self-hosted license subscription update ${eventSubscription.id}:`,
            error
        );
    }
}

/** customer.subscription.deleted: the subscription ended, revoke the key. */
export async function handleSelfHostedSubscriptionDeleted(
    subscription: Stripe.Subscription
): Promise<void> {
    try {
        await revoke(subscription.id);
    } catch (error) {
        logger.error(
            `Error handling self-hosted license subscription deletion ${subscription.id}:`,
            error
        );
    }
}

async function revoke(subscriptionId: string): Promise<void> {
    const result = await invalidateLicense({ subscriptionId });
    if (!result.ok) {
        if (result.status !== 404) {
            logger.error(
                `Fossorial API returned ${result.status} revoking the license for subscription ${subscriptionId}: ${result.body}`
            );
        }
        return;
    }
    logger.info(
        `Revoked self-hosted license for subscription ${subscriptionId}.`
    );
}
