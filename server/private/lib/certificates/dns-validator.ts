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

import { eq, and, lt } from "drizzle-orm";
import * as dns from "dns/promises";
import { privateConfig as config } from "#private/lib/config";
import { db, domains, DnsRecord, dnsRecords, Domain } from "@server/db";
import logger from "@server/logger";
import { lockManager } from "../lock";

export const DNS_VALIDATOR_MAX_TRIES = 300;

export class DNSValidator {
    private static readonly MAX_TRIES = DNS_VALIDATOR_MAX_TRIES;

    constructor() {}

    async validateAll(): Promise<void> {
        // Get all domains that are not yet verified and haven't exceeded max tries
        const unverifiedDomains: Domain[] = await db
            .select()
            .from(domains)
            .where(
                and(
                    eq(domains.verified, false),
                    lt(domains.tries, DNSValidator.MAX_TRIES)
                )
            );

        if (unverifiedDomains.length === 0) {
            logger.debug("No unverified domains found for DNS validation");
            return;
        }

        logger.info(`Validating ${unverifiedDomains.length} DNS records`);

        for (const domain of unverifiedDomains) {
            const lockKey = `dns:${domain.baseDomain}`;
            const lockToken = await lockManager.acquireLock(lockKey);
            if (!lockToken) {
                logger.debug(
                    `Could not acquire lock for DNS validation: ${domain.baseDomain}`
                );
                continue;
            }
            try {
                const isValid = await this.validateDomain(domain);
                if (isValid) {
                    await db
                        .update(domains)
                        .set({
                            verified: true,
                            failed: false,
                            tries: 0,
                            errorMessage: null
                        })
                        .where(eq(domains.domainId, domain.domainId));
                    logger.info(
                        `Domain ${domain.baseDomain} validated successfully`
                    );
                } else {
                    const newTries = domain.tries + 1;
                    const shouldMarkAsFailed =
                        newTries >= DNSValidator.MAX_TRIES;

                    await db
                        .update(domains)
                        .set({
                            tries: newTries,
                            failed: shouldMarkAsFailed
                        })
                        .where(eq(domains.domainId, domain.domainId));

                    if (shouldMarkAsFailed) {
                        logger.warn(
                            `Domain ${domain.baseDomain} exceeded maximum tries (${DNSValidator.MAX_TRIES}), marking as failed`
                        );
                    } else {
                        logger.debug(
                            `Domain ${domain.baseDomain} did not validate (attempt ${newTries}/${DNSValidator.MAX_TRIES})`
                        );
                    }
                }
            } catch (err) {
                logger.warn(
                    `Error validating domain ${domain.baseDomain}:`,
                    err
                );
                // Increment tries even on error
                const newTries = domain.tries + 1;
                const shouldMarkAsFailed = newTries >= DNSValidator.MAX_TRIES;

                await db
                    .update(domains)
                    .set({
                        tries: newTries,
                        failed: shouldMarkAsFailed
                    })
                    .where(eq(domains.domainId, domain.domainId));
            } finally {
                await lockManager.releaseLock(lockKey, lockToken);
            }
        }
    }

    async validateDomain(
        domain: Domain,
        opts: { forceRecheck?: boolean } = {}
    ): Promise<boolean> {
        const { forceRecheck = false } = opts;
        const resolver = new dns.Resolver();
        const servers = config.getRawConfig().acme?.dns_resolvers;
        if (!servers || servers.length === 0) {
            throw new Error("No DNS resolvers configured");
        }
        const dnsServer = servers[domain.tries % servers.length]!;
        resolver.setServers([dnsServer]);
        logger.debug(
            `Using DNS server ${dnsServer} for domain ${domain.baseDomain} (try ${domain.tries})`
        );

        // Get all DNS records for this domain
        const records: DnsRecord[] = await db
            .select()
            .from(dnsRecords)
            .where(eq(dnsRecords.domainId, domain.domainId));

        if (records.length === 0) {
            logger.warn(`No DNS records found for domain ${domain.baseDomain}`);
            return false;
        }

        if (!forceRecheck && records.every((r) => r.verified)) {
            logger.info(
                `All DNS records already verified for domain ${domain.baseDomain}`
            );
            return true;
        }

        logger.info(
            `Validating ${records.length} DNS records for domain ${domain.baseDomain}`
        );

        // Collect the full set of expected NS values for this domain so we can
        // detect extra records that are present in DNS but not in our DB.
        const expectedNsValues = new Set<string>(
            records.filter((r) => r.recordType === "NS").map((r) => r.value)
        );

        // Cache resolved NS records across iterations — there will be 3 NS
        // records in the DB and we don't need to hit the upstream server 3 times.
        let previousNs: string[] | null = null;

        for (const record of records) {
            // Skip already verified records, unless a live recheck was requested
            if (record.verified && !forceRecheck) {
                continue;
            }

            let isValid = false;

            try {
                if (record.recordType === "NS") {
                    let nsRecords: string[] | null = previousNs;
                    if (!nsRecords) {
                        nsRecords = await resolver.resolveNs(
                            record.baseDomain || domain.baseDomain
                        );
                    }
                    logger.info(
                        `NS records for ${
                            record.baseDomain || domain.baseDomain
                        }:`,
                        nsRecords
                    );

                    // Check if this expected NS value is present in the live records.
                    // A stale/legacy expected value (e.g. left over from a
                    // nameserver rebrand) is also accepted as long as the live
                    // records resolve to some other known-valid nameserver —
                    // the specific literal hostname stored per-domain isn't
                    // meaningful once it's a recognized alias.
                    isValid = nsRecords.some((ns) => ns === record.value);

                    previousNs = nsRecords;
                } else if (record.recordType === "CNAME") {
                    const cnameRecords = await resolver.resolveCname(
                        record.baseDomain || domain.baseDomain
                    );
                    logger.info(
                        `CNAME records for ${
                            record.baseDomain || domain.baseDomain
                        }:`,
                        cnameRecords
                    );

                    // Check if the CNAME record matches the expected value
                    isValid =
                        cnameRecords.length === 1 &&
                        cnameRecords[0] === record.value;
                } else if (record.recordType === "TXT") {
                    const txtRecords = await resolver.resolveTxt(
                        record.baseDomain || domain.baseDomain
                    );
                    logger.info(
                        `TXT records for ${
                            record.baseDomain || domain.baseDomain
                        }:`,
                        txtRecords
                    );

                    // TXT records come as an array of arrays, flatten and check
                    const flatTxtRecords = txtRecords.flat();
                    isValid = flatTxtRecords.includes(record.value);
                } else if (record.recordType === "A") {
                    const aRecords = await resolver.resolve4(
                        record.baseDomain || domain.baseDomain
                    );
                    logger.info(
                        `A records for ${
                            record.baseDomain || domain.baseDomain
                        }:`,
                        aRecords
                    );

                    // Check if the A record matches the expected value
                    isValid = aRecords.includes(record.value);
                } else {
                    logger.warn(
                        `Unsupported record type: ${record.recordType}`
                    );
                    continue;
                }
            } catch (error) {
                isValid = false;
                logger.debug(
                    `Did not resolve ${record.recordType} record for ${
                        record.baseDomain || domain.baseDomain
                    }:`,
                    error
                );
            }

            // Update the individual record verification status. Runs for
            // both a mismatched value and a failed/thrown DNS lookup, so a
            // previously-verified record that stops resolving (e.g. NXDOMAIN
            // after NS delegation is dropped) gets downgraded instead of
            // leaving stale `verified: true` state behind.
            if (isValid) {
                await db
                    .update(dnsRecords)
                    .set({ verified: true })
                    .where(eq(dnsRecords.id, record.id));
                logger.info(
                    `DNS record ${record.id} (${record.recordType}) for ${
                        record.baseDomain || domain.baseDomain
                    } verified successfully`
                );
            } else {
                if (record.verified) {
                    await db
                        .update(dnsRecords)
                        .set({ verified: false })
                        .where(eq(dnsRecords.id, record.id));
                }
                logger.debug(
                    `DNS record ${record.id} (${record.recordType}) for ${
                        record.baseDomain || domain.baseDomain
                    } does not match expected value: ${record.value}`
                );
            }
        }

        // --- Extra NS record check ---
        // If we resolved NS records during this pass, verify that the live DNS
        // has no nameservers beyond the ones we expect.  Individual records may
        // already be marked verified above, but we must block full domain
        // verification until the extra records are removed.
        if (previousNs !== null && expectedNsValues.size > 0) {
            const extraNsRecords = previousNs.filter(
                (ns) => !expectedNsValues.has(ns)
            );

            if (extraNsRecords.length > 0) {
                const errorMessage = `Extra NS records found that are not expected: ${extraNsRecords.join(", ")}. Remove these nameservers to complete domain verification.`;

                await db
                    .update(domains)
                    .set({ errorMessage })
                    .where(eq(domains.domainId, domain.domainId));

                logger.warn(
                    `Domain ${domain.baseDomain} has extra NS records that prevent verification: ${extraNsRecords.join(", ")}`
                );

                return false;
            }

            // No extras — clear any stale error that was previously written
            await db
                .update(domains)
                .set({ errorMessage: null })
                .where(eq(domains.domainId, domain.domainId));
        }

        // Check if all records are now verified
        const updatedRecords: DnsRecord[] = await db
            .select()
            .from(dnsRecords)
            .where(eq(dnsRecords.domainId, domain.domainId));

        const allRecordsVerified = updatedRecords.every((r) => r.verified);

        logger.info(
            `Domain ${domain.baseDomain}: ${
                updatedRecords.filter((r) => r.verified).length
            }/${updatedRecords.length} records verified`
        );

        return allRecordsVerified;
    }
}

export const dnsValidator = new DNSValidator();
