/*
 * This file is part of a proprietary work.
 *
 * Copyright (c) 2025 Fossorial, Inc.
 * All rights reserved.
 *
 * This file is licensed under the Fossorial Commercial License.
 * You may not use this file except in compliance with the License.
 * Unauthorized use, copying, modification, or distribution is strictly prohibited.
 *
 * This file is not licensed under the AGPLv3.
 */

import config from "./config";
import { certificates, db } from "@server/db";
import { and, eq, isNotNull, or, inArray, sql } from "drizzle-orm";
import { decryptData } from "@server/lib/encryption";
import * as fs from "fs";
import logger from "@server/logger";
import cache from "@server/lib/cache";

let encryptionKeyPath = "";
let encryptionKeyHex = "";
let encryptionKey: Buffer;
function loadEncryptData() {
    if (encryptionKey) {
        return; // already loaded
    }

    encryptionKeyPath = config.getRawPrivateConfig().server.encryption_key_path;

    if (!fs.existsSync(encryptionKeyPath)) {
        throw new Error(
            "Encryption key file not found. Please generate one first."
        );
    }

    encryptionKeyHex = fs.readFileSync(encryptionKeyPath, "utf8").trim();
    encryptionKey = Buffer.from(encryptionKeyHex, "hex");
}

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

    loadEncryptData(); // Ensure encryption key is loaded

    const finalResults: CertificateResult[] = [];
    const domainsToQuery = new Set<string>();

    // 1. Check cache first if enabled
    if (useCache) {
        for (const domain of domains) {
            const cacheKey = `cert:${domain}`;
            const cachedCert = cache.get<CertificateResult>(cacheKey);
            if (cachedCert) {
                finalResults.push(cachedCert); // Valid cache hit
            } else {
                domainsToQuery.add(domain); // Cache miss or expired
            }
        }
    } else {
        // If caching is disabled, add all domains to the query set
        domains.forEach((d) => domainsToQuery.add(d));
    }

    // 2. If all domains were resolved from the cache, return early
    if (domainsToQuery.size === 0) {
        const decryptedResults = decryptFinalResults(finalResults);
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
                    // Condition for wildcard matches on the parent domains
                    parentDomainsArray.length > 0
                        ? and(
                              inArray(certificates.domain, parentDomainsArray),
                              eq(certificates.wildcard, true)
                          )
                        : // If there are no possible parent domains, this condition is false
                          sql`false`
                )
            )
        );

    // 5. Process the database results, prioritizing exact matches over wildcards
    const exactMatches = new Map<string, (typeof potentialCerts)[0]>();
    const wildcardMatches = new Map<string, (typeof potentialCerts)[0]>();

    for (const cert of potentialCerts) {
        if (cert.wildcard) {
            wildcardMatches.set(cert.domain, cert);
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
        // Priority 2: Check for a wildcard certificate that matches the exact domain
        else {
            if (wildcardMatches.has(domain)) {
                foundCert = wildcardMatches.get(domain);
            }
            // Priority 3: Check for a wildcard match on the parent domain
            else {
                const parts = domain.split(".");
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
                cache.set(cacheKey, resultCert, 180);
            }
        }
    }

    const decryptedResults = decryptFinalResults(finalResults);
    return decryptedResults;
}

function decryptFinalResults(
    finalResults: CertificateResult[]
): CertificateResult[] {
    const validCertsDecrypted = finalResults.map((cert) => {
        // Decrypt and save certificate file
        const decryptedCert = decryptData(
            cert.certFile!, // is not null from query
            encryptionKey
        );

        // Decrypt and save key file
        const decryptedKey = decryptData(cert.keyFile!, encryptionKey);

        // Return only the certificate data without org information
        return {
            ...cert,
            certFile: decryptedCert,
            keyFile: decryptedKey
        };
    });

    return validCertsDecrypted;
}
