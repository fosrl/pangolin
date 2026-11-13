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
    supportPriority: "pangolin_selfhosted_support_priority",
    highAvailability: "pangolin_selfhosted_addon_high_availability"
} as const;

// License tier stored on the key: tier2 when the license includes the high
// availability add-on, tier1 when it doesn't.
export function licenseTierFor(highAvailability: boolean): "tier1" | "tier2" {
    return highAvailability ? "tier2" : "tier1";
}

/** Whether a key's tier includes the high availability add-on. */
export function tierHasHighAvailability(tier: string): boolean {
    return tier === "tier2";
}

// Matches the in-app license flow: keys stay valid 5 days past the paid period.
const EXPIRY_GRACE_SECONDS = 5 * 24 * 60 * 60;

export const SUPPORT_TIERS = ["community", "email", "priority"] as const;

export type SupportTier = (typeof SUPPORT_TIERS)[number];

export type LicenseCounts = {
    users: number;
    sites: number;
    machines: number;
};

/** Everything a license can be changed to: counts plus add-ons and support. */
export type LicenseState = LicenseCounts & {
    support: SupportTier;
    highAvailability: boolean;
};

// Add-ons are priced as a percentage of the license's base price (users +
// sites + machine clients), never per unit. Must match the percentages in the
// website's checkout (landing-v5/lib/marketing/content/pricing.ts).
const HIGH_AVAILABILITY_PERCENT = 20;
// Monthly billing costs this much more than annual, in percent. Fixed when the
// license is bought: the interval is read from the subscription and never
// changed here. Also in the website's checkout.
const MONTHLY_PREMIUM_PERCENT = 10;
// Last digit of the whole-dollar prices an add-on is rounded up to: 9 for high
// availability (59, 69, ...), 5 for support (45, 55, ...).
const HIGH_AVAILABILITY_ENDING = 9;
const SUPPORT_ENDING = 5;
const SUPPORT_PERCENT: Record<SupportTier, number> = {
    community: 0,
    email: 15,
    priority: 25
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
): LicenseState | null {
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
        support,
        highAvailability: !!findItem(
            subscription,
            SELF_HOSTED_PRODUCTS.highAvailability
        )
    };
}

/** When the key should expire: the paid period's end plus grace. */
export function getExpiresAt(subscription: Stripe.Subscription): number {
    const periodEnd = Math.max(
        ...subscription.items.data.map((item) => item.current_period_end)
    );
    return periodEnd + EXPIRY_GRACE_SECONDS;
}

export type BillingInterval = "year" | "month";

/** How often the subscription bills. Set at purchase, never changed. */
export function billingInterval(
    subscription: Stripe.Subscription
): BillingInterval {
    const usersItem = findItem(subscription, SELF_HOSTED_PRODUCTS.users);
    return usersItem?.price.recurring?.interval === "month" ? "month" : "year";
}

/** A yearly price in cents as billed each period of this subscription. */
function toPeriodCents(
    subscription: Stripe.Subscription,
    yearlyCents: number
): number {
    return billingInterval(subscription) === "year"
        ? yearlyCents
        : Math.round((yearlyCents * (100 + MONTHLY_PREMIUM_PERCENT)) / 1200);
}

/** The yearly price in cents behind a per-period price. */
function toYearlyCents(
    subscription: Stripe.Subscription,
    periodCents: number
): number {
    return billingInterval(subscription) === "year"
        ? periodCents
        : Math.round((periodCents * 1200) / (100 + MONTHLY_PREMIUM_PERCENT));
}

function recurringPriceData(
    subscription: Stripe.Subscription,
    product: string,
    unitAmount: number,
    currency: string
): {
    currency: string;
    product: string;
    unit_amount: number;
    recurring: { interval: BillingInterval };
} {
    return {
        currency,
        product,
        unit_amount: unitAmount,
        recurring: { interval: billingInterval(subscription) }
    };
}

function unitCents(
    subscription: Stripe.Subscription,
    productId: string,
    fallback: number
): number {
    return findItem(subscription, productId)?.price.unit_amount ?? fallback;
}

/**
 * Price per billing period, in cents, of the users, sites and machine clients
 * at these counts, at the prices already on the subscription (existing lines
 * keep the price they were bought at).
 */
function basePeriodCents(
    subscription: Stripe.Subscription,
    counts: LicenseCounts
): number {
    const extraMachines = Math.max(
        0,
        counts.machines - includedMachineClients(subscription)
    );
    return (
        unitCents(subscription, SELF_HOSTED_PRODUCTS.users, 0) * counts.users +
        unitCents(subscription, SELF_HOSTED_PRODUCTS.sites, 0) * counts.sites +
        unitCents(
            subscription,
            SELF_HOSTED_PRODUCTS.machineClients,
            toPeriodCents(
                subscription,
                SELF_HOSTED_LIMITS.perMachineClientUsd * 100
            )
        ) *
            extraMachines
    );
}

/**
 * Rounds the amount `numerator / denominator` cents up to a whole-dollar price
 * ending in `ending` (e.g. 330 → 339 for 9s). With `bumpWhenExact`, an amount
 * that already is such a price goes up by $10 instead of staying. Integer
 * inputs keep this exact. Returns cents.
 */
function roundUpToEnding(
    numerator: number,
    denominator: number,
    ending: number,
    bumpWhenExact: boolean
): number {
    const centsPerDollar = denominator * 100;
    const dollars = Math.ceil(numerator / centsPerDollar);
    const exact = numerator % centsPerDollar === 0 && dollars % 10 === ending;
    const rounded = dollars + ((ending - (dollars % 10) + 10) % 10);
    return (rounded + (exact && bumpWhenExact ? 10 : 0)) * 100;
}

// Add-ons are a share of the yearly base price, rounded up to a price ending
// in `ending`. Monthly add-ons start from that yearly price, add the monthly
// premium over 12 months and are rounded again, so they aren't odd numbers; a
// monthly amount that already is such a price goes up by $10.
function addonPeriodCents(
    subscription: Stripe.Subscription,
    counts: LicenseCounts,
    percent: number,
    ending: number
): number {
    if (percent <= 0) {
        return 0;
    }
    const yearlyBase = toYearlyCents(
        subscription,
        basePeriodCents(subscription, counts)
    );
    if (yearlyBase <= 0) {
        return 0;
    }
    const yearly = roundUpToEnding(yearlyBase * percent, 100, ending, false);
    return billingInterval(subscription) === "year"
        ? yearly
        : roundUpToEnding(
              yearly * (100 + MONTHLY_PREMIUM_PERCENT),
              1200,
              ending,
              true
          );
}

/** Price per billing period, in cents, of the high availability add-on. */
export function highAvailabilityCents(
    subscription: Stripe.Subscription,
    counts: LicenseCounts
): number {
    return addonPeriodCents(
        subscription,
        counts,
        HIGH_AVAILABILITY_PERCENT,
        HIGH_AVAILABILITY_ENDING
    );
}

/** Price per billing period, in cents, of a support level. */
export function supportCents(
    subscription: Stripe.Subscription,
    support: SupportTier,
    counts: LicenseCounts
): number {
    return addonPeriodCents(
        subscription,
        counts,
        SUPPORT_PERCENT[support],
        SUPPORT_ENDING
    );
}

/** Price per billing period, in cents, of the whole license at this state. */
export function periodTotalCents(
    subscription: Stripe.Subscription,
    state: LicenseState
): number {
    return (
        basePeriodCents(subscription, state) +
        (state.highAvailability
            ? highAvailabilityCents(subscription, state)
            : 0) +
        supportCents(subscription, state.support, state)
    );
}

function supportProductFor(support: SupportTier): string | null {
    switch (support) {
        case "email":
            return SELF_HOSTED_PRODUCTS.supportEmail;
        case "priority":
            return SELF_HOSTED_PRODUCTS.supportPriority;
        default:
            return null;
    }
}

const SUPPORT_PRODUCTS = [
    SELF_HOSTED_PRODUCTS.supportEmail,
    SELF_HOSTED_PRODUCTS.supportPriority
];

/**
 * What a license at this state has already been charged for its add-ons, in
 * cents a year. A support line from before add-ons were flat (quantity =
 * users) is priced per user.
 */
export function paidAddonCents(
    subscription: Stripe.Subscription,
    licensed: LicenseState
): { highAvailability: number; support: number } {
    const perUserSupport = SUPPORT_PRODUCTS.map((product) =>
        findItem(subscription, product)
    ).find((item) => item && (item.quantity ?? 1) > 1);
    return {
        highAvailability: licensed.highAvailability
            ? highAvailabilityCents(subscription, licensed)
            : 0,
        support:
            licensed.support === "community"
                ? 0
                : perUserSupport
                  ? (perUserSupport.price.unit_amount ?? 0) * licensed.users
                  : supportCents(subscription, licensed.support, licensed)
    };
}

/** Yearly cents a flat add-on product currently bills (all its items). */
function currentAddonCents(
    subscription: Stripe.Subscription,
    products: string[]
): number {
    return subscription.items.data
        .filter((item) => products.includes(productIdOf(item)))
        .reduce(
            (sum, item) =>
                sum + (item.price.unit_amount ?? 0) * (item.quantity ?? 1),
            0
        );
}

/**
 * Item change that makes a flat add-on line (quantity 1) bill `cents` a year;
 * null when it already does. 0 removes the line. Add-ons are a single line
 * item with no quantity.
 */
function flatAddonItem(
    subscription: Stripe.Subscription,
    productId: string,
    cents: number
): Stripe.SubscriptionUpdateParams.Item | null {
    const existing = findItem(subscription, productId);
    if (cents <= 0) {
        return existing ? { id: existing.id, deleted: true } : null;
    }
    if (
        existing &&
        (existing.quantity ?? 1) === 1 &&
        existing.price.unit_amount === cents
    ) {
        return null;
    }
    const currency =
        findItem(subscription, SELF_HOSTED_PRODUCTS.users)?.price.currency ??
        "usd";
    const item = {
        quantity: 1,
        price_data: recurringPriceData(subscription, productId, cents, currency)
    };
    return existing ? { id: existing.id, ...item } : item;
}

function machineClientsItem(
    subscription: Stripe.Subscription,
    extra: number
): Stripe.SubscriptionUpdateParams.Item | null {
    const machineItem = findItem(
        subscription,
        SELF_HOSTED_PRODUCTS.machineClients
    );
    if (machineItem) {
        if (extra <= 0) {
            return { id: machineItem.id, deleted: true };
        }
        return machineItem.quantity === extra
            ? null
            : { id: machineItem.id, quantity: extra };
    }
    if (extra <= 0) {
        return null;
    }
    const usersItem = findItem(subscription, SELF_HOSTED_PRODUCTS.users)!;
    return {
        price_data: recurringPriceData(
            subscription,
            SELF_HOSTED_PRODUCTS.machineClients,
            toPeriodCents(
                subscription,
                SELF_HOSTED_LIMITS.perMachineClientUsd * 100
            ),
            usersItem.price.currency
        ),
        quantity: extra
    };
}

function nonNull<T>(items: (T | null)[]): T[] {
    return items.filter((item): item is T => item !== null);
}

/**
 * Subscription item changes (only the lines that change) that set a license
 * to this state. Users and sites are billed per unit. Machine clients are
 * billed only beyond the free allowance, so that line is added or removed as
 * the count crosses it. High availability and support are one line each with
 * no quantity, priced from the base price at this state, so they are repriced
 * whenever the counts change.
 */
export function buildStateItems(
    subscription: Stripe.Subscription,
    state: LicenseState
): Stripe.SubscriptionUpdateParams.Item[] {
    const usersItem = findItem(subscription, SELF_HOSTED_PRODUCTS.users)!;
    const sitesItem = findItem(subscription, SELF_HOSTED_PRODUCTS.sites)!;
    const wantedSupport = supportProductFor(state.support);

    return nonNull([
        usersItem.quantity === state.users
            ? null
            : { id: usersItem.id, quantity: state.users },
        sitesItem.quantity === state.sites
            ? null
            : { id: sitesItem.id, quantity: state.sites },
        machineClientsItem(
            subscription,
            Math.max(0, state.machines - includedMachineClients(subscription))
        ),
        flatAddonItem(
            subscription,
            SELF_HOSTED_PRODUCTS.highAvailability,
            state.highAvailability
                ? highAvailabilityCents(subscription, state)
                : 0
        ),
        ...SUPPORT_PRODUCTS.map((product) =>
            flatAddonItem(
                subscription,
                product,
                product === wantedSupport
                    ? supportCents(subscription, state.support, state)
                    : 0
            )
        )
    ]);
}

/**
 * Item changes that, applied to the subscription as it is now, produce the
 * same charge as raising a license from `licensed` to `allowed` (every value
 * in allowed is at least the one in licensed). The subscription can sit below
 * what was paid for (a reduction waiting for renewal), so charging the raise
 * on top of its current lines would over- or undercharge. Used for the
 * invoice preview; the real change goes through buildStateItems in steps.
 */
export function buildChargeEquivalentItems(
    subscription: Stripe.Subscription,
    licensed: LicenseState,
    allowed: LicenseState
): Stripe.SubscriptionUpdateParams.Item[] {
    const usersItem = findItem(subscription, SELF_HOSTED_PRODUCTS.users)!;
    const sitesItem = findItem(subscription, SELF_HOSTED_PRODUCTS.sites)!;
    const included = includedMachineClients(subscription);
    const billed = (machines: number) => Math.max(0, machines - included);
    const currentExtra =
        findItem(subscription, SELF_HOSTED_PRODUCTS.machineClients)?.quantity ??
        0;

    const paid = paidAddonCents(subscription, licensed);
    const addon = (
        products: string[],
        wantedProduct: string | null,
        paidCents: number,
        allowedCents: number
    ) => {
        const current = currentAddonCents(subscription, products);
        const target = Math.max(0, current + allowedCents - paidCents);
        if (target === current) {
            return null;
        }
        const existing = products.find((product) =>
            findItem(subscription, product)
        );
        const product = existing ?? wantedProduct;
        return product ? flatAddonItem(subscription, product, target) : null;
    };

    return nonNull([
        {
            id: usersItem.id,
            quantity: (usersItem.quantity ?? 0) + allowed.users - licensed.users
        },
        {
            id: sitesItem.id,
            quantity: (sitesItem.quantity ?? 0) + allowed.sites - licensed.sites
        },
        machineClientsItem(
            subscription,
            currentExtra +
                Math.max(
                    0,
                    billed(allowed.machines) - billed(licensed.machines)
                )
        ),
        addon(
            [SELF_HOSTED_PRODUCTS.highAvailability],
            SELF_HOSTED_PRODUCTS.highAvailability,
            paid.highAvailability,
            allowed.highAvailability
                ? highAvailabilityCents(subscription, allowed)
                : 0
        ),
        addon(
            SUPPORT_PRODUCTS,
            supportProductFor(allowed.support),
            paid.support,
            supportCents(subscription, allowed.support, allowed)
        )
    ]);
}

/** Metadata to keep in step with the items after a change. */
export function stateMetadata(
    subscription: Stripe.Subscription,
    state: LicenseState
): Record<string, string> {
    const included = includedMachineClients(subscription);
    return {
        users: String(state.users),
        sites: String(state.sites),
        machine_clients: String(state.machines),
        extra_machine_clients: String(Math.max(0, state.machines - included)),
        support: state.support,
        high_availability: String(state.highAvailability),
        billing_interval: billingInterval(subscription)
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
