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

import logger from "@server/logger";
import { privateConfig } from "#private/lib/config";
import { acmeClientManager } from "./acme-client";
import { jobScheduler } from "./scheduler";

export async function startCertificateManager() {
    const acmeConfig = privateConfig.getRawPrivateConfig().acme;
    if (!acmeConfig || acmeConfig.cert_mode !== "pangolin") {
        return;
    }

    logger.info("Starting certificate management server...");

    // Initialize ACME client
    await acmeClientManager.initialize();

    // Start job scheduler
    await jobScheduler.start();
}

export async function stopCertificateManager() {
    await jobScheduler.stop();
}
