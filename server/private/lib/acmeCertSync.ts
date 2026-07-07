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

import fs from "fs";
import path from "path";
import crypto from "crypto";
import {
    certificates,
    clients,
    clientSiteResourcesAssociationsCache,
    db,
    domains,
    newts,
    siteNetworks,
    SiteResource,
    siteResources
} from "@server/db";
import { and, eq } from "drizzle-orm";
import { encrypt, decrypt } from "@server/lib/crypto";
import logger from "@server/logger";
import privateConfig from "#private/lib/config";
import config from "@server/lib/config";
import {
    generateSubnetProxyTargetV2,
    SubnetProxyTargetV2
} from "@server/lib/ip";
import { updateTargets } from "@server/routers/client/targets";
import cache from "#private/lib/cache";
import { build } from "@server/build";

interface AcmeCert {
    domain: { main: string; sans?: string[] };
    certificate: string;
    key: string;
    Store: string;
}

interface AcmeJson {
    [resolver: string]: {
        Certificates: AcmeCert[];
    };
}

export async function pushCertUpdateToAffectedNewts(
    domain: string,
    domainId: string | null,
    oldCertPem: string | null,
    oldKeyPem: string | null
): Promise<void> {
    // Find all SSL-enabled HTTP site resources that use this cert's domain
    let affectedResources: SiteResource[] = [];

    if (domainId) {
        affectedResources = await db
            .select()
            .from(siteResources)
            .where(
                and(
                    eq(siteResources.domainId, domainId),
                    eq(siteResources.ssl, true)
                )
            );
    } else {
        // Fallback: match by exact fullDomain when no domainId is available
        affectedResources = await db
            .select()
            .from(siteResources)
            .where(
                and(
                    eq(siteResources.fullDomain, domain),
                    eq(siteResources.ssl, true)
                )
            );
    }

    if (affectedResources.length === 0) {
        logger.debug(
            `acmeCertSync: no affected site resources for cert domain "${domain}"`
        );
        return;
    }

    logger.debug(
        `acmeCertSync: pushing cert update to ${affectedResources.length} affected site resource(s) for domain "${domain}"`
    );

    for (const resource of affectedResources) {
        try {
            // Get all sites for this resource via siteNetworks
            const resourceSiteRows = resource.networkId
                ? await db
                      .select({ siteId: siteNetworks.siteId })
                      .from(siteNetworks)
                      .where(eq(siteNetworks.networkId, resource.networkId))
                : [];

            if (resourceSiteRows.length === 0) {
                logger.debug(
                    `acmeCertSync: no sites for resource ${resource.siteResourceId}, skipping`
                );
                continue;
            }

            // Get all clients with access to this resource
            const resourceClients = await db
                .select({
                    clientId: clients.clientId,
                    pubKey: clients.pubKey,
                    subnet: clients.subnet
                })
                .from(clients)
                .innerJoin(
                    clientSiteResourcesAssociationsCache,
                    eq(
                        clients.clientId,
                        clientSiteResourcesAssociationsCache.clientId
                    )
                )
                .where(
                    eq(
                        clientSiteResourcesAssociationsCache.siteResourceId,
                        resource.siteResourceId
                    )
                );

            if (resourceClients.length === 0) {
                logger.debug(
                    `acmeCertSync: no clients for resource ${resource.siteResourceId}, skipping`
                );
                continue;
            }

            // Invalidate the cert cache so generateSubnetProxyTargetV2 fetches fresh data
            if (resource.fullDomain) {
                await cache.del(`cert:${resource.fullDomain}`);
            }

            // Generate target once - same cert applies to all sites for this resource
            const newTargets = await generateSubnetProxyTargetV2(
                resource,
                resourceClients
            );

            if (!newTargets) {
                logger.debug(
                    `acmeCertSync: could not generate target for resource ${resource.siteResourceId}, skipping`
                );
                continue;
            }

            // Construct the old targets - same routing shape but with the previous cert/key.
            // The newt only uses destPrefix/sourcePrefixes for removal, but we keep the
            // semantics correct so the update message accurately reflects what changed.
            const oldTargets: SubnetProxyTargetV2[] = newTargets.map((t) => ({
                ...t,
                tlsCert: oldCertPem ?? undefined,
                tlsKey: oldKeyPem ?? undefined
            }));

            // Push update to each site's newt
            for (const { siteId } of resourceSiteRows) {
                const [newt] = await db
                    .select()
                    .from(newts)
                    .where(eq(newts.siteId, siteId))
                    .limit(1);

                if (!newt) {
                    logger.debug(
                        `acmeCertSync: no newt found for site ${siteId}, skipping resource ${resource.siteResourceId}`
                    );
                    continue;
                }

                await updateTargets(
                    newt.newtId,
                    { oldTargets: oldTargets, newTargets: newTargets },
                    newt.version
                );

                logger.debug(
                    `acmeCertSync: pushed cert update to newt for site ${siteId}, resource ${resource.siteResourceId}`
                );
            }
        } catch (err) {
            logger.error(
                `acmeCertSync: error pushing cert update for resource ${resource?.siteResourceId}: ${err}`
            );
        }
    }
}

async function findDomainId(certDomain: string): Promise<string | null> {
    // Strip wildcard prefix before lookup (*.example.com -> example.com)
    const lookupDomain = certDomain.startsWith("*.")
        ? certDomain.slice(2)
        : certDomain;

    // 1. Exact baseDomain match (any domain type)
    const exactMatch = await db
        .select({ domainId: domains.domainId })
        .from(domains)
        .where(eq(domains.baseDomain, lookupDomain))
        .limit(1);

    if (exactMatch.length > 0) {
        return exactMatch[0].domainId;
    }

    // 2. Walk up the domain hierarchy looking for a wildcard-type domain whose
    //    baseDomain is a suffix of the cert domain. e.g. cert "sub.example.com"
    //    matches a wildcard domain with baseDomain "example.com".
    const parts = lookupDomain.split(".");
    for (let i = 1; i < parts.length; i++) {
        const candidate = parts.slice(i).join(".");
        if (!candidate) continue;

        const wildcardMatch = await db
            .select({ domainId: domains.domainId })
            .from(domains)
            .where(
                and(
                    eq(domains.baseDomain, candidate),
                    eq(domains.type, "wildcard")
                )
            )
            .limit(1);

        if (wildcardMatch.length > 0) {
            return wildcardMatch[0].domainId;
        }
    }

    return null;
}

function extractFirstCert(pemBundle: string): string | null {
    const match = pemBundle.match(
        /-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/
    );
    return match ? match[0] : null;
}

/**
 * Determine whether an ACME cert entry represents a wildcard cert by checking
 * both the primary domain (`main`) and the SANs. Some ACME clients (notably
 * Traefik) store the bare apex in `main` and only put the wildcard form in
 * `sans` (e.g. main="access.example.com", sans=["*.access.example.com"]).
 */
function detectWildcard(
    main: string,
    sans: string[] | undefined
): { wildcard: boolean; wildcardSan: string | null } {
    if (main.startsWith("*.")) {
        return { wildcard: true, wildcardSan: null };
    }
    if (Array.isArray(sans)) {
        for (const san of sans) {
            if (typeof san !== "string") continue;
            if (san === `*.${main}` || san.startsWith("*.")) {
                return { wildcard: true, wildcardSan: san };
            }
        }
    }
    return { wildcard: false, wildcardSan: null };
}

interface HttpCert {
    wildcard: boolean;
    altName: string;
    certName: string;
    commonName: string;
    certFile: string;
    keyFile: string;
}

async function syncAcmeCertsFromHttp(endpoint: string): Promise<void> {
    let response: Response;
    try {
        response = await fetch(endpoint);
    } catch (err) {
        logger.debug(
            `acmeCertSync: could not reach HTTP endpoint ${endpoint}: ${err}`
        );
        return;
    }

    if (!response.ok) {
        logger.debug(
            `acmeCertSync: HTTP endpoint returned status ${response.status}`
        );
        return;
    }

    let httpCerts: HttpCert[];
    try {
        httpCerts = await response.json();
    } catch (err) {
        logger.debug(
            `acmeCertSync: could not parse JSON from HTTP endpoint: ${err}`
        );
        return;
    }

    if (!Array.isArray(httpCerts) || httpCerts.length === 0) {
        logger.debug(
            `acmeCertSync: no certificates returned from HTTP endpoint`
        );
        return;
    }

    for (const cert of httpCerts) {
        const domain = cert?.certName;

        if (!domain || typeof domain !== "string") {
            logger.debug(
                `acmeCertSync: skipping HTTP cert with missing certName`
            );
            continue;
        }

        const certPem = cert.certFile;
        const keyPem = cert.keyFile;

        if (!certPem?.trim() || !keyPem?.trim()) {
            logger.debug(
                `acmeCertSync: skipping HTTP cert for ${domain} - empty certFile or keyFile`
            );
            continue;
        }

        const firstCertPemForValidation = extractFirstCert(certPem);
        if (!firstCertPemForValidation) {
            logger.debug(
                `acmeCertSync: skipping HTTP cert for ${domain} - no PEM certificate block found`
            );
            continue;
        }

        let validatedX509: crypto.X509Certificate;
        try {
            validatedX509 = new crypto.X509Certificate(
                firstCertPemForValidation
            );
        } catch (err) {
            logger.debug(
                `acmeCertSync: skipping HTTP cert for ${domain} - invalid X.509 certificate: ${err}`
            );
            continue;
        }

        try {
            crypto.createPrivateKey(keyPem);
        } catch (err) {
            logger.debug(
                `acmeCertSync: skipping HTTP cert for ${domain} - invalid private key: ${err}`
            );
            continue;
        }

        const wildcard = cert.wildcard ?? false;

        const existing = await db
            .select()
            .from(certificates)
            .where(eq(certificates.domain, domain))
            .limit(1);

        let oldCertPem: string | null = null;
        let oldKeyPem: string | null = null;

        if (existing.length > 0 && existing[0].certFile) {
            try {
                const storedCertPem = decrypt(
                    existing[0].certFile,
                    config.getRawConfig().server.secret!
                );
                const wildcardUnchanged = existing[0].wildcard === wildcard;
                if (storedCertPem === certPem && wildcardUnchanged) {
                    continue;
                }
                oldCertPem = storedCertPem;
                if (existing[0].keyFile) {
                    try {
                        oldKeyPem = decrypt(
                            existing[0].keyFile,
                            config.getRawConfig().server.secret!
                        );
                    } catch (keyErr) {
                        logger.debug(
                            `acmeCertSync: could not decrypt stored key for ${domain}: ${keyErr}`
                        );
                    }
                }
            } catch (err) {
                logger.debug(
                    `acmeCertSync: could not decrypt stored cert for ${domain}, will update: ${err}`
                );
            }
        }

        let expiresAt: number | null = null;
        try {
            expiresAt = Math.floor(
                new Date(validatedX509.validTo).getTime() / 1000
            );
        } catch (err) {
            logger.debug(
                `acmeCertSync: could not parse cert expiry for ${domain}: ${err}`
            );
        }

        const encryptedCert = encrypt(
            certPem,
            config.getRawConfig().server.secret!
        );
        const encryptedKey = encrypt(
            keyPem,
            config.getRawConfig().server.secret!
        );
        const now = Math.floor(Date.now() / 1000);

        const domainId = await findDomainId(domain);
        if (domainId) {
            logger.debug(
                `acmeCertSync: resolved domainId "${domainId}" for HTTP cert domain "${domain}"`
            );
        } else {
            logger.debug(
                `acmeCertSync: no matching domain record found for HTTP cert domain "${domain}"`
            );
        }

        if (existing.length > 0) {
            logger.debug(
                `acmeCertSync: updating existing certificate (HTTP) for ${domain} (expires ${expiresAt ? new Date(expiresAt * 1000).toISOString() : "unknown"})`
            );
            await db
                .update(certificates)
                .set({
                    certFile: encryptedCert,
                    keyFile: encryptedKey,
                    status: "valid",
                    expiresAt,
                    updatedAt: now,
                    wildcard,
                    ...(domainId !== null && { domainId })
                })
                .where(eq(certificates.domain, domain));

            await pushCertUpdateToAffectedNewts(
                domain,
                domainId,
                oldCertPem,
                oldKeyPem
            );
        } else {
            logger.debug(
                `acmeCertSync: inserting new certificate (HTTP) for ${domain} (expires ${expiresAt ? new Date(expiresAt * 1000).toISOString() : "unknown"})`
            );
            await db.insert(certificates).values({
                domain,
                domainId,
                certFile: encryptedCert,
                keyFile: encryptedKey,
                status: "valid",
                expiresAt,
                createdAt: now,
                updatedAt: now,
                wildcard
            });

            await pushCertUpdateToAffectedNewts(domain, domainId, null, null);
        }
    }
}

async function storeCertForDomain(
    domain: string,
    certPem: string,
    keyPem: string,
    validatedX509: crypto.X509Certificate
): Promise<void> {
    const wildcard = domain.startsWith("*.");

    const existing = await db
        .select()
        .from(certificates)
        .where(eq(certificates.domain, domain))
        .limit(1);

    let oldCertPem: string | null = null;
    let oldKeyPem: string | null = null;

    if (existing.length > 0 && existing[0].certFile) {
        try {
            const storedCertPem = decrypt(
                existing[0].certFile,
                config.getRawConfig().server.secret!
            );
            const wildcardUnchanged = existing[0].wildcard === wildcard;
            if (storedCertPem === certPem && wildcardUnchanged) {
                return;
            }
            oldCertPem = storedCertPem;
            if (existing[0].keyFile) {
                try {
                    oldKeyPem = decrypt(
                        existing[0].keyFile,
                        config.getRawConfig().server.secret!
                    );
                } catch (keyErr) {
                    logger.debug(
                        `acmeCertSync: could not decrypt stored key for ${domain}: ${keyErr}`
                    );
                }
            }
        } catch (err) {
            logger.debug(
                `acmeCertSync: could not decrypt stored cert for ${domain}, will update: ${err}`
            );
        }
    }

    let expiresAt: number | null = null;
    try {
        expiresAt = Math.floor(
            new Date(validatedX509.validTo).getTime() / 1000
        );
    } catch (err) {
        logger.debug(
            `acmeCertSync: could not parse cert expiry for ${domain}: ${err}`
        );
    }

    const encryptedCert = encrypt(
        certPem,
        config.getRawConfig().server.secret!
    );
    const encryptedKey = encrypt(keyPem, config.getRawConfig().server.secret!);
    const now = Math.floor(Date.now() / 1000);

    const domainId = await findDomainId(domain);
    if (domainId) {
        logger.debug(
            `acmeCertSync: resolved domainId "${domainId}" for cert domain "${domain}"`
        );
    } else {
        logger.debug(
            `acmeCertSync: no matching domain record found for cert domain "${domain}"`
        );
    }

    if (existing.length > 0) {
        logger.debug(
            `acmeCertSync: updating existing certificate for ${domain} (expires ${expiresAt ? new Date(expiresAt * 1000).toISOString() : "unknown"})`
        );
        await db
            .update(certificates)
            .set({
                certFile: encryptedCert,
                keyFile: encryptedKey,
                status: "valid",
                expiresAt,
                updatedAt: now,
                wildcard,
                ...(domainId !== null && { domainId })
            })
            .where(eq(certificates.domain, domain));

        logger.debug(
            `acmeCertSync: updated certificate for ${domain} (expires ${expiresAt ? new Date(expiresAt * 1000).toISOString() : "unknown"})`
        );

        await pushCertUpdateToAffectedNewts(
            domain,
            domainId,
            oldCertPem,
            oldKeyPem
        );
    } else {
        logger.debug(
            `acmeCertSync: inserting new certificate for ${domain} (expires ${expiresAt ? new Date(expiresAt * 1000).toISOString() : "unknown"})`
        );
        await db.insert(certificates).values({
            domain,
            domainId,
            certFile: encryptedCert,
            keyFile: encryptedKey,
            status: "valid",
            expiresAt,
            createdAt: now,
            updatedAt: now,
            wildcard
        });

        logger.debug(
            `acmeCertSync: inserted new certificate for ${domain} (expires ${expiresAt ? new Date(expiresAt * 1000).toISOString() : "unknown"})`
        );

        await pushCertUpdateToAffectedNewts(domain, domainId, null, null);
    }
}

function findAcmeJsonFiles(dirPath: string): string[] {
    const results: string[] = [];
    let entries: fs.Dirent[];
    try {
        entries = fs.readdirSync(dirPath, { withFileTypes: true });
    } catch (err) {
        logger.warn(
            `acmeCertSync: could not read directory "${dirPath}": ${err}`
        );
        return results;
    }
    for (const entry of entries) {
        const fullPath = path.join(dirPath, entry.name);
        if (entry.isDirectory()) {
            results.push(...findAcmeJsonFiles(fullPath));
        } else if (entry.isFile()) {
            // check if it is a json file
            if (entry.name.endsWith(".json")) {
                let raw: string;
                try {
                    raw = fs.readFileSync(fullPath, "utf8");
                } catch (err) {
                    logger.warn(
                        `acmeCertSync: could not read file "${fullPath}": ${err}`
                    );
                    continue;
                }

                let parsed: any;
                try {
                    parsed = JSON.parse(raw);
                } catch (err) {
                    logger.warn(
                        `acmeCertSync: could not parse "${fullPath}" as JSON: ${err}`
                    );
                    continue;
                }
            }

            results.push(fullPath);
        }
    }
    return results;
}

async function syncAcmeCerts(acmeJsonPath: string): Promise<void> {
    let raw: string;
    try {
        raw = fs.readFileSync(acmeJsonPath, "utf8");
    } catch (err) {
        logger.warn(`acmeCertSync: could not read "${acmeJsonPath}": ${err}`);
        return;
    }

    let acmeJson: AcmeJson;
    try {
        acmeJson = JSON.parse(raw);
    } catch (err) {
        logger.warn(
            `acmeCertSync: could not parse "${acmeJsonPath}" as JSON: ${err}`
        );
        return;
    }

    const resolvers = Object.keys(acmeJson || {});
    if (resolvers.length === 0) {
        logger.debug(`acmeCertSync: no resolvers found in acme.json`);
        return;
    }

    // Collect certificates from every resolver. If the same domain appears in
    // multiple resolvers, the last one wins (resolvers iterated in object order).
    const allCerts: AcmeCert[] = [];
    for (const resolver of resolvers) {
        const resolverData = acmeJson[resolver];
        if (!resolverData || !Array.isArray(resolverData.Certificates)) {
            logger.debug(
                `acmeCertSync: no certificates found for resolver "${resolver}"`
            );
            continue;
        }
        // logger.debug(
        //     `acmeCertSync: found ${resolverData.Certificates.length} certificate(s) for resolver "${resolver}"`
        // );
        for (const cert of resolverData.Certificates) {
            allCerts.push(cert);
        }
    }

    for (const cert of allCerts) {
        const mainDomain = cert?.domain?.main;

        if (!mainDomain || typeof mainDomain !== "string") {
            logger.debug(`acmeCertSync: skipping cert with missing domain`);
            continue;
        }

        if (!cert.certificate || !cert.key) {
            logger.debug(
                `acmeCertSync: skipping cert for ${mainDomain} - empty certificate or key field`
            );
            continue;
        }

        let certPem: string;
        let keyPem: string;
        try {
            certPem = Buffer.from(cert.certificate, "base64").toString("utf8");
            keyPem = Buffer.from(cert.key, "base64").toString("utf8");
        } catch (err) {
            logger.debug(
                `acmeCertSync: skipping cert for ${mainDomain} - failed to base64-decode cert/key: ${err}`
            );
            continue;
        }

        if (!certPem.trim() || !keyPem.trim()) {
            logger.debug(
                `acmeCertSync: skipping cert for ${mainDomain} - blank PEM after base64 decode`
            );
            continue;
        }

        // Validate that the decoded data actually parses as a real X.509 cert
        // before we touch the database. This prevents importing partially-written
        // or corrupted entries from acme.json.
        const firstCertPemForValidation = extractFirstCert(certPem);
        if (!firstCertPemForValidation) {
            logger.debug(
                `acmeCertSync: skipping cert for ${mainDomain} - no PEM certificate block found`
            );
            continue;
        }

        let validatedX509: crypto.X509Certificate;
        try {
            validatedX509 = new crypto.X509Certificate(
                firstCertPemForValidation
            );
        } catch (err) {
            logger.debug(
                `acmeCertSync: skipping cert for ${mainDomain} - invalid X.509 certificate: ${err}`
            );
            continue;
        }

        // Sanity-check the private key parses too
        try {
            crypto.createPrivateKey(keyPem);
        } catch (err) {
            logger.debug(
                `acmeCertSync: skipping cert for ${mainDomain} - invalid private key: ${err}`
            );
            continue;
        }

        // Collect all domains covered by this cert: main + every SAN.
        // Each domain gets its own row in the certificates table so that
        // lookups by any hostname on the cert succeed independently.
        const allDomains = new Set<string>([mainDomain]);
        if (Array.isArray(cert.domain?.sans)) {
            for (const san of cert.domain.sans) {
                if (typeof san === "string" && san.trim()) {
                    allDomains.add(san.trim());
                }
            }
        }

        // logger.debug(
        //     `acmeCertSync: cert for ${mainDomain} covers ${allDomains.size} domain(s): ${[...allDomains].join(", ")}`
        // );

        for (const domain of allDomains) {
            try {
                await storeCertForDomain(
                    domain,
                    certPem,
                    keyPem,
                    validatedX509
                );
            } catch (err) {
                logger.error(
                    `acmeCertSync: error storing cert for domain "${domain}": ${err}`
                );
            }
        }
    }
}

export function initAcmeCertSync(): void {
    if (build == "saas") {
        logger.debug(`acmeCertSync: skipping ACME cert sync in SaaS build`);
        return;
    }

    const privateConfigData = privateConfig.getRawPrivateConfig();

    if (!privateConfigData.flags?.enable_acme_cert_sync) {
        logger.debug(
            `acmeCertSync: ACME cert sync is disabled by config flag, skipping`
        );
        return;
    }

    if (privateConfigData.flags.use_pangolin_dns) {
        logger.debug(
            `acmeCertSync: ACME cert sync requires use_pangolin_dns flag to be disabled, skipping`
        );
        return;
    }

    const acmeJsonPath =
        privateConfigData.acme?.acme_json_path ??
        "config/letsencrypt/acme.json";
    const intervalMs = privateConfigData.acme?.sync_interval_ms ?? 5000;
    const httpEndpoint = privateConfigData.acme?.acme_http_endpoint;

    logger.debug(
        `acmeCertSync: starting ACME cert sync from "${acmeJsonPath}" across all resolvers every ${intervalMs}ms`
    );
    if (httpEndpoint) {
        logger.debug(
            `acmeCertSync: also syncing from HTTP endpoint "${httpEndpoint}" every ${intervalMs}ms`
        );
    }

    const runSync = () => {
        if (httpEndpoint) {
            syncAcmeCertsFromHttp(httpEndpoint).catch((err) => {
                logger.error(`acmeCertSync: error during HTTP sync: ${err}`);
            });
        } else {
            // only run the file-based sync if the HTTP endpoint is not configured, to avoid doubling up
            let stat: fs.Stats | null = null;
            try {
                stat = fs.statSync(acmeJsonPath);
            } catch (err) {
                logger.warn(
                    `acmeCertSync: cannot stat path "${acmeJsonPath}": ${err}`
                );
                return;
            }

            if (stat.isDirectory()) {
                const files = findAcmeJsonFiles(acmeJsonPath);
                if (files.length === 0) {
                    logger.debug(
                        `acmeCertSync: no acme.json files found in directory "${acmeJsonPath}"`
                    );
                    return;
                }
                // logger.debug(
                //     `acmeCertSync: found ${files.length} acme.json file(s) in directory "${acmeJsonPath}"`
                // );
                for (const file of files) {
                    syncAcmeCerts(file).catch((err) => {
                        logger.error(
                            `acmeCertSync: error during sync of "${file}": ${err}`
                        );
                    });
                }
            } else {
                syncAcmeCerts(acmeJsonPath).catch((err) => {
                    logger.error(`acmeCertSync: error during sync: ${err}`);
                });
            }
        }
    };

    // Run immediately on init, then on the configured interval
    runSync();

    setInterval(runSync, intervalMs);
}
