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

import { eq, and, or, isNull, lt } from "drizzle-orm";
import * as dns from "dns/promises";
import { DNS_VALIDATOR_MAX_TRIES } from "./dns-validator";
import { db, domains, DnsRecord, dnsRecords, Domain } from "@server/db";
import logger from "@server/logger";
import { lockManager } from "../lock";
import { privateConfig as config } from "#private/lib/config";

// Module-level counter so successive domains in a batch round-robin across servers.
let serverIndex = 0;

export class DomainReverifier {
    async reverifyAll(): Promise<void> {
        const certConfig = config.getRawConfig().acme;
        if (!certConfig) {
            logger.debug(
                "No certificate config — skipping domain reverification"
            );
            return;
        }

        const windowMs = certConfig.domain_reverification_window_ms;
        const batchSize = certConfig.domain_reverification_batch_size;
        const windowSecs = Math.floor(windowMs / 1000);
        const cutoff = Math.floor(Date.now() / 1000) - windowSecs;

        const domainsToCheck: Domain[] = await db
            .select()
            .from(domains)
            .where(
                and(
                    eq(domains.verified, true),
                    or(
                        isNull(domains.lastCheckedAt),
                        lt(domains.lastCheckedAt, cutoff)
                    )
                )
            )
            .limit(batchSize);

        if (domainsToCheck.length === 0) {
            logger.debug("No verified domains due for reverification");
            return;
        }

        logger.info(`Reverifying ${domainsToCheck.length} domains`);

        for (const domain of domainsToCheck) {
            const lockKey = `dns-reverify:${domain.baseDomain}`;
            const lockToken = await lockManager.acquireLock(lockKey);
            if (!lockToken) {
                logger.debug(
                    `Could not acquire lock for domain reverification: ${domain.baseDomain}`
                );
                continue;
            }

            try {
                await this.reverifyDomain(domain, certConfig.dns_resolvers);
            } catch (err) {
                logger.warn(
                    `Unexpected error reverifying domain ${domain.baseDomain}:`,
                    err
                );
                // Still stamp lastCheckedAt so we don't hammer a broken domain every run.
                await db
                    .update(domains)
                    .set({ lastCheckedAt: Math.floor(Date.now() / 1000) })
                    .where(eq(domains.domainId, domain.domainId));
            } finally {
                await lockManager.releaseLock(lockKey, lockToken);
            }
        }
    }

    private async reverifyDomain(
        domain: Domain,
        servers: string[]
    ): Promise<void> {
        if (!servers || servers.length === 0) {
            throw new Error("No DNS resolvers configured");
        }

        // Round-robin across servers; advance the global counter so the next
        // domain in the same batch gets a different server.
        const dnsServer = servers[serverIndex % servers.length]!;
        serverIndex++;

        const resolver = new dns.Resolver();
        resolver.setServers([dnsServer]);

        logger.debug(
            `Reverifying domain ${domain.baseDomain} using DNS server ${dnsServer}`
        );

        const records: DnsRecord[] = await db
            .select()
            .from(dnsRecords)
            .where(eq(dnsRecords.domainId, domain.domainId));

        if (records.length === 0) {
            logger.warn(
                `No DNS records found for domain ${domain.baseDomain} during reverification — marking failed`
            );
            await this.markFailed(
                domain.domainId,
                "No DNS records found during periodic reverification"
            );
            return;
        }

        const expectedNsValues = new Set<string>(
            records.filter((r) => r.recordType === "NS").map((r) => r.value)
        );

        let allValid = true;
        let errorMessage: string | null = null;
        let resolvedNs: string[] | null = null;

        for (const record of records) {
            let isValid = false;

            try {
                if (record.recordType === "NS") {
                    if (!resolvedNs) {
                        resolvedNs = await resolver.resolveNs(
                            record.baseDomain || domain.baseDomain
                        );
                    }
                    isValid = resolvedNs.some((ns) => ns === record.value);
                } else if (record.recordType === "CNAME") {
                    const cnameRecords = await resolver.resolveCname(
                        record.baseDomain || domain.baseDomain
                    );
                    isValid =
                        cnameRecords.length === 1 &&
                        cnameRecords[0] === record.value;
                } else if (record.recordType === "TXT") {
                    const txtRecords = await resolver.resolveTxt(
                        record.baseDomain || domain.baseDomain
                    );
                    isValid = txtRecords.flat().includes(record.value);
                } else if (record.recordType === "A") {
                    const aRecords = await resolver.resolve4(
                        record.baseDomain || domain.baseDomain
                    );
                    isValid = aRecords.includes(record.value);
                } else {
                    logger.warn(
                        `Unsupported record type ${record.recordType} during reverification of ${domain.baseDomain}`
                    );
                    continue;
                }
            } catch (err) {
                logger.debug(
                    `DNS lookup failed for ${record.recordType} record on ${record.baseDomain || domain.baseDomain}:`,
                    err
                );
                isValid = false;
            }

            if (!isValid) {
                allValid = false;
                errorMessage = `${record.recordType} record for ${record.baseDomain || domain.baseDomain} no longer resolves to expected value "${record.value}"`;
                break;
            }
        }

        // Check for extra NS records beyond what we expect.
        if (allValid && resolvedNs !== null && expectedNsValues.size > 0) {
            const extraNs = resolvedNs.filter(
                (ns) => !expectedNsValues.has(ns)
            );
            if (extraNs.length > 0) {
                allValid = false;
                errorMessage = `Extra NS records found: ${extraNs.join(", ")}. Remove these nameservers.`;
            }
        }

        const now = Math.floor(Date.now() / 1000);

        if (allValid) {
            await db
                .update(domains)
                .set({ lastCheckedAt: now, errorMessage: null })
                .where(eq(domains.domainId, domain.domainId));
            logger.debug(
                `Domain ${domain.baseDomain} passed periodic reverification`
            );
        } else {
            await this.markFailed(domain.domainId, errorMessage);
            logger.warn(
                `Domain ${domain.baseDomain} failed periodic reverification: ${errorMessage}`
            );
        }
    }

    private async markFailed(
        domainId: string,
        errorMessage: string | null
    ): Promise<void> {
        await db
            .update(domains)
            .set({
                verified: false,
                failed: true,
                // Three below MAX_TRIES: keeps the domain out of the DNS
                // validator's immediate retry loop, while still leaving it
                // eligible (tries < MAX_TRIES) for a few more validation
                // passes instead of being excluded forever once tries hits
                // MAX_TRIES.
                tries: DNS_VALIDATOR_MAX_TRIES - 3,
                lastCheckedAt: Math.floor(Date.now() / 1000),
                errorMessage
            })
            .where(eq(domains.domainId, domainId));
    }
}

export const domainReverifier = new DomainReverifier();
