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
    LicenseState,
    SELF_HOSTED_LIMITS,
    SUPPORT_TIERS,
    tierHasHighAvailability
} from "#private/lib/billing/selfHostedLicense";
import {
    GeneratedLicenseKey,
    LicenseKeySubscription,
    LicenseQuantities
} from "@server/routers/generatedLicense/types";

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
        .max(SELF_HOSTED_LIMITS.machineClients.max),
    highAvailability: z.boolean(),
    support: z.enum(SUPPORT_TIERS)
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

/** Email and priority support need more than 25 users. */
export function supportNeedsMoreUsers(target: LicenseState): boolean {
    return (
        target.support !== "community" &&
        target.users <= SELF_HOSTED_LIMITS.supportAboveUsers
    );
}

export function sameState(a: LicenseState, b: LicenseState): boolean {
    return (
        a.users === b.users &&
        a.sites === b.sites &&
        a.machines === b.machines &&
        a.highAvailability === b.highAvailability &&
        a.support === b.support
    );
}

const SUPPORT_RANK = Object.fromEntries(
    SUPPORT_TIERS.map((tier, rank) => [tier, rank])
) as Record<(typeof SUPPORT_TIERS)[number], number>;

/**
 * What a change from the license as paid for (licensed) to a target does.
 * Raises (more users, sites or machine clients, high availability turned on,
 * a higher support level) apply now and are charged for the rest of the
 * period. Reductions apply at renewal.
 */
export function planChange(licensed: LicenseState, target: LicenseState) {
    const higherSupport =
        SUPPORT_RANK[target.support] > SUPPORT_RANK[licensed.support];
    return {
        // What the key allows from now until renewal: the higher of each
        allowed: {
            users: Math.max(target.users, licensed.users),
            sites: Math.max(target.sites, licensed.sites),
            machines: Math.max(target.machines, licensed.machines),
            highAvailability:
                target.highAvailability || licensed.highAvailability,
            support: higherSupport ? target.support : licensed.support
        } satisfies LicenseState,
        raises:
            target.users > licensed.users ||
            target.sites > licensed.sites ||
            target.machines > licensed.machines ||
            (target.highAvailability && !licensed.highAvailability) ||
            higherSupport,
        reduces:
            target.users < licensed.users ||
            target.sites < licensed.sites ||
            target.machines < licensed.machines ||
            (!target.highAvailability && licensed.highAvailability) ||
            SUPPORT_RANK[target.support] < SUPPORT_RANK[licensed.support]
    };
}

/** What the key as stored in the license API holds. */
export function licensedState(license: OrgLicense): LicenseState {
    return {
        users: license.users,
        sites: license.sites,
        machines: license.machines,
        highAvailability: tierHasHighAvailability(license.tier),
        support: license.support ?? "community"
    };
}

export function describeSubscription(
    subscription: Stripe.Subscription,
    licensed: LicenseState
): LicenseKeySubscription {
    const endsAt = subscription.cancel_at ?? periodEnd(subscription);
    const counts = getLicenseCounts(subscription);
    const renewsWith: LicenseQuantities | null =
        counts && !sameState(counts, licensed)
            ? {
                  users: counts.users,
                  sites: counts.sites,
                  machineClients: counts.machines,
                  highAvailability: counts.highAvailability,
                  support: counts.support
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
    const licensed = licensedState(license);
    return {
        ...rest,
        highAvailability: licensed.highAvailability,
        subscription: subscription
            ? describeSubscription(subscription, licensed)
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
