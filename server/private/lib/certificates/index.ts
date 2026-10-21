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
import { LeaderElection } from "#private/lib/leaderElection";

// Only one instance sharing this Redis talks to the ACME server at a time.
// Every instance runs the election; whichever holds the lease runs issuance
// and renewal, and another takes over if it goes away.
const acmeLeaderElection = new LeaderElection("acme-client", {
    onElected: async () => {
        logger.info("Starting certificate management server...");

        // Initialize ACME client
        await acmeClientManager.initialize();

        // Start certificate issuance/renewal jobs
        await jobScheduler.start();
    },
    onDemoted: () => jobScheduler.stopCertJobs()
});

export async function startCertificateManager() {
    const acmeConfig = privateConfig.getRawPrivateConfig().acme;
    if (
        acmeConfig &&
        acmeConfig.cert_mode === "pangolin" &&
        acmeConfig.enable_acme_client
    ) {
        acmeLeaderElection.start();
    }

    if (privateConfig.getRawPrivateConfig().flags.use_pangolin_dns) {
        // DNS record validation/reverification doesn't require certs, so it
        // runs whenever Pangolin is acting as the authoritative DNS server,
        // independent of the cert manager above.
        await jobScheduler.startDnsJobs();
    }
}

export async function stopCertificateManager() {
    await acmeLeaderElection.stop();
    await jobScheduler.stop();
}
