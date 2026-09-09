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

import { acmeClientManager } from "./acme-client";
import { dnsValidator } from "./dns-validator";
import { getTableColumns } from "drizzle-orm";
import { eq, and, or, isNull, lt, asc } from "drizzle-orm/sql";
import { config } from "@server/lib/config";
import { db, certificates, domains, Certificate } from "@server/db";
import { encrypt } from "@server/lib/crypto";
import { withTimeout, withRetry } from "@server/lib/retry";
import logger from "@server/logger";
import { lockManager } from "../lock";
import { pushCertUpdateToAffectedNewts } from "@server/lib/acmeCertSync";
import crypto from "crypto";

// Number of on-demand DNS validation attempts made right before a
// certificate is (re)issued, to avoid burning Let's Encrypt rate limits on
// domains whose DNS has drifted since they were last verified.
const PRE_CERT_DNS_VALIDATION_ATTEMPTS = 3;

// Hard ceiling on a single certificate's issuance/renewal flow. acme-client's
// axios instance never sets a request timeout, so a stalled connection to
// the ACME server hangs forever instead of erroring - and since
// processPendingCertificates/processRenewalCandidates gate the *next* batch
// on Promise.all(...) over the current one, one hung certificate would
// otherwise stall every other domain permanently. Sized generously above the
// legitimate worst case (acme-client's own bounded backoff is ~3.6min per
// status-polling loop, and a wildcard cert's two identifiers plus order
// finalization can chain a few of those) so this only fires on a genuine hang.
const CERTIFICATE_ISSUANCE_TIMEOUT_MS = 20 * 60 * 1000;

// "requested" is set the instant a cert starts processing and is never
// queried anywhere else - processPendingCertificates only selects "pending"
// and processRenewalCandidates only selects "valid". So if the *process*
// dies mid-flight (OOM, node eviction, a rolling deploy) rather than just
// hanging, the row is orphaned in "requested" permanently with nothing to
// ever pick it back up, no matter how good the in-process timeouts are.
// Threshold is set comfortably above CERTIFICATE_ISSUANCE_TIMEOUT_MS plus the
// scheduler's own outer backstop so this never reclaims a cert that's still
// genuinely being worked on.
const STUCK_CERTIFICATE_THRESHOLD_MS = 40 * 60 * 1000;

export class CertificateService {
    // Runs at the top of every processPendingCertificates tick so an
    // interrupted worker's leftovers always get put back in the queue
    // instead of sitting invisible to every query forever.
    private async reclaimStuckCertificates(): Promise<void> {
        const staleBefore =
            Math.floor(Date.now() / 1000) -
            Math.floor(STUCK_CERTIFICATE_THRESHOLD_MS / 1000);

        const reclaimed = await db
            .update(certificates)
            .set({
                status: "pending",
                errorMessage:
                    'Reclaimed after being stuck in "requested" state - the worker processing it likely restarted or crashed',
                updatedAt: Math.floor(Date.now() / 1000)
            })
            .where(
                and(
                    eq(certificates.status, "requested"),
                    lt(certificates.updatedAt, staleBefore)
                )
            )
            .returning({ domain: certificates.domain });

        if (reclaimed.length > 0) {
            logger.warn(
                `Reclaimed ${reclaimed.length} certificate(s) stuck in "requested" state: ${reclaimed
                    .map((c) => c.domain)
                    .join(", ")}`
            );
        }
    }

    async processPendingCertificates(): Promise<void> {
        logger.debug("Checking for pending certificates...");

        await this.reclaimStuckCertificates();

        const pendingCerts = await db
            .select(getTableColumns(certificates))
            .from(certificates)
            .leftJoin(domains, eq(certificates.domainId, domains.domainId))
            .where(
                and(
                    eq(certificates.status, "pending"),
                    or(
                        // Certs with no linked domain row (e.g. legacy certs
                        // imported from acme.json) aren't gated on domain
                        // verification since there's nothing to check.
                        isNull(certificates.domainId),
                        and(
                            eq(domains.verified, true),
                            eq(domains.failed, false)
                        )
                    )
                )
            )
            .limit(10);

        if (pendingCerts.length === 0) {
            logger.debug("No pending certificates found");
            return;
        }

        logger.info(`Found ${pendingCerts.length} pending certificates`);

        // Process the batch concurrently so one domain stuck retrying a slow
        // DNS-01 challenge (the ACME client's waitForValidStatus can spend
        // minutes on a bad domain) doesn't stall the rest of the batch.
        // processSingleCertificate catches its own errors and each cert uses
        // an independent per-domain lock, so this is safe to parallelize.
        await Promise.all(
            pendingCerts.map((cert) => this.processSingleCertificate(cert))
        );
    }

    async processRenewalCandidates(): Promise<void> {
        logger.debug("Checking for certificates needing renewal...");

        const now = Math.floor(Date.now() / 1000);

        const renewalCandidates = await db
            .select(getTableColumns(certificates))
            .from(certificates)
            .leftJoin(domains, eq(certificates.domainId, domains.domainId))
            .where(
                and(
                    eq(certificates.status, "valid"),
                    lt(certificates.expiresAt, now + 15 * 24 * 60 * 60), // 15 days from now
                    or(
                        // Certs with no linked domain row (e.g. legacy certs
                        // imported from acme.json) aren't gated on domain
                        // verification since there's nothing to check.
                        isNull(certificates.domainId),
                        and(
                            eq(domains.verified, true),
                            eq(domains.failed, false)
                        )
                    )
                )
            )
            // Most urgent first, so already-expired certs aren't starved
            // behind the limit by certs that still have weeks of runway.
            .orderBy(asc(certificates.expiresAt))
            .limit(50);

        if (renewalCandidates.length === 0) {
            logger.debug("No certificates need renewal");
            return;
        }

        logger.info(
            `Found ${renewalCandidates.length} certificates needing renewal`
        );

        for (const cert of renewalCandidates) {
            if (cert.expiresAt !== null && cert.expiresAt < now) {
                logger.warn(
                    `Certificate for ${cert.domain} is marked "valid" but already expired at ${new Date(cert.expiresAt * 1000).toISOString()} (bad state) - renewing immediately`
                );
            }
        }

        // Process the batch concurrently - see processPendingCertificates for why.
        await Promise.all(
            renewalCandidates.map((cert) => this.renewCertificate(cert))
        );
    }

    private async processSingleCertificate(cert: Certificate): Promise<void> {
        const lockKey = `cert:${cert.domain}`;

        const lockToken = await lockManager.acquireLock(lockKey);
        if (!lockToken) {
            logger.debug(
                `Could not acquire lock for certificate: ${cert.domain}`
            );
            return;
        }

        try {
            logger.info(`Processing certificate for domain: ${cert.domain}`);

            // Update status to processing
            await db
                .update(certificates)
                .set({
                    status: "requested",
                    updatedAt: Math.floor(Date.now() / 1000)
                })
                .where(eq(certificates.certId, cert.certId));
            //

            await withTimeout(
                this.obtainCertificate(cert),
                CERTIFICATE_ISSUANCE_TIMEOUT_MS,
                `certificate issuance for ${cert.domain}`
            );
        } catch (error) {
            logger.error(
                `Failed to process certificate for ${cert.domain}:`,
                error
            );

            await db
                .update(certificates)
                .set({
                    status: "failed",
                    errorMessage:
                        error instanceof Error
                            ? error.message
                            : "Unknown error",
                    updatedAt: Math.floor(Date.now() / 1000)
                })
                .where(eq(certificates.certId, cert.certId));
        } finally {
            await lockManager.releaseLock(lockKey, lockToken);
        }
    }

    private async renewCertificate(cert: Certificate): Promise<void> {
        const lockKey = `cert:${cert.domain}`;

        const lockToken = await lockManager.acquireLock(lockKey);
        if (!lockToken) {
            logger.debug(
                `Could not acquire lock for certificate renewal: ${cert.domain}`
            );
            return;
        }

        try {
            logger.info(`Renewing certificate for domain: ${cert.domain}`);

            // Update last renewal attempt
            await db
                .update(certificates)
                .set({
                    lastRenewalAttempt: Math.floor(Date.now() / 1000),
                    updatedAt: Math.floor(Date.now() / 1000)
                })
                .where(eq(certificates.certId, cert.certId));

            await withTimeout(
                this.obtainCertificate(cert),
                CERTIFICATE_ISSUANCE_TIMEOUT_MS,
                `certificate renewal for ${cert.domain}`
            );
        } catch (error) {
            logger.error(
                `Failed to renew certificate for ${cert.domain}:`,
                error
            );

            await db
                .update(certificates)
                .set({
                    status: "failed",
                    errorMessage:
                        error instanceof Error
                            ? error.message
                            : "Unknown error",
                    lastRenewalAttempt: Math.floor(Date.now() / 1000),
                    updatedAt: Math.floor(Date.now() / 1000)
                })
                .where(eq(certificates.certId, cert.certId));
        } finally {
            await lockManager.releaseLock(lockKey, lockToken);
        }
    }

    // Re-checks the domain's DNS records right before we spend a Let's
    // Encrypt order on it, so drift that happened after the domain was
    // originally verified doesn't burn ACME rate limits. Certs with no
    // linked domain row (e.g. legacy/manually-managed certs) skip this and
    // proceed as before, since there are no tracked DNS records to check.
    private async verifyDomainBeforeIssuance(cert: Certificate): Promise<void> {
        if (!cert.domainId) {
            return;
        }

        const [domain] = await db
            .select()
            .from(domains)
            .where(eq(domains.domainId, cert.domainId))
            .limit(1);

        if (!domain) {
            return;
        }

        for (
            let attempt = 1;
            attempt <= PRE_CERT_DNS_VALIDATION_ATTEMPTS;
            attempt++
        ) {
            // Offset `tries` so each attempt round-robins to a different
            // privateConfigured DNS resolver instead of re-querying the same one.
            const probe = { ...domain, tries: domain.tries + attempt - 1 };
            if (
                await dnsValidator.validateDomain(probe, {
                    forceRecheck: true
                })
            ) {
                await db
                    .update(domains)
                    .set({ verified: true, failed: false, errorMessage: null })
                    .where(eq(domains.domainId, domain.domainId));
                return;
            }

            logger.warn(
                `Pre-certificate DNS check ${attempt}/${PRE_CERT_DNS_VALIDATION_ATTEMPTS} failed for domain ${domain.baseDomain} (cert: ${cert.domain})`
            );
        }

        const errorMessage = `Domain failed DNS validation ${PRE_CERT_DNS_VALIDATION_ATTEMPTS} times before certificate issuance`;
        await db
            .update(domains)
            .set({ verified: false, failed: true, errorMessage })
            .where(eq(domains.domainId, domain.domainId));

        throw new Error(errorMessage);
    }

    private async obtainCertificate(cert: Certificate): Promise<void> {
        await this.verifyDomainBeforeIssuance(cert);

        // Create order
        const order = await acmeClientManager.createOrder(
            cert.domain,
            cert.wildcard || false
        );

        // Update with order ID
        await withRetry(
            () =>
                db
                    .update(certificates)
                    .set({
                        orderId: order.url,
                        updatedAt: Math.floor(Date.now() / 1000)
                    })
                    .where(eq(certificates.certId, cert.certId)),
            { label: `update orderId for certificate ${cert.domain}` }
        );

        // Get authorizations
        const authorizations = await acmeClientManager.getAuthorizations(order);

        // Aggregate all DNS-01 challenges
        const dnsChallenges = authorizations.map((authz: any) => {
            const dnsChallenge = authz.challenges.find(
                (c: any) => c.type === "dns-01"
            );
            if (!dnsChallenge) {
                throw new Error(
                    `No DNS-01 challenge found for ${authz.identifier.value}`
                );
            }
            return {
                authz,
                challenge: dnsChallenge
            };
        });

        // Send all DNS-01 challenges in one request to handleDnsChallenge
        await acmeClientManager.handleDnsChallenge(dnsChallenges);

        // Finalize certificate
        const { certificate, privateKey } =
            await acmeClientManager.finalizeCertificate(
                order,
                cert.domain,
                cert.wildcard || false
            );

        const encryptionKey = config.getRawConfig().server.secret;
        if (!encryptionKey) {
            throw new Error("Encryption key not provided");
        }

        // Encrypt certificate and private key
        const encryptedCert = encrypt(certificate, encryptionKey);
        const encryptedKey = encrypt(privateKey, encryptionKey);

        // Parse certificate to get expiration date
        const expiresAt = this.extractExpirationDate(certificate);

        // Update database record. This persists the certificate we just
        // obtained from the ACME server, so it's retried aggressively -
        // losing this write means re-issuing the cert from scratch.
        await withRetry(
            () =>
                db
                    .update(certificates)
                    .set({
                        status: "valid",
                        expiresAt: Math.floor(expiresAt.getTime() / 1000),
                        renewalCount: (cert.renewalCount || 0) + 1,
                        errorMessage: null,
                        updatedAt: Math.floor(Date.now() / 1000),
                        certFile: encryptedCert,
                        keyFile: encryptedKey
                    })
                    .where(eq(certificates.certId, cert.certId)),
            {
                retries: 5,
                label: `persist issued certificate for ${cert.domain}`
            }
        );

        logger.info(
            `Certificate successfully obtained/renewed for domain: ${cert.domain}`
        );

        await pushCertUpdateToAffectedNewts(
            cert.domain,
            cert.domainId ?? null,
            certificate,
            privateKey
        );
    }

    private extractExpirationDate(certificate: string): Date {
        try {
            // Extract the certificate block
            const pem = certificate
                .replace(/-----BEGIN CERTIFICATE-----/g, "")
                .replace(/-----END CERTIFICATE-----/g, "")
                .replace(/\s+/g, "");
            const der = Buffer.from(pem, "base64");

            // Use Node.js crypto to parse the certificate
            const x509 = new crypto.X509Certificate(der);
            return new Date(x509.validTo);
        } catch (error) {
            logger.warn(
                "Failed to parse certificate expiration date, using default",
                error
            );
            // Default to 90 days from now (Let's Encrypt default)
            return new Date(Date.now() + 90 * 24 * 60 * 60 * 1000);
        }
    }

    async addCertificateRequest(domain: string): Promise<void> {
        try {
            await db.insert(certificates).values({
                domain,
                status: "pending",
                createdAt: Math.floor(Date.now() / 1000),
                updatedAt: Math.floor(Date.now() / 1000)
            });
            logger.info(`Certificate request added for domain: ${domain}`);
        } catch (error) {
            if (error instanceof Error && error.message.includes("unique")) {
                logger.warn(
                    `Certificate request already exists for domain: ${domain}`
                );
            } else {
                throw error;
            }
        }
    }

    async getCertificateStatus(domain: string) {
        const cert = await db
            .select()
            .from(certificates)
            .where(eq(certificates.domain, domain))
            .limit(1);

        return cert[0] || null;
    }

    async cleanupExpiredChallenges(): Promise<void> {
        try {
            const result = await db
                .delete(certificates)
                .where(
                    lt(certificates.expiresAt, Math.floor(Date.now() / 1000))
                )
                .returning();

            if (result.length > 0) {
                logger.info(
                    `Cleaned up ${result.length} expired DNS challenges`
                );
            }
        } catch (error) {
            logger.error("Failed to cleanup expired challenges:", error);
        }
    }
}

export const certificateService = new CertificateService();
