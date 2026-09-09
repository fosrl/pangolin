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

// Backstop for runExclusive: no single job's own internal timeouts (e.g.
// certificate-service's per-cert issuance timeout) are relied on here. This
// is the last line of defense - if *anything* inside a job hangs with no
// error (a stalled Redis/DB call, a future code path that forgets to bound
// itself, etc.), state.active must still reset so the next tick can run.
// Without it, one hung run permanently skips every future tick for that job,
// since runExclusive only clears state.active after the job promise settles.
const RUN_EXCLUSIVE_TIMEOUT_MS = 30 * 60 * 1000;

export class JobScheduler {
    private intervals: NodeJS.Timeout[] = [];
    private running = false;

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

    async start(): Promise<void> {
        if (this.running) {
            logger.warn("Scheduler is already running");
            return;
        }

        this.running = true;
        logger.info("Starting job scheduler");

        const newCertState = { active: false };
        const renewalState = { active: false };
        const dnsValidationState = { active: false };
        const reverifyState = { active: false };

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

        // Schedule DNS validation
        const dnsValidationInterval = setInterval(
            runDnsValidation,
            config.getRawConfig().acme?.dns_check_interval_ms
        );

        // Schedule periodic reverification of already-verified domains
        const reverifyInterval = setInterval(
            runReverify,
            config.getRawConfig().acme?.domain_reverification_interval_ms ??
                3600000
        );

        this.intervals.push(
            newCertInterval,
            renewalInterval,
            dnsValidationInterval,
            reverifyInterval
        );

        // Run initial checks
        setTimeout(async () => {
            try {
                await runNewCertCheck();
                // await runRenewalCheck();
                await runDnsValidation();
            } catch (error) {
                logger.error("Error in initial certificate processing:", error);
            }
        }, 1000); // Wait 5 seconds after startup

        logger.info("Job scheduler started successfully");
    }

    async stop(): Promise<void> {
        if (!this.running) {
            return;
        }

        logger.info("Stopping job scheduler");
        this.running = false;

        // Clear all intervals
        this.intervals.forEach((interval) => clearInterval(interval));
        this.intervals = [];

        logger.info("Job scheduler stopped");
    }

    isRunning(): boolean {
        return this.running;
    }
}

export const jobScheduler = new JobScheduler();
