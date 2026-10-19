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

import { build } from "@server/build";
import privateConfig from "#private/lib/config";

export function createCname(domainId: string, baseDomain: string) {
    if (!privateConfig.getRawPrivateConfig().dns?.cname_extension) {
        throw new Error("CNAME extension not configured");
    }

    let cnameRecords = [
        {
            value: `${domainId}.${privateConfig.getRawPrivateConfig().dns?.cname_extension}`,
            baseDomain: baseDomain
        },
        {
            value: `_acme-challenge.${domainId}.${privateConfig.getRawPrivateConfig().dns?.cname_extension}`,
            baseDomain: `_acme-challenge.${baseDomain}`
        }
    ];

    return cnameRecords;
}

export function createNs() {
    if (!privateConfig.getRawPrivateConfig().dns?.nameserver_name) {
        throw new Error("Nameservers not configured");
    }

    const nsRecords = [
        privateConfig.getRawPrivateConfig().dns?.nameserver_name,
        ...(privateConfig.getRawPrivateConfig().dns?.alternate_nameservers ||
            [])
    ] as string[];
    return nsRecords;
}
