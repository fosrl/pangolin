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
import { z } from "zod";
import createHttpError, { HttpError } from "http-errors";
import HttpCode from "@server/types/HttpCode";
import stripe from "#private/lib/stripe";
import { listOrgLicenses, OrgLicense } from "#private/lib/billing/licenseApi";
import {
    getLicenseCounts,
    isSelfHostedLicense,
    SELF_HOSTED_LIMITS,
    SELF_HOSTED_PRODUCTS
} from "#private/lib/billing/selfHostedLicense";
import {
    GeneratedLicenseKey,
    LicenseKeySubscription,
    LicenseQuantities
} from "@server/routers/generatedLicense/types";

export type LicenseCounts = { users: number; sites: number; machines: number };

export const licenseQuantitiesSchema = z.strictObject({
    users: z
        .number()
        .int()
        .min(SELF_HOSTED_LIMITS.users.min)
        .max(SELF_HOSTED_LIMITS.users.max),
    sites: z
        .number()
        .int()
        .min(SELF_HOSTED_LIMITS.sites.min)
        .max(SELF_HOSTED_LIMITS.sites.max),
    machineClients: z
        .number()
        .int()
        .min(SELF_HOSTED_LIMITS.machineClients.min)
        .max(SELF_HOSTED_LIMITS.machineClients.max)
});

export const licenseKeyParamsSchema = z.strictObject({
    orgId: z.string(),
    licenseKey: z.string()
});

function includedMachineClients(subscription: Stripe.Subscription): number {
    const included = Number(subscription.metadata.included_machine_clients);
    return Number.isFinite(included) && included > 0 ? included : 0;
}

/**
 * Whether the subscription is set to end. The dashboard sets
 * cancel_at_period_end; the Stripe customer portal (and Dashboard) set
 * cancel_at to a timestamp instead and leave cancel_at_period_end false.
 */
export function isSetToCancel(subscription: Stripe.Subscription): boolean {
    return subscription.cancel_at_period_end || subscription.cancel_at !== null;
}

export function periodEnd(subscription: Stripe.Subscription): number {
    return Math.max(
        ...subscription.items.data.map((item) => item.current_period_end)
    );
}

export function isEditable(subscription: Stripe.Subscription): boolean {
    return (
        isSelfHostedLicense(subscription.metadata) &&
        getLicenseCounts(subscription) !== null &&
        (subscription.status === "active" ||
            subscription.status === "trialing") &&
        !isSetToCancel(subscription)
    );
}

export function sameCounts(a: LicenseCounts, b: LicenseCounts): boolean {
    return (
        a.users === b.users && a.sites === b.sites && a.machines === b.machines
    );
}

/**
 * How a quantity change applies. The key's counts are what has been paid for
 * this period, so:
 * - reductions take effect at renewal: the subscription is lowered now
 *   without proration (no credit) and the key keeps its counts until the
 *   renewal invoice is paid;
 * - increases take effect now, charging only for what goes beyond the paid
 *   counts (so undoing a pending reduction costs nothing).
 */
export function planQuantityChange(
    licensed: LicenseCounts,
    target: LicenseCounts
) {
    return {
        // Subscription counts that need no payment: the target, capped at
        // what is already paid for. Applied with proration_behavior "none".
        unpaid: {
            users: Math.min(target.users, licensed.users),
            sites: Math.min(target.sites, licensed.sites),
            machines: Math.min(target.machines, licensed.machines)
        },
        // What the key allows from now until renewal
        allowed: {
            users: Math.max(target.users, licensed.users),
            sites: Math.max(target.sites, licensed.sites),
            machines: Math.max(target.machines, licensed.machines)
        },
        raises:
            target.users > licensed.users ||
            target.sites > licensed.sites ||
            target.machines > licensed.machines,
        reduces:
            target.users < licensed.users ||
            target.sites < licensed.sites ||
            target.machines < licensed.machines
    };
}

/**
 * Subscription counts whose prorated charge (from the subscription's current
 * counts) equals the charge for raising the key from `licensed` to `target`.
 * Proration is linear in quantity, so each raised line moves by the paid-for
 * difference, even when the subscription is currently below the key (a
 * pending reduction). Machine clients are only billed beyond the included
 * ones, so their difference is taken on the billed part.
 */
export function chargeEquivalentCounts(
    subscription: Stripe.Subscription,
    licensed: LicenseCounts,
    target: LicenseCounts
): LicenseCounts {
    const current = getLicenseCounts(subscription)!;
    const included = includedMachineClients(subscription);
    const billed = (machines: number) => Math.max(0, machines - included);

    const raise = (key: "users" | "sites") =>
        target[key] > licensed[key]
            ? current[key] + target[key] - licensed[key]
            : current[key];

    const billedRaise = billed(target.machines) - billed(licensed.machines);
    return {
        users: raise("users"),
        sites: raise("sites"),
        machines:
            billedRaise > 0
                ? included + billed(current.machines) + billedRaise
                : current.machines
    };
}

export function describeSubscription(
    subscription: Stripe.Subscription,
    licensed: LicenseCounts
): LicenseKeySubscription {
    const endsAt = subscription.cancel_at ?? periodEnd(subscription);
    const counts = getLicenseCounts(subscription);
    const renewsWith: LicenseQuantities | null =
        counts && !sameCounts(counts, licensed)
            ? {
                  users: counts.users,
                  sites: counts.sites,
                  machineClients: counts.machines
              }
            : null;
    return {
        status: subscription.status,
        cancelAtPeriodEnd: isSetToCancel(subscription),
        currentPeriodEnd: new Date(endsAt * 1000).toISOString(),
        editable: isEditable(subscription),
        includedMachineClients: includedMachineClients(subscription),
        renewsWith: isSetToCancel(subscription) ? null : renewsWith
    };
}

/**
 * The dashboard's view of an org's license: the API row without the Stripe ID
 * (resolved server side by license key), plus the subscription's state.
 */
export function toGeneratedLicenseKey(
    license: OrgLicense,
    subscription: Stripe.Subscription | null
): GeneratedLicenseKey {
    const { stripeSubscriptionId, ...rest } = license;
    return {
        ...rest,
        subscription: subscription
            ? describeSubscription(subscription, license)
            : null
    };
}

/**
 * Finds one of the org's paid license keys and its Stripe subscription.
 * Looking it up in the org's own list is what scopes the request to the org.
 */
export async function resolveLicenseSubscription(
    orgId: string,
    licenseKey: string
): Promise<
    | { license: OrgLicense; subscription: Stripe.Subscription }
    | { error: HttpError }
> {
    const result = await listOrgLicenses(orgId);
    if (!result.ok) {
        throw new Error(
            `Fossorial API returned ${result.status} listing licenses for org ${orgId}: ${result.body}`
        );
    }

    const license = result.data.licenseKeys.find(
        (key) => key.licenseKey === licenseKey
    );
    if (!license) {
        return {
            error: createHttpError(HttpCode.NOT_FOUND, "License key not found")
        };
    }
    if (!license.stripeSubscriptionId) {
        return {
            error: createHttpError(
                HttpCode.BAD_REQUEST,
                "This license key has no subscription"
            )
        };
    }

    const subscription = await stripe!.subscriptions.retrieve(
        license.stripeSubscriptionId
    );
    return { license, subscription };
}

/** Yearly price of the license at the given counts, at its existing prices. */
export function annualTotalCents(
    subscription: Stripe.Subscription,
    counts: { users: number; sites: number; machines: number }
): number {
    const extraMachines = Math.max(
        0,
        counts.machines - includedMachineClients(subscription)
    );
    let total = 0;
    let hasMachineItem = false;
    for (const item of subscription.items.data) {
        const product =
            typeof item.price.product === "string"
                ? item.price.product
                : item.price.product.id;
        const unit = item.price.unit_amount ?? 0;
        switch (product) {
            case SELF_HOSTED_PRODUCTS.users:
            case SELF_HOSTED_PRODUCTS.supportEmail:
            case SELF_HOSTED_PRODUCTS.supportPriority:
                total += unit * counts.users;
                break;
            case SELF_HOSTED_PRODUCTS.sites:
                total += unit * counts.sites;
                break;
            case SELF_HOSTED_PRODUCTS.machineClients:
                hasMachineItem = true;
                total += unit * extraMachines;
                break;
            default:
                total += unit * (item.quantity ?? 1);
        }
    }
    if (!hasMachineItem) {
        total += SELF_HOSTED_LIMITS.perMachineClientUsd * 100 * extraMachines;
    }
    return total;
}
