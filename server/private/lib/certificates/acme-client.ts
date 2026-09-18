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

import * as acme from "acme-client";
import * as fs from "fs";
import { eq } from "drizzle-orm/sql";
import { privateConfig as config } from "#private/lib/config";
import { DnsChallenge, db, dnsChallenge } from "@server/db";
import { withRetry } from "@server/lib/retry";
import logger from "@server/logger";
import { acmeRateLimiter } from "./acmeRateLimiter";

// acme-client's own retry/backoff logging (429 retries, 5xx retries, each
// status-poll tick in waitForValidStatus) is a no-op by default - it only
// activates via DEBUG=acme-client or this call, neither of which was wired
// up. Without it, a cert silently retrying a Let's Encrypt rate limit for
// several minutes is indistinguishable in our logs from one that's actually
// hung, since our own logging only wraps the call, not what happens inside
// it. Must run before any AcmeClient method is called.
acme.setLogger((msg: string) => logger.info(`[acme-client] ${msg}`));

// acme-client's axios retry wrapper treats any response-less request error
// (timeout, connection reset, DNS blip reaching the ACME server) as
// retryable, but once its internal retries are exhausted it falls through to
// `validateStatus(response)` with `response` still undefined, throwing this
// uninformative TypeError instead of the real network error.
// https://github.com/publishlab/node-acme-client/blob/master/src/axios.js
function isUnresponsiveAcmeError(error: unknown): boolean {
    return (
        error instanceof TypeError &&
        error.message ===
            "Cannot read properties of undefined (reading 'config')"
    );
}

function normalizeAcmeError(error: unknown): Error {
    if (isUnresponsiveAcmeError(error)) {
        return new Error(
            "ACME server did not respond after repeated attempts (network error reaching the ACME endpoint)",
            { cause: error }
        );
    }
    return error instanceof Error ? error : new Error(String(error));
}

export class AcmeClientManager {
    private client: acme.Client | null = null;
    private accountKey: string | null = null;

    async initialize() {
        try {
            this.accountKey = await this.loadAccountKey();

            this.client = new acme.Client({
                directoryUrl: config.getRawConfig().acme!.acme_directory_url,
                accountKey: this.accountKey
            });

            // Try to create account or get existing one
            await this.client.createAccount({
                termsOfServiceAgreed: true,
                contact: [`mailto:${config.getRawConfig().acme!.contact_email}`]
            });

            logger.info("ACME client initialized successfully");
        } catch (error) {
            logger.error("Failed to initialize ACME client:", error);
            throw error;
        }
    }

    private async loadAccountKey(): Promise<string> {
        const keyPath = config.getRawConfig().acme!.acme_account_key_path;

        if (fs.existsSync(keyPath)) {
            logger.info("Loading existing account key");
            return fs.readFileSync(keyPath, "utf8");
        } else {
            logger.info("Generating new account key");
            const privateKey = await acme.crypto.createPrivateKey();
            const privateKeyString = privateKey.toString();
            fs.writeFileSync(keyPath, privateKeyString);
            return privateKeyString;
        }
    }

    getClient(): acme.Client {
        if (!this.client) {
            throw new Error("ACME client not initialized");
        }
        return this.client;
    }

    async createOrder(domain: string, wildcard: boolean = false): Promise<any> {
        const client = this.getClient();

        const identifiers = wildcard
            ? [
                  { type: "dns", value: domain },
                  { type: "dns", value: `*.${domain}` }
              ]
            : [{ type: "dns", value: domain }];

        await acmeRateLimiter.acquire();
        const order = await client.createOrder({
            identifiers
        });

        if (wildcard) {
            logger.info(`Created wildcard order for domain: ${domain}`);
        } else {
            logger.info(`Created order for domain: ${domain}`);
        }
        return order;
    }

    async getAuthorizations(order: any): Promise<any[]> {
        const client = this.getClient();
        await acmeRateLimiter.acquire();
        return client.getAuthorizations(order);
    }

    async handleDnsChallenge(
        dnsChallenges: {
            authz: any;
            challenge: any;
        }[]
    ): Promise<void> {
        const client = this.getClient();

        let challengeDomains: DnsChallenge[] = [];

        for (const { authz, challenge } of dnsChallenges) {
            const keyAuthorization =
                await client.getChallengeKeyAuthorization(challenge);

            // Extract the domain from authorization
            const domain = authz.identifier.value;

            // Store challenge in database for DNS server to pick up
            challengeDomains = await withRetry(
                () =>
                    db
                        .insert(dnsChallenge)
                        .values({
                            domain: domain,
                            token: challenge.token,
                            keyAuthorization,
                            createdAt: Math.floor(Date.now() / 1000),
                            expiresAt: Math.floor(
                                (Date.now() +
                                    config.getRawConfig().acme!
                                        .challenge_ttl_ms) /
                                    1000
                            )
                        })
                        .returning(),
                { label: `insert dnsChallenge for domain ${domain}` }
            );

            logger.info(
                `DNS challenge stored for domain: ${domain} as token ${challenge.token} and keyAuthorization`
            );
        }

        await new Promise((resolve) => setTimeout(resolve, 2000));

        const failedDomains: string[] = [];

        for (const { authz, challenge } of dnsChallenges) {
            const domain = authz.identifier.value;
            const challengeDomain = `_acme-challenge.${domain}`;

            try {
                // The ACME server occasionally has a transient network blip
                // mid-sequence; retry the whole verify/complete/wait sequence
                // rather than just the DNS challenge propagation wait, since
                // these calls are safe to repeat against the ACME server.
                await withRetry(
                    async () => {
                        // Verify challenge
                        await acmeRateLimiter.acquire();
                        await client.verifyChallenge(authz, challenge);

                        // Complete challenge
                        logger.info(
                            `Completing challenge for domain: ${challengeDomain}`
                        );
                        await acmeRateLimiter.acquire();
                        await client.completeChallenge(challenge);

                        // Wait for validation
                        logger.info(
                            `Waiting for challenge to be validated for domain: ${challengeDomain}...`
                        );
                        await acmeRateLimiter.acquire();
                        await client.waitForValidStatus(challenge);
                    },
                    {
                        retries: 2,
                        baseDelayMs: 5000,
                        label: `ACME challenge completion for domain ${domain}`,
                        // Only retry the known network-blip crash - a
                        // genuine validation failure (e.g. challenge marked
                        // "invalid" because the DNS record wasn't found) is
                        // permanent and should fail immediately instead of
                        // burning Let's Encrypt's per-hostname failed-
                        // validation rate limit on retries that can't help.
                        shouldRetry: isUnresponsiveAcmeError
                    }
                );

                logger.info(`Challenge completed for domain: ${domain}`);
            } catch (error) {
                logger.error(
                    `Failed to complete challenge for domain ${domain}:`,
                    normalizeAcmeError(error)
                );
                failedDomains.push(domain);
            }
        }

        for (const challengeDomain of challengeDomains) {
            await this.removeDnsChallenge(challengeDomain.dnsChallengeId);
            logger.info(
                `Removed DNS challenge for domain: ${challengeDomain.domain}`
            );
        }

        // A failed dns-01 challenge leaves the order stuck in "pending" -
        // finalizing it would just fail with a confusing ACME error, so
        // stop here and let the caller mark the certificate as failed.
        if (failedDomains.length > 0) {
            throw new Error(
                `DNS-01 challenge validation failed for domain(s): ${failedDomains.join(", ")}`
            );
        }
    }

    async removeDnsChallenge(dnsChallengeId: number): Promise<void> {
        try {
            await withRetry(
                () =>
                    db
                        .delete(dnsChallenge)
                        .where(eq(dnsChallenge.dnsChallengeId, dnsChallengeId)),
                { label: `delete dnsChallenge ${dnsChallengeId}` }
            );
        } catch (error) {
            logger.error(
                `Failed to clean up DNS challenge for id ${dnsChallengeId}:`,
                error
            );
        }
    }

    async finalizeCertificate(
        order: any,
        domain: string,
        wildcard: boolean = false
    ): Promise<{ certificate: string; privateKey: string }> {
        const client = this.getClient();

        const altNames = wildcard ? [`*.${domain}`, domain] : [domain];

        // Create CSR
        const [privateKey, csr] = await acme.crypto.createCsr({
            altNames
        });

        // Finalize order
        await acmeRateLimiter.acquire();
        const finalizedOrder = await client.finalizeOrder(order, csr);

        // Get certificate
        await acmeRateLimiter.acquire();
        const certificate = await client.getCertificate(finalizedOrder);

        logger.info(`Certificate obtained for domain: ${domain}`);

        return {
            certificate: certificate.toString(),
            privateKey: privateKey.toString()
        };
    }
}

export const acmeClientManager = new AcmeClientManager();
