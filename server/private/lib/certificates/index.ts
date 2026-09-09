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
import { acmeClientManager } from "./acme-client";
import { jobScheduler } from "./scheduler";

// Request a new certificate
// await certificateService.addCertificateRequest(domain);

logger.info("Starting certificate management server...");

// Initialize ACME client
await acmeClientManager.initialize();

// Start job scheduler
await jobScheduler.start();

// Graceful shutdown
process.on("SIGTERM", async () => {
    logger.info("Received SIGTERM, shutting down gracefully");
    await jobScheduler.stop();
    process.exit(0);
});

process.on("SIGINT", async () => {
    logger.info("Received SIGINT, shutting down gracefully");
    await jobScheduler.stop();
    process.exit(0);
});
