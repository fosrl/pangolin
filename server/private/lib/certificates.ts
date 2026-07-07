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

import privateConfig from "./config";
import config from "@server/lib/config";
import { certificates, db } from "@server/db";
import { and, eq, isNotNull, or, inArray, sql } from "drizzle-orm";
import { decrypt } from "@server/lib/crypto";
import logger from "@server/logger";
import { regionalCache as cache } from "#private/lib/cache";
import { build } from "@server/build";

// Define the return type for clarity and type safety
export type CertificateResult = {
    id: number;
    domain: string;
    queriedDomain: string; // The domain that was originally requested (may differ for wildcards)
    wildcard: boolean | null;
    certFile: string | null;
    keyFile: string | null;
    expiresAt: number | null;
    updatedAt?: number | null;
};

export async function getValidCertificatesForDomains(
    domains: Set<string>,
    useCache: boolean = true
): Promise<Array<CertificateResult>> {
    const finalResults: CertificateResult[] = [];
    const domainsToQuery = new Set<string>();

    // 1. Check cache first if enabled
    if (useCache) {
        for (const domain of domains) {
            const cacheKey = `cert:${domain}`;
            const cachedCert = await cache.get<CertificateResult>(cacheKey);
            if (cachedCert) {
                finalResults.push(cachedCert); // Valid cache hit
            } else {
                // Also check for a wildcard cache entry covering this domain's parent
                const parts = domain.split(".");
                let wildcardHit = false;
                if (parts.length > 1) {
                    const parentDomain = parts.slice(1).join(".");
                    const wildcardCacheKey = `cert:*.${parentDomain}`;
                    const cachedWildcard =
                        await cache.get<CertificateResult>(wildcardCacheKey);
                    if (cachedWildcard) {
                        // Re-stamp queriedDomain so callers see the originally requested domain
                        finalResults.push({
                            ...cachedWildcard,
                            queriedDomain: domain
                        });
                        wildcardHit = true;
                    }
                }
                if (!wildcardHit) {
                    domainsToQuery.add(domain); // Cache miss or expired
                }
            }
        }
    } else {
        // If caching is disabled, add all domains to the query set
        domains.forEach((d) => domainsToQuery.add(d));
    }

    // 2. If all domains were resolved from the cache, return early
    if (domainsToQuery.size === 0) {
        const decryptedResults = decryptFinalResults(
            finalResults,
            config.getRawConfig().server.secret!
        );
        return decryptedResults;
    }

    // 3. Prepare domains for the database query
    const domainsToQueryArray = Array.from(domainsToQuery);
    const parentDomainsToQuery = new Set<string>();

    domainsToQueryArray.forEach((domain) => {
        const parts = domain.split(".");
        // A wildcard can only match a domain with at least two parts (e.g., example.com)
        if (parts.length > 1) {
            parentDomainsToQuery.add(parts.slice(1).join("."));
        }
    });

    const parentDomainsArray = Array.from(parentDomainsToQuery);

    // Build wildcard variants: for each parent domain "example.com", also query "*.example.com"
    const wildcardPrefixedArray =
        build != "saas" ? parentDomainsArray.map((d) => `*.${d}`) : [];

    // 4. Build and execute a single, efficient Drizzle query
    // This query fetches all potential exact and wildcard matches in one database round-trip.
    const potentialCerts = await db
        .select()
        .from(certificates)
        .where(
            and(
                eq(certificates.status, "valid"),
                isNotNull(certificates.certFile),
                isNotNull(certificates.keyFile),
                or(
                    // Condition for exact matches on the requested domains
                    inArray(certificates.domain, domainsToQueryArray),
                    // Condition for wildcard matches on the parent domains (stored as "example.com" or "*.example.com")
                    parentDomainsArray.length > 0
                        ? and(
                              inArray(certificates.domain, [
                                  ...parentDomainsArray,
                                  ...wildcardPrefixedArray
                              ]),
                              eq(certificates.wildcard, true)
                          )
                        : // If there are no possible parent domains, this condition is false
                          sql`false`
                )
            )
        );

    // Helper to normalize a wildcard cert's domain to its bare parent domain (strips leading "*.")
    const normalizeWildcardDomain = (domain: string): string =>
        domain.startsWith("*.") ? domain.slice(2) : domain;

    // 5. Process the database results, prioritizing exact matches over wildcards
    const exactMatches = new Map<string, (typeof potentialCerts)[0]>();
    const wildcardMatches = new Map<string, (typeof potentialCerts)[0]>();

    for (const cert of potentialCerts) {
        if (cert.wildcard) {
            // Normalize to bare parent domain so lookups are consistent regardless of storage format
            wildcardMatches.set(normalizeWildcardDomain(cert.domain), cert);
        } else {
            exactMatches.set(cert.domain, cert);
        }
    }

    for (const domain of domainsToQuery) {
        let foundCert: (typeof potentialCerts)[0] | undefined = undefined;

        // Priority 1: Check for an exact match (non-wildcard)
        if (exactMatches.has(domain)) {
            foundCert = exactMatches.get(domain);
        }
        // Priority 2: Check for a wildcard certificate whose normalized domain equals the queried domain
        else {
            const normalizedDomain = normalizeWildcardDomain(domain);
            if (wildcardMatches.has(normalizedDomain)) {
                foundCert = wildcardMatches.get(normalizedDomain);
            }
            // Priority 3: Check for a wildcard match on the parent domain
            else {
                const parts = normalizedDomain.split(".");
                if (parts.length > 1) {
                    const parentDomain = parts.slice(1).join(".");
                    if (wildcardMatches.has(parentDomain)) {
                        foundCert = wildcardMatches.get(parentDomain);
                    }
                }
            }
        }

        // If a certificate was found, format it, add to results, and cache it
        if (foundCert) {
            logger.debug(
                `Creating result cert for ${domain} using cert from ${foundCert.domain}`
            );
            const resultCert: CertificateResult = {
                id: foundCert.certId,
                domain: foundCert.domain, // The actual domain of the cert record
                queriedDomain: domain, // The domain that was originally requested
                wildcard: foundCert.wildcard,
                certFile: foundCert.certFile,
                keyFile: foundCert.keyFile,
                expiresAt: foundCert.expiresAt,
                updatedAt: foundCert.updatedAt
            };

            finalResults.push(resultCert);

            // Add to cache for future requests, using the *requested domain* as the key
            if (useCache) {
                const cacheKey = `cert:${domain}`;
                await cache.set(cacheKey, resultCert, 180);

                // Also cache wildcard certs under a pattern key so other subdomains
                // can find them without a DB round-trip
                if (resultCert.wildcard) {
                    const normalizedCertDomain = normalizeWildcardDomain(
                        resultCert.domain
                    );
                    const wildcardCacheKey = `cert:*.${normalizedCertDomain}`;
                    await cache.set(wildcardCacheKey, resultCert, 180);
                }
            }
        }
    }

    const decryptedResults = decryptFinalResults(
        finalResults,
        config.getRawConfig().server.secret!
    );
    return decryptedResults;
}

function decryptFinalResults(
    finalResults: CertificateResult[],
    secret: string
): CertificateResult[] {
    const validCertsDecrypted = finalResults.map((cert) => {
        // Decrypt and save certificate file
        const decryptedCert = decrypt(
            cert.certFile!, // is not null from query
            secret
        );

        // Decrypt and save key file
        const decryptedKey = decrypt(cert.keyFile!, secret);

        // Return only the certificate data without org information
        return {
            ...cert,
            certFile: decryptedCert,
            keyFile: decryptedKey
        };
    });

    return validCertsDecrypted;
}
