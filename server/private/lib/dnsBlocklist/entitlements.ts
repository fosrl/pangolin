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

import { isLicensedOrSubscribed } from "#private/lib/isLicencedOrSubscribed";
import { tierMatrix, TierFeature } from "@server/lib/billing/tierMatrix";
import type { DnsBlockEntitlements } from "@server/lib/dnsBlocklist/entitlements";

export type { DnsBlockEntitlements };

export async function getDnsBlockEntitlements(
    orgId: string
): Promise<DnsBlockEntitlements> {
    const licensed = await isLicensedOrSubscribed(
        orgId,
        tierMatrix[TierFeature.DnsBlocking]
    );
    return {
        allCategories: licensed,
        customLists: licensed,
        blockLog: licensed
    };
}
