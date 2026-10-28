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

// Standalone entry point that runs only the authoritative DNS server against
// an existing Pangolin database, without the API, dashboard or schedulers.
// Migrations are left to the main Pangolin server that owns the database.
import "@server/extendZod";

import logger from "@server/logger";
import { privateConfig } from "#private/lib/config";
import { rateLimitService } from "#private/lib/rateLimit";
import { startDnsServer, stopDnsServer } from "./dns";

async function start() {
    if (!privateConfig.getRawPrivateConfig().dns?.enabled) {
        throw new Error(
            "DNS server is not enabled - set dns.enabled: true in the private config"
        );
    }

    await startDnsServer({ requireLicense: false });

    let stopping = false;
    const shutdown = async () => {
        if (stopping) return;
        stopping = true;
        try {
            await stopDnsServer();
            await rateLimitService.cleanup();
        } catch (error) {
            logger.error("Error during DNS server shutdown:", error);
        }
        process.exit(0);
    };

    process.on("SIGTERM", shutdown);
    process.on("SIGINT", shutdown);
}

start().catch((error) => {
    logger.error("Failed to start DNS server:", error);
    process.exit(1);
});
