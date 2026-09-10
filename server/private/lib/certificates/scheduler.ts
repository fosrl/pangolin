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

import { withTimeout } from "@server/lib/retry";
import logger from "@server/logger";
import { certificateService } from "./certificate-service";
import { privateConfig as config } from "#private/lib/config";
import { dnsValidator } from "./dns-validator";
import { domainReverifier } from "./domain-reverifier";
import license from "#private/license/license";

// Backstop for runExclusive: no single job's own internal timeouts (e.g.
// certificate-service's per-cert issuance timeout) are relied on here. This
// is the last line of defense - if *anything* inside a job hangs with no
// error (a stalled Redis/DB call, a future code path that forgets to bound
// itself, etc.), state.active must still reset so the next tick can run.
// Without it, one hung run permanently skips every future tick for that job,
// since runExclusive only clears state.active after the job promise settles.
const RUN_EXCLUSIVE_TIMEOUT_MS = 30 * 60 * 1000;

export class JobScheduler {
    private certIntervals: NodeJS.Timeout[] = [];
    private dnsIntervals: NodeJS.Timeout[] = [];
    private certRunning = false;
    private dnsRunning = false;

    // Guards against a slow batch (e.g. 10 certs whose DNS challenges take a
    // while) still being processed when the next interval tick fires -
    // without this, overlapping ticks would each pull their own batch of up
    // to 10 pending/renewal certs and process them concurrently instead of
    // waiting for the prior batch to finish.
    private runExclusive(
        job: () => Promise<void>,
        state: { active: boolean },
        label: string
    ): () => Promise<void> {
        return async () => {
            if (!(await license.isUnlocked())) {
                logger.debug(
                    `Skipping ${label} tick - license is not subscribed`
                );
                return;
            }
            if (state.active) {
                logger.debug(
                    `Skipping ${label} tick - previous run still in progress`
                );
                return;
            }
            state.active = true;
            try {
                await withTimeout(job(), RUN_EXCLUSIVE_TIMEOUT_MS, label);
            } catch (error) {
                logger.error(`Error in ${label}:`, error);
            } finally {
                state.active = false;
            }
        };
    }

    // Certificate issuance/renewal - requires an ACME client, so this is
    // only started when Pangolin is actually managing certs.
    async start(): Promise<void> {
        if (this.certRunning) {
            logger.warn("Certificate job scheduler is already running");
            return;
        }

        this.certRunning = true;
        logger.info("Starting certificate job scheduler");

        const newCertState = { active: false };
        const renewalState = { active: false };

        const runNewCertCheck = this.runExclusive(
            () => certificateService.processPendingCertificates(),
            newCertState,
            "processing pending certificates"
        );
        const runRenewalCheck = this.runExclusive(
            () => certificateService.processRenewalCandidates(),
            renewalState,
            "processing renewal candidates"
        );

        // Schedule new certificate processing
        const newCertInterval = setInterval(
            runNewCertCheck,
            config.getRawConfig().acme!.new_cert_check_interval_ms
        );

        // Schedule renewal processing (every 24 hours)
        const renewalInterval = setInterval(
            runRenewalCheck,
            config.getRawConfig().acme!.renewal_check_interval_ms
        );

        this.certIntervals.push(newCertInterval, renewalInterval);

        // Run initial checks
        setTimeout(async () => {
            try {
                await runNewCertCheck();
                // await runRenewalCheck();
            } catch (error) {
                logger.error("Error in initial certificate processing:", error);
            }
        }, 1000); // Wait 1 second after startup

        logger.info("Certificate job scheduler started successfully");
    }

    // DNS record validation/reverification - doesn't touch certs at all, so
    // this runs independently whenever Pangolin is acting as the
    // authoritative DNS server, regardless of cert_mode.
    async startDnsJobs(): Promise<void> {
        if (this.dnsRunning) {
            logger.warn("DNS validation job scheduler is already running");
            return;
        }

        this.dnsRunning = true;
        logger.info("Starting DNS validation job scheduler");

        const dnsValidationState = { active: false };
        const reverifyState = { active: false };

        const runDnsValidation = this.runExclusive(
            () => dnsValidator.validateAll(),
            dnsValidationState,
            "validating DNS records"
        );
        const runReverify = this.runExclusive(
            () => domainReverifier.reverifyAll(),
            reverifyState,
            "reverifying domains"
        );

        // Schedule DNS validation
        const dnsValidationInterval = setInterval(
            runDnsValidation,
            config.getRawConfig().acme?.dns_check_interval_ms ?? 60000
        );

        // Schedule periodic reverification of already-verified domains
        const reverifyInterval = setInterval(
            runReverify,
            config.getRawConfig().acme?.domain_reverification_interval_ms ??
                3600000
        );

        this.dnsIntervals.push(dnsValidationInterval, reverifyInterval);

        // Run an initial validation pass shortly after startup
        setTimeout(async () => {
            try {
                await runDnsValidation();
            } catch (error) {
                logger.error("Error in initial DNS validation:", error);
            }
        }, 1000);

        logger.info("DNS validation job scheduler started successfully");
    }

    async stop(): Promise<void> {
        if (this.certRunning) {
            logger.info("Stopping certificate job scheduler");
            this.certRunning = false;
            this.certIntervals.forEach((interval) => clearInterval(interval));
            this.certIntervals = [];
        }

        if (this.dnsRunning) {
            logger.info("Stopping DNS validation job scheduler");
            this.dnsRunning = false;
            this.dnsIntervals.forEach((interval) => clearInterval(interval));
            this.dnsIntervals = [];
        }
    }

    isRunning(): boolean {
        return this.certRunning || this.dnsRunning;
    }
}

export const jobScheduler = new JobScheduler();
