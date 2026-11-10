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
 * Self-hosted Business licenses: bought on the website (pangolin.net/pricing →
 * "Calculate price" → "Buy now"), managed from the dashboard's license page.
 * Checkout tags the Checkout Session and Subscription with
 * `metadata.type = "selfhosted_business_license"`. See
 * landing-v5/docs/stripe-checkout.md for the checkout side and metadata shape.
 */

import Stripe from "stripe";
import { and, asc, eq, sql } from "drizzle-orm";
import { db, orgs, userOrgs, users } from "@server/db";
import config from "@server/lib/config";
import { sendEmail } from "@server/emails";
import EnterpriseEditionKeyGenerated from "@server/emails/templates/EnterpriseEditionKeyGenerated";
import { SELF_HOSTED_LIMITS } from "@server/lib/billing/selfHostedLicenseLimits";

export { SELF_HOSTED_LIMITS };

export const SELF_HOSTED_LICENSE_TYPE = "selfhosted_business_license";

// Fixed product IDs created by the landing site's `npm run stripe:setup`
// (same in test and live mode).
export const SELF_HOSTED_PRODUCTS = {
    users: "pangolin_selfhosted_business_users",
    sites: "pangolin_selfhosted_business_sites",
    machineClients: "pangolin_selfhosted_business_machine_clients",
    supportEmail: "pangolin_selfhosted_support_email",
    supportPriority: "pangolin_selfhosted_support_priority"
} as const;

// License tier stored on the key. "enterprise" passes every license gate
// (hasTier checks and isUnlocked), which is what a paid Business license
// should get.
export const SELF_HOSTED_LICENSE_TIER = "enterprise";

// Matches the in-app license flow: keys stay valid 5 days past the paid period.
const EXPIRY_GRACE_SECONDS = 5 * 24 * 60 * 60;

export type SupportTier = "community" | "email" | "priority";

export type LicenseCounts = {
    users: number;
    sites: number;
    machines: number;
    support: SupportTier;
};

export function isSelfHostedLicense(
    metadata: Stripe.Metadata | null | undefined
): boolean {
    return metadata?.type === SELF_HOSTED_LICENSE_TYPE;
}

function productIdOf(item: Stripe.SubscriptionItem): string {
    const product = item.price.product;
    return typeof product === "string" ? product : product.id;
}

function findItem(
    subscription: Stripe.Subscription,
    productId: string
): Stripe.SubscriptionItem | undefined {
    return subscription.items.data.find(
        (item) => productIdOf(item) === productId
    );
}

/** Free machine clients the buyer got at purchase time. */
function includedMachineClients(subscription: Stripe.Subscription): number {
    const included = Number(subscription.metadata.included_machine_clients);
    return Number.isFinite(included) && included > 0 ? included : 0;
}

/**
 * Licensed counts, read from the subscription items rather than the metadata:
 * metadata is a snapshot from checkout and is not updated when someone edits
 * quantities in the Stripe Dashboard. Null when the users or sites item is
 * missing (not a self-hosted license subscription).
 */
export function getLicenseCounts(
    subscription: Stripe.Subscription
): LicenseCounts | null {
    const users = findItem(subscription, SELF_HOSTED_PRODUCTS.users)?.quantity;
    const sites = findItem(subscription, SELF_HOSTED_PRODUCTS.sites)?.quantity;
    if (!users || !sites) {
        return null;
    }

    // Only machine clients beyond the free allowance are billed.
    const extra =
        findItem(subscription, SELF_HOSTED_PRODUCTS.machineClients)?.quantity ??
        0;

    let support: SupportTier = "community";
    if (findItem(subscription, SELF_HOSTED_PRODUCTS.supportPriority)) {
        support = "priority";
    } else if (findItem(subscription, SELF_HOSTED_PRODUCTS.supportEmail)) {
        support = "email";
    }

    return {
        users,
        sites,
        machines: includedMachineClients(subscription) + extra,
        support
    };
}

/** When the key should expire: the paid period's end plus grace. */
export function getExpiresAt(subscription: Stripe.Subscription): number {
    const periodEnd = Math.max(
        ...subscription.items.data.map((item) => item.current_period_end)
    );
    return periodEnd + EXPIRY_GRACE_SECONDS;
}

/**
 * Subscription item changes that set a license to these counts. Support is
 * billed per user, so its line follows the user count. Machine clients are
 * billed only beyond the free allowance, so that line is added or removed as
 * the count crosses it.
 */
export function buildQuantityItems(
    subscription: Stripe.Subscription,
    counts: { users: number; sites: number; machines: number }
): Stripe.SubscriptionUpdateParams.Item[] {
    const usersItem = findItem(subscription, SELF_HOSTED_PRODUCTS.users)!;
    const sitesItem = findItem(subscription, SELF_HOSTED_PRODUCTS.sites)!;
    const items: Stripe.SubscriptionUpdateParams.Item[] = [
        { id: usersItem.id, quantity: counts.users },
        { id: sitesItem.id, quantity: counts.sites }
    ];

    for (const productId of [
        SELF_HOSTED_PRODUCTS.supportEmail,
        SELF_HOSTED_PRODUCTS.supportPriority
    ]) {
        const supportItem = findItem(subscription, productId);
        if (supportItem) {
            items.push({ id: supportItem.id, quantity: counts.users });
        }
    }

    const extra = Math.max(
        0,
        counts.machines - includedMachineClients(subscription)
    );
    const machineItem = findItem(
        subscription,
        SELF_HOSTED_PRODUCTS.machineClients
    );
    if (machineItem) {
        items.push(
            extra > 0
                ? { id: machineItem.id, quantity: extra }
                : { id: machineItem.id, deleted: true }
        );
    } else if (extra > 0) {
        items.push({
            price_data: {
                currency: usersItem.price.currency,
                product: SELF_HOSTED_PRODUCTS.machineClients,
                unit_amount: SELF_HOSTED_LIMITS.perMachineClientUsd * 100,
                recurring: { interval: "year" }
            },
            quantity: extra
        });
    }

    return items;
}

/** Metadata to keep in step with the items after a quantity change. */
export function quantityMetadata(
    subscription: Stripe.Subscription,
    counts: { users: number; sites: number; machines: number }
): Record<string, string> {
    const included = includedMachineClients(subscription);
    return {
        users: String(counts.users),
        sites: String(counts.sites),
        machine_clients: String(counts.machines),
        extra_machine_clients: String(Math.max(0, counts.machines - included))
    };
}

/**
 * The org to show a license in for the Pangolin account with this email.
 * Prefers `preferredOrgId` (the org the buyer started checkout from) when the
 * account owns it; otherwise the oldest org the account owns. Null when there
 * is no verified account or it owns no org yet; the license is then linked
 * when the account creates its first org (linkEmailOrg in createOrg).
 */
export async function findLicenseOrgForEmail(
    email: string,
    preferredOrgId?: string | null
): Promise<string | null> {
    const ownedOrgs = await db
        .select({ orgId: userOrgs.orgId })
        .from(users)
        .innerJoin(
            userOrgs,
            and(eq(userOrgs.userId, users.userId), eq(userOrgs.isOwner, true))
        )
        .innerJoin(orgs, eq(orgs.orgId, userOrgs.orgId))
        .where(
            and(
                sql`lower(${users.email}) = ${email.toLowerCase()}`,
                // Accounts are never marked verified when the server doesn't
                // require verification (same rule as linkEmailOrg on org
                // creation, which runs for any account that can create one)
                config.getRawConfig().flags?.require_email_verification
                    ? eq(users.emailVerified, true)
                    : undefined
            )
        )
        .orderBy(asc(orgs.createdAt));

    if (
        preferredOrgId &&
        ownedOrgs.some((row) => row.orgId === preferredOrgId)
    ) {
        return preferredOrgId;
    }
    return ownedOrgs[0]?.orgId ?? null;
}

export async function sendLicenseKeyEmail(
    to: string,
    license: {
        licenseKey: string;
        users: number;
        sites: number;
        machines: number;
    },
    orgId: string | null
): Promise<void> {
    const dashboardUrl = config.getRawConfig().app.dashboard_url;
    await sendEmail(
        EnterpriseEditionKeyGenerated({
            keyValue: license.licenseKey,
            personalUseOnly: false,
            users: license.users,
            sites: license.sites,
            machines: license.machines,
            modifySubscriptionLink: orgId
                ? `${dashboardUrl}/${orgId}/settings/license`
                : undefined,
            signUpLink: orgId
                ? undefined
                : `${dashboardUrl}/auth/login?internal_redirect=/settings/license&${new URLSearchParams({ email: to })}`
        }),
        {
            to,
            from: config.getNoReplyEmail(),
            subject: "Your Enterprise Edition license key is ready"
        }
    );
}
