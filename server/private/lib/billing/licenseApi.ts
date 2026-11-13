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
 * Client for the Fossorial API's license-internal endpoints, where license
 * keys live. Paid keys are keyed by their Stripe subscription ID.
 */

import privateConfig from "#private/lib/config";
import type { SupportTier } from "#private/lib/billing/selfHostedLicense";

export type LicenseApiResult<T> =
    { ok: true; data: T } | { ok: false; status: number; body: string };

/** A license as returned by paid-for, extend and link-email-org. */
export type PaidLicense = {
    id: number;
    licenseKey: string;
    email: string | null;
    orgId: string | null;
    // tier2 includes the high availability add-on, tier1 doesn't
    tier: string;
    support: SupportTier;
    users: number;
    sites: number;
    machines: number;
    isValid: boolean;
    expiresAt: string;
};

/** A license as returned by list. */
export type OrgLicense = {
    instanceName: string | null;
    licenseKey: string;
    expiresAt: string;
    isValid: boolean;
    createdAt: string;
    tier: string;
    support: SupportTier;
    type: string;
    users: number;
    sites: number;
    machines: number;
    stripeSubscriptionId: string | null;
};

async function licenseApi<T>(
    method: "GET" | "POST",
    path: string,
    body?: unknown
): Promise<LicenseApiResult<T>> {
    const { fossorial_api, fossorial_api_key } =
        privateConfig.getRawPrivateConfig().server;
    const res = await fetch(
        `${fossorial_api}/api/v1/license-internal/enterprise/${path}`,
        {
            method,
            headers: {
                "api-key": fossorial_api_key!,
                "Content-Type": "application/json"
            },
            body: body === undefined ? undefined : JSON.stringify(body)
        }
    );

    const text = await res.text();
    if (!res.ok) {
        return { ok: false, status: res.status, body: text };
    }
    return { ok: true, data: JSON.parse(text).data as T };
}

/** Creates the key for a paid subscription; idempotent on subscriptionId. */
export function licensePaidFor(body: {
    subscriptionId: string;
    customerId: string;
    email: string;
    orgId: string | null;
    tier: string;
    users: number;
    sites: number;
    machines: number;
    expiresAt: number;
    metadata?: Record<string, string>;
}) {
    return licenseApi<{ license: PaidLicense; created: boolean }>(
        "POST",
        "paid-for",
        body
    );
}

/**
 * Renewals (expiresAt) and plan changes (quantities). licenseId is only for
 * old in-app subscriptions, which carry it in metadata.licenseKeyId.
 * onlyIncrease: a quantity, the tier or the support level is only changed if it
 * goes up (mid-period syncs,
 * where a lower subscription quantity is a reduction that applies at
 * renewal).
 */
export function extendLicense(body: {
    subscriptionId: string;
    licenseId?: number;
    expiresAt?: number;
    users?: number;
    sites?: number;
    machines?: number;
    // tier2 = high availability add-on, tier1 = without it
    tier?: "tier1" | "tier2";
    support?: SupportTier;
    // Only raise the counts, tier and support level (never lower them)
    onlyIncrease?: boolean;
}) {
    return licenseApi<{ license: PaidLicense }>("POST", "extend", body);
}

export function invalidateLicense(body: {
    subscriptionId: string;
    licenseId?: number;
}) {
    return licenseApi<null>("POST", "invalidate", body);
}

/**
 * Without subscriptionId: link every unlinked license bought with this email
 * to the org. With it: move that subscription's license to the email (and to
 * orgId when given).
 */
export function linkLicenseEmail(
    body:
        | { email: string; orgId: string }
        | { subscriptionId: string; email: string; orgId?: string }
) {
    return licenseApi<{ license: PaidLicense; changed: boolean } | null>(
        "POST",
        "link-email-org",
        body
    );
}

export function listOrgLicenses(orgId: string) {
    return licenseApi<{ licenseKeys: OrgLicense[] }>(
        "GET",
        `${encodeURIComponent(orgId)}/list`
    );
}

/** Legacy licenses pass this through subscription.metadata.licenseKeyId. */
export function legacyLicenseId(
    metadata: Record<string, string> | null | undefined
): number | undefined {
    const id = Number(metadata?.licenseKeyId);
    return Number.isInteger(id) && id > 0 ? id : undefined;
}
