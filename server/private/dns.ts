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

import { AuthoritativeDNSServer } from "#private/lib/dns";
import { privateConfig } from "#private/lib/config";

let dnsServer: AuthoritativeDNSServer | undefined;

export async function startDnsServer() {
    const dnsConfig = privateConfig.getRawPrivateConfig().dns;
    if (!dnsConfig || !dnsConfig.enabled) {
        return;
    }

    dnsServer = new AuthoritativeDNSServer(dnsConfig.listen_port);

    await dnsServer.start();
}

export async function stopDnsServer() {
    if (!dnsServer) {
        return;
    }

    await dnsServer.stop();
    dnsServer = undefined;
}
