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

import * as dgram from "dgram";
import * as dns from "dns-packet";
import NodeCache from "node-cache";
import { createHash } from "crypto";
import { eq, and, gt, or, inArray, desc } from "drizzle-orm";
import {
    db,
    primaryDb,
    exitNodes,
    loginPage,
    newts,
    resources,
    sites,
    targets,
    dnsChallenge,
    domains
} from "@server/db";
import { privateConfig as config } from "#private/lib/config";
import * as dnsResolver from "dns";
import logger from "@server/logger";
import { listExitNodes } from "../exitNodes";
import { rateLimitService } from "../rateLimit";

type DNSRecord = {
    id: number;
    zone: string;
    name: string;
    type: string;
    value: string;
    ttl: number;
    priority: number;
    enabled: boolean;
};

export class AuthoritativeDNSServer {
    private cache: NodeCache;
    private server: dgram.Socket;
    private port: number;
    private inFlightLookups: Map<string, Promise<unknown>> = new Map();

    // In-memory set of all base domains we are authoritative for.
    // Loaded at startup and refreshed every 60s so findAuthoritativeZone
    // never hits the database once the set is warm.
    private allDomains: Set<string> = new Set();
    private domainRefreshInterval: NodeJS.Timeout | null = null;

    // Cache for per-queryName zone resolution and SOA records
    private authoritativeDomainCache: NodeCache = new NodeCache({
        stdTTL: 300,
        checkperiod: 60
    });
    private soaCache: NodeCache = new NodeCache({
        stdTTL: 300,
        checkperiod: 60
    });

    constructor(port: number, cacheOptions: NodeCache.Options = {}) {
        // Initialize cache with default TTL of 5 minutes
        this.cache = new NodeCache({
            stdTTL: 300,
            checkperiod: 60,
            ...cacheOptions
        });

        this.port = port;
        this.server = dgram.createSocket("udp4");

        this.setupServer();
    }

    private setupServer(): void {
        this.server.on(
            "message",
            async (msg: Buffer, rinfo: dgram.RemoteInfo) => {
                try {
                    await this.handleQuery(msg, rinfo);
                } catch (error) {
                    logger.error("Error handling DNS query:", error);
                }
            }
        );

        this.server.on("error", (err: Error) => {
            logger.error("DNS server error:", err);
        });

        this.server.on("listening", () => {
            const address = this.server.address();
            logger.info(
                `DNS server listening on ${address?.address}:${address?.port}`
            );
        });
    }

    private async handleQuery(
        msg: Buffer,
        rinfo: dgram.RemoteInfo
    ): Promise<void> {
        let packet: dns.Packet;
        try {
            packet = dns.decode(msg);
        } catch (error) {
            logger.error("Failed to decode DNS packet:", error);
            return;
        }

        if (!packet.questions || packet.questions.length === 0) {
            return;
        }

        const question = packet.questions[0];
        const dnsRateLimit = config.getRawConfig().dns!.rate_limit;

        if (dnsRateLimit.enabled) {
            const rateLimitResult = await rateLimitService.checkRateLimit(
                rinfo.address,
                question.type,
                dnsRateLimit.max_requests,
                dnsRateLimit.max_requests_per_query_type,
                dnsRateLimit.window_ms
            );

            if (rateLimitResult.isLimited) {
                logger.warn(
                    `DNS rate limit exceeded for ${rinfo.address} (${question.type}). Reason=${rateLimitResult.reason}, totalHits=${rateLimitResult.totalHits}`
                );
                // REFUSED (rcode=5) indicates a policy refusal by this nameserver.
                this.sendResponse(packet, [], rinfo, false, 5, []);
                return;
            }
        }

        let queryName = question.name.toLowerCase();
        const originalQueryName = queryName;
        const queryType = question.type;
        let baseDomain: string | null;

        logger.info(
            `DNS Query: ${queryName} ${queryType} from ${rinfo.address}:${rinfo.port}`
        );

        // TODO: DO WE NEED SOME PROTECTION HERE TO PREVENT ABUSIVE QUERIES? (e.g., rate limiting, query validation, etc.)
        // Special handling for site subnet lookups: {niceId}.{site_extension}
        const siteExtension = config.getRawConfig().dns!.site_extension;
        const siteSubnetSuffix = `.${siteExtension}`;
        const normalizedQueryName = originalQueryName.replace(/\.$/, "");
        if (
            normalizedQueryName.endsWith(siteSubnetSuffix) &&
            !normalizedQueryName
                .slice(0, -siteSubnetSuffix.length)
                .includes(".")
        ) {
            const newtId = normalizedQueryName.slice(
                0,
                -siteSubnetSuffix.length
            );
            if (newtId) {
                logger.info(`Site subnet lookup for newtId: ${newtId}`);
                const subnetIp = await this.getSiteSubnetIpByNewtId(newtId);
                if (subnetIp && queryType === "A") {
                    const answer: dns.Answer = {
                        name: originalQueryName,
                        type: "A",
                        ttl: 60,
                        data: subnetIp
                    };
                    this.sendResponse(packet, [answer], rinfo, true, 0, []);
                } else {
                    logger.info(`No site found for newtId: ${newtId}`);
                    this.sendResponse(packet, [], rinfo, true, 3, []);
                }
                return;
            }
        }

        // Special handling for cname.pangolin.net domains
        const cnameExtension = config.getRawConfig().dns!.cname_extension;
        const cnameAlternateExtensions =
            config.getRawConfig().dns!.cname_alternate_extensions ?? [];
        const nameserverName = config.getRawConfig().dns!.nameserver_name;
        const matchedCnameAlternateExtension = cnameAlternateExtensions.find(
            (ext: string) => originalQueryName.endsWith(`.${ext}`)
        );
        const matchesNameserverName = originalQueryName.endsWith(
            `.${nameserverName}.`
        );

        if (
            originalQueryName.endsWith(`.${cnameExtension}`) ||
            matchedCnameAlternateExtension !== undefined ||
            matchesNameserverName
        ) {
            // The zone this query actually arrived under (used below for the
            // SOA/NS answers), as opposed to `actualDomain`, which is an
            // unrelated customer domain this synthetic CNAME name happens to
            // resolve to.
            const cnameZone =
                matchedCnameAlternateExtension ??
                (matchesNameserverName ? nameserverName : cnameExtension);

            // Extract domainId using config values
            let domainId = queryName.replace(
                new RegExp(`\\.${cnameExtension}\\.?$`),
                ""
            );

            for (const ext of cnameAlternateExtensions) {
                domainId = domainId.replace(new RegExp(`\\.${ext}\\.?$`), "");
            }

            domainId = domainId
                .replace(new RegExp(`\\.${nameserverName}\\.?$`), "")
                .replace(/^_acme-challenge\./, "");
            logger.info(`CNAME domain request for domain ID: ${domainId}`);

            const actualDomain = await this.getDomainByDomainId(domainId);
            if (!actualDomain) {
                logger.info(`NXDOMAIN for CNAME domain ID: ${domainId}`);
                this.sendResponse(packet, [], rinfo, false, 3, []); // NXDOMAIN rcode=3 - not authoritative for unknown CNAME domain
                return;
            }
            queryName = actualDomain; // Use the actual domain for resource-record lookups
            // IMPORTANT: baseDomain must stay a real ancestor of
            // originalQueryName (cnameZone), NOT actualDomain. SOA/NS
            // answers below use `name: baseDomain` as the RRset owner, and
            // if that owner isn't provably related to the queried name,
            // resolvers reject the response as bogus (observed: 8.8.8.8
            // returning SERVFAIL with EDE "Unexpected <name>/soa in
            // received ANSWER") instead of accepting it - which broke
            // Let's Encrypt's DNS-01 validation here, not stale caching.
            baseDomain = cnameZone;
        } else {
            // Find authoritative zone for this query
            baseDomain = await this.findAuthoritativeZone(queryName);
            if (!baseDomain) {
                // Before giving up, check if there are static records for this name
                const staticRecords = this.getStaticRecords(
                    queryName,
                    queryType
                );
                if (staticRecords.length > 0) {
                    logger.info(
                        `Serving ${staticRecords.length} static record(s) for ${queryName}`
                    );
                    const answers = this.convertRecordsToAnswers(
                        staticRecords,
                        originalQueryName,
                        queryType
                    );
                    this.sendResponse(packet, answers, rinfo, true, 0, []);
                    return;
                }
                logger.info(
                    `NXDOMAIN: Not authoritative for zone: ${queryName}`
                );
                this.sendResponse(packet, [], rinfo, false, 3, []); // NXDOMAIN rcode=3 - not authoritative
                return;
            }
        }

        // Special handling for _acme-challenge CNAME requests
        if (
            (queryType === "TXT" || queryType === "CNAME") &&
            originalQueryName.startsWith("_acme-challenge")
        ) {
            logger.info(`Handling ACME challenge for ${queryName}`);
            const txtRecords = await this.getAcmeChallengeTXT(
                queryName.replace("_acme-challenge.", "")
            );
            if (txtRecords.length > 0) {
                logger.info(`Serving ACME challenge TXT for ${queryName}`);
                const answers = this.convertRecordsToAnswers(
                    txtRecords,
                    originalQueryName,
                    "TXT"
                );
                this.sendResponse(packet, answers, rinfo, true, 0, []);
            } else {
                // just return no data on the acme challenge not an soa record
                logger.info(`No ACME challenge TXT found for ${queryName}`);
                this.sendResponse(
                    packet,
                    [],
                    rinfo,
                    true,
                    0,
                    [] // No SOA record for ACME challenges
                );
            }
            return;
        }

        // If its a CAA query then respond with letsencrypt
        if (queryType === "CAA") {
            logger.info(`Handling CAA query for ${queryName}`);
            const caaRecord: dns.Answer = {
                name: queryName,
                type: "CAA",
                ttl: 300,
                data: {
                    flags: 0,
                    tag: "issue",
                    value: "letsencrypt.org"
                }
            };
            this.sendResponse(packet, [caaRecord], rinfo, true, 0, []);
            return;
        }

        // Handle NS queries
        if (queryType === "NS") {
            logger.info(`Handling NS query for ${queryName}`);
            const nsRecords = await this.getNSRecords(baseDomain);
            if (nsRecords.length > 0) {
                const answers = nsRecords.map((record) => ({
                    name: queryName,
                    type: "NS" as const,
                    ttl: 300,
                    data: record
                }));
                this.sendResponse(packet, answers, rinfo, true, 0, []);
                return;
            }
        }

        // Handle SOA queries
        if (queryType === "SOA") {
            logger.info(`Handling SOA query for ${queryName}`);
            const soaRecord = await this.getSOARecord(baseDomain);
            if (soaRecord) {
                // For SOA queries, we need to return the SOA record for the zone we're authoritative for
                // The query might be for a subdomain, but we return the SOA for the zone
                const soaAnswer = {
                    ...soaRecord,
                    name: baseDomain // SOA record name should be the zone name
                };
                this.sendResponse(packet, [soaAnswer], rinfo, true, 0, []);
                return;
            }
        }

        // Check for static records from config (e.g. domain verification TXT/CNAME)
        const staticRecords = this.getStaticRecords(queryName, queryType);
        if (staticRecords.length > 0) {
            const answers = this.convertRecordsToAnswers(
                staticRecords,
                originalQueryName,
                queryType
            );
            logger.info(
                `Returning ${answers.length} static config record(s) for ${originalQueryName} (${queryType}): ${JSON.stringify(answers)}`
            );
            this.sendResponse(packet, answers, rinfo, true, 0, []);
            return;
        }

        // Get records from cache or database
        const records = await this.getResourceRecordsByFullDomain(
            queryName,
            queryType
        );

        if (records.length > 0) {
            // Normal answer
            const answers = this.convertRecordsToAnswers(
                records,
                originalQueryName,
                queryType
            );
            logger.info(
                `Returning ${
                    answers.length
                } answers for ${originalQueryName} (${queryType}): ${JSON.stringify(
                    answers
                )}`
            );
            this.sendResponse(packet, answers, rinfo, true, 0, []);
            return;
        }

        const loginPageRecords = await this.getLoginPageRecordsByFullDomain(
            queryName,
            queryType
        );

        if (loginPageRecords.length > 0) {
            // Normal answer
            const answers = this.convertRecordsToAnswers(
                loginPageRecords,
                originalQueryName,
                queryType
            );
            logger.info(
                `Returning ${
                    answers.length
                } answers for ${originalQueryName} (${queryType}): ${JSON.stringify(
                    answers
                )}`
            );
            this.sendResponse(packet, answers, rinfo, true, 0, []);
            return;
        }

        // Check if the domain exists (for NODATA vs NXDOMAIN)
        const [domainExists, soaRecord] = await Promise.all([
            this.domainExists(queryName, baseDomain!),
            this.getSOARecord(baseDomain!)
        ]);

        if (!domainExists) {
            // NXDOMAIN: Name does not exist
            logger.info(`NXDOMAIN for ${queryName}`);
            this.sendResponse(
                packet,
                [],
                rinfo,
                true,
                3,
                soaRecord ? [soaRecord] : []
            );
            return;
        } else {
            // NOERROR/NODATA: Domain exists, but no record of requested type
            logger.info(`NODATA (NOERROR) for ${queryName} type ${queryType}`);
            this.sendResponse(
                packet,
                [],
                rinfo,
                true,
                0,
                soaRecord ? [soaRecord] : []
            );
            return;
        }
    }

    // Find the base domain for which we are authoritative
    private async findAuthoritativeZone(
        queryName: string
    ): Promise<string | null> {
        const cacheKey = `authzone:${queryName}`;
        const cached = this.authoritativeDomainCache.get<string | null>(
            cacheKey
        );
        if (cached !== undefined) {
            return cached;
        }

        const labels = queryName.replace(/\.$/, "").split(".");

        // Fast path: O(1) in-memory Set lookup — no DB or network I/O
        if (this.allDomains.size > 0) {
            for (let i = 0; i < labels.length; i++) {
                const candidate = labels.slice(i).join(".");
                if (this.allDomains.has(candidate)) {
                    this.authoritativeDomainCache.set(cacheKey, candidate);
                    return candidate;
                }
            }
            this.authoritativeDomainCache.set(cacheKey, null);
            return null;
        }

        // Fallback: DB query used only before the first domain load completes at startup
        try {
            logger.info(
                `Domain set not yet loaded, querying database for ${queryName}`
            );
            const candidates = labels.map((_, i) => labels.slice(i).join("."));
            const rows = await db
                .select({ baseDomain: domains.baseDomain })
                .from(domains)
                .where(inArray(domains.baseDomain, candidates));

            if (rows.length === 0) {
                this.authoritativeDomainCache.set(cacheKey, null);
                return null;
            }

            const best = rows.reduce((a, b) =>
                a.baseDomain.length > b.baseDomain.length ? a : b
            );
            this.authoritativeDomainCache.set(cacheKey, best.baseDomain);
            return best.baseDomain;
        } catch (error) {
            logger.error("Error querying for authoritative zone:", error);
            return null;
        }
    }

    // Check if the domain exists (for NODATA/NXDOMAIN distinction)
    private async domainExists(
        queryName: string,
        baseDomain: string
    ): Promise<boolean> {
        const cacheKey = `exists:${queryName}`;
        const cached = this.cache.get<boolean>(cacheKey);
        if (cached !== undefined) return cached;

        try {
            const normalizedQuery = queryName.replace(/\.$/, "");

            // If queryName is the zone apex we already know it exists — no DB query needed
            if (normalizedQuery === baseDomain) {
                this.cache.set(cacheKey, true, 60);
                return true;
            }

            // Check resources table (exact or wildcard match)
            const wildcardPattern = this.getWildcardPattern(normalizedQuery);
            const existsCondition = wildcardPattern
                ? or(
                      eq(resources.fullDomain, queryName),
                      eq(resources.fullDomain, wildcardPattern)
                  )!
                : eq(resources.fullDomain, queryName);
            const [row] = await db
                .select({ fullDomain: resources.fullDomain })
                .from(resources)
                .where(existsCondition)
                .limit(1);
            const exists = !!row;
            this.cache.set(cacheKey, exists, 60);
            return exists;
        } catch {
            return false;
        }
    }

    // Get SOA record for a zone
    private async getSOARecord(zone: string): Promise<dns.Answer | null> {
        const cacheKey = `soa:${zone}`;
        const cached = this.soaCache.get<dns.Answer>(cacheKey);
        if (cached) return cached;

        // For demonstration, construct a default SOA record
        // In production, fetch from DB if you store SOA records
        const soa: dns.Answer = {
            name: zone,
            type: "SOA",
            ttl: 300,
            data: {
                mname: config.getRawConfig().dns!.nameserver_name,
                rname: `dns-admin.${config.getRawConfig().dns!.nameserver_name}`,
                serial: Math.floor(Date.now() / 1000),
                refresh: 3600,
                retry: 1800,
                expire: 604800,
                minimum: 86400
            }
        };
        this.soaCache.set(cacheKey, soa);
        return soa;
    }

    private async getResourceRecordsByFullDomain(
        name: string,
        queryType: dns.RecordType
    ): Promise<DNSRecord[]> {
        const cacheKey = `resourceRecords:${name}:${queryType}`;

        // Check cache first
        const cached = this.cache.get<DNSRecord[]>(cacheKey);
        if (cached) {
            logger.debug(`Cache hit for ${cacheKey}`);
            return cached;
        }

        return this.withInFlightDedup<DNSRecord[]>(cacheKey, async () => {
            logger.debug(`Cache miss for ${cacheKey}, querying database`);

            try {
                const wildcardPattern = this.getWildcardPattern(name);
                const domainCondition = wildcardPattern
                    ? or(
                          eq(resources.fullDomain, name),
                          eq(resources.fullDomain, wildcardPattern)
                      )!
                    : eq(resources.fullDomain, name);

                // LEFT JOINs so we always get the resource row (and its orgId) even
                // when the resource has no targets/sites/exitNodes assigned yet.
                const resourceRows = await db
                    .select({
                        endpoint: exitNodes.endpoint,
                        online: exitNodes.online,
                        orgId: resources.orgId,
                        siteType: sites.type,
                        enabled: resources.enabled
                    })
                    .from(resources)
                    .leftJoin(
                        targets,
                        eq(resources.resourceId, targets.resourceId)
                    )
                    .leftJoin(sites, eq(targets.siteId, sites.siteId))
                    .leftJoin(
                        exitNodes,
                        eq(sites.exitNodeId, exitNodes.exitNodeId)
                    )
                    .where(domainCondition);

                if (resourceRows.length === 0) {
                    // Resource doesn't exist at all — also pre-populate the domainExists
                    // cache so the subsequent domainExists() call hits memory, not the DB.
                    logger.debug(`No resource found for domain: ${name}`);
                    this.cache.set(`exists:${name}`, false, 60);
                    this.cache.set(cacheKey, [], 60);
                    return [];
                }

                if (!resourceRows[0].enabled) {
                    // Resource exists but is disabled — the domain still exists (NODATA,
                    // not NXDOMAIN), it just shouldn't resolve to anything right now.
                    logger.info(
                        `Resource for domain ${name} is disabled; not returning DNS records`
                    );
                    this.cache.set(cacheKey, [], 60);
                    return [];
                }

                // Exclude exit nodes that are offline — an assigned but offline exit
                // node falls through to the random-online-exit-node selection below,
                // same as a resource with no exit node assigned at all.
                const resourceExitNodes = resourceRows.filter(
                    (r) => r.endpoint !== null && r.online === true
                ) as { endpoint: string; orgId: string }[];

                if (resourceExitNodes.length === 0) {
                    // "local" sites route directly to the target IP on the box running
                    // that site's own exit node/Traefik instance — they don't tunnel
                    // through an exit node. If every site behind this resource is local,
                    // a randomly picked exit node wouldn't have a route to the target,
                    // so don't fall back to one; just serve no records.
                    const siteRows = resourceRows.filter(
                        (r) => r.siteType !== null
                    );
                    const allSitesLocal =
                        siteRows.length > 0 &&
                        siteRows.every((r) => r.siteType === "local");

                    if (allSitesLocal) {
                        logger.info(
                            "All sites for resource are type 'local' with no online exit node; not choosing a random exit node."
                        );
                        this.cache.set(cacheKey, [], 10);
                        return [];
                    }

                    logger.info(
                        "No online exit nodes found for resource. Choosing a deterministic exit node."
                    );
                    // TODO: EVENTUALLY WE SHOULD PICK THE CLOSEST EXIT NODE TO THE USER BASED ON LATENCY
                    const orgId = resourceRows[0].orgId;
                    const exitNodesList = await listExitNodes(orgId, true);

                    if (!exitNodesList || exitNodesList.length === 0) {
                        logger.warn(`No exit nodes found for orgId: ${orgId}`);
                        this.cache.set(cacheKey, [], 10);
                        return [];
                    }

                    // Prefer exit nodes in the same region as this DNS server, if any exist.
                    const dnsRegion = config.getRawConfig().app.region;
                    const regionExitNodes = dnsRegion
                        ? exitNodesList.filter(
                              (node) => node.region === dnsRegion
                          )
                        : [];
                    const candidateExitNodes =
                        regionExitNodes.length > 0
                            ? regionExitNodes
                            : exitNodesList;

                    // Deterministically pick a node based on the queried name so
                    // repeated queries for the same resource keep resolving to the
                    // same exit node instead of changing on every cache miss.
                    const selectedExitNode = this.selectDeterministicExitNode(
                        name,
                        candidateExitNodes
                    );

                    const ipRecords = await this.createRecordsFromEndpoint(
                        selectedExitNode.endpoint,
                        name,
                        queryType
                    );

                    this.cache.set(cacheKey, ipRecords);
                    return ipRecords;
                }

                let results: DNSRecord[] = [];

                for (const exitNode of resourceExitNodes) {
                    const endpoint = exitNode.endpoint;
                    logger.info(
                        `Processing endpoint: ${endpoint} for query type: ${queryType}`
                    );

                    // TODO: EVENTUALLY WE SHOULD PICK THE CLOSET EXIT NODE TO THE USER BASED ON LATENCY
                    // Check if endpoint is an IP address
                    const ipRecords = await this.createRecordsFromEndpoint(
                        endpoint,
                        name,
                        queryType
                    );
                    results.push(...ipRecords);
                }

                // Cache the results
                this.cache.set(cacheKey, results);
                logger.info(`Cached ${results.length} records for ${cacheKey}`);

                return results;
            } catch (error) {
                logger.error("Database query error:", error);
                return [];
            }
        });
    }

    // Deterministically picks a node for `name` out of `nodes` by hashing the
    // queried name, so the same resource keeps resolving to the same exit
    // node across cache misses and across independently-caching DNS server
    // processes, instead of a fresh random pick every time.
    private selectDeterministicExitNode<T extends { exitNodeId: number }>(
        name: string,
        nodes: T[]
    ): T {
        // Sort by id so the hash-to-index mapping doesn't depend on the order
        // rows happen to come back from the database.
        const sorted = [...nodes].sort((a, b) => a.exitNodeId - b.exitNodeId);
        const hash = createHash("sha1").update(name).digest();
        const index = hash.readUInt32BE(0) % sorted.length;
        return sorted[index];
    }

    private async getLoginPageRecordsByFullDomain(
        name: string,
        queryType: dns.RecordType
    ): Promise<DNSRecord[]> {
        const cacheKey = `loginPageRecords:${name}:${queryType}`;

        // Check cache first
        const cached = this.cache.get<DNSRecord[]>(cacheKey);
        if (cached) {
            logger.debug(`Cache hit for ${cacheKey}`);
            return cached;
        }

        return this.withInFlightDedup<DNSRecord[]>(cacheKey, async () => {
            logger.debug(`Cache miss for ${cacheKey}, querying database`);

            try {
                // Query database
                const loginPageExitNodes = await db
                    .select({ endpoint: exitNodes.endpoint })
                    .from(loginPage)
                    .innerJoin(
                        exitNodes,
                        eq(loginPage.exitNodeId, exitNodes.exitNodeId)
                    )
                    .where(eq(loginPage.fullDomain, name));

                if (loginPageExitNodes.length === 0) {
                    logger.info("No exit nodes found for resource.");

                    this.cache.set(cacheKey, [], 60);
                    return [];
                }

                let results: DNSRecord[] = [];

                for (const exitNode of loginPageExitNodes) {
                    const endpoint = exitNode.endpoint;
                    logger.info(
                        `Processing endpoint: ${endpoint} for query type: ${queryType}`
                    );

                    // TODO: EVENTUALLY WE SHOULD PICK THE CLOSET EXIT NODE TO THE USER BASED ON LATENCY
                    // Check if endpoint is an IP address
                    const ipRecords = await this.createRecordsFromEndpoint(
                        endpoint,
                        name,
                        queryType
                    );
                    results.push(...ipRecords);
                }

                // Cache the results
                this.cache.set(cacheKey, results);
                logger.info(`Cached ${results.length} records for ${cacheKey}`);

                return results;
            } catch (error) {
                logger.error("Database query error:", error);
                return [];
            }
        });
    }

    private async withInFlightDedup<T>(
        key: string,
        lookupFn: () => Promise<T>
    ): Promise<T> {
        const existing = this.inFlightLookups.get(key) as
            Promise<T> | undefined;
        if (existing) {
            logger.debug(`Joining in-flight lookup for ${key}`);
            return existing;
        }

        const lookupPromise = (async () => {
            try {
                return await lookupFn();
            } finally {
                this.inFlightLookups.delete(key);
            }
        })();

        this.inFlightLookups.set(key, lookupPromise as Promise<unknown>);
        return lookupPromise;
    }

    // Add this new method to get domain by domain ID
    private async getDomainByDomainId(
        domainId: string
    ): Promise<string | null> {
        const cacheKey = `domain:${domainId}`;
        const cached = this.cache.get<string | null>(cacheKey);
        if (cached !== undefined) {
            logger.info(`Domain cache hit for ${domainId}: ${cached}`);
            return cached;
        }

        try {
            const [domain] = await db
                .select({ baseDomain: domains.baseDomain })
                .from(domains)
                .where(eq(domains.domainId, domainId))
                .limit(1);

            const result = domain ? domain.baseDomain : null;
            this.cache.set(cacheKey, result, 300); // Cache for 5 minutes
            logger.info(`Domain cache miss for ${domainId}, found: ${result}`);
            return result;
        } catch (error) {
            logger.error("Error querying domain by ID:", error);
            return null;
        }
    }

    private getStaticRecords(
        queryName: string,
        queryType: dns.RecordType
    ): DNSRecord[] {
        const dnsConfig = config.getRawConfig().dns;
        if (!dnsConfig?.static_records?.length) {
            return [];
        }

        const normalizedQuery = queryName.replace(/\.$/, "").toLowerCase();

        return dnsConfig.static_records
            .filter((record) => {
                const normalizedDomain = record.domain
                    .replace(/\.$/, "")
                    .toLowerCase();
                return (
                    normalizedDomain === normalizedQuery &&
                    record.type === queryType
                );
            })
            .map((record, index) => ({
                id: -(index + 1), // negative IDs to avoid collision with DB records
                zone: normalizedQuery,
                name: normalizedQuery,
                type: record.type,
                value: record.value,
                ttl: record.ttl,
                priority: 0,
                enabled: true
            }));
    }

    private convertRecordsToAnswers(
        records: DNSRecord[],
        queryName: string,
        queryType: dns.RecordType
    ): dns.Answer[] {
        return records.map((record) => {
            const answer: any = {
                name: queryName,
                type: record.type,
                ttl: record.ttl,
                data: this.formatRecordData(record, queryType)
            };
            return answer;
        });
    }

    private formatRecordData(
        record: DNSRecord,
        queryType: dns.RecordType
    ): any {
        switch (queryType) {
            case "A":
                return record.value; // IPv4 address as string

            case "AAAA":
                return record.value; // IPv6 address as string

            case "CNAME":
                return record.value; // Canonical name as string

            case "TXT":
                // TXT records can have multiple strings
                try {
                    const parsed = JSON.parse(record.value);
                    return Array.isArray(parsed) ? parsed : [record.value];
                } catch {
                    return [record.value];
                }

            case "MX":
                // MX records need priority and exchange
                return {
                    priority: record.priority,
                    exchange: record.value
                };

            case "NS":
                return record.value; // Name server as string

            case "SOA":
                try {
                    return JSON.parse(record.value);
                } catch {
                    return {
                        mname: record.value,
                        rname: "admin." + record.zone,
                        serial: Math.floor(Date.now() / 1000),
                        refresh: 3600,
                        retry: 1800,
                        expire: 604800,
                        minimum: 86400
                    };
                }

            default:
                return record.value;
        }
    }

    private sendResponse(
        originalPacket: dns.Packet,
        answers: dns.Answer[],
        rinfo: dgram.RemoteInfo,
        authoritative: boolean = true,
        rcode: number = 0,
        authorities: dns.Answer[] = []
    ): void {
        const response: dns.Packet = {
            id: originalPacket.id,
            type: "response",
            flags: dns.RECURSION_DESIRED,
            questions: originalPacket.questions,
            answers: answers,
            authorities: authorities,
            additionals: []
        };

        // Set authoritative flag if this is an authoritative response
        if (authoritative) {
            response.flags = (response.flags ?? 0) | dns.AUTHORITATIVE_ANSWER;
        }

        // Set rcode in the flags field (lower 4 bits) while preserving other flags
        response.flags = (response.flags ?? 0) & ~0xf; // Clear lower 4 bits
        response.flags |= rcode & 0xf; // Set rcode

        try {
            const responseBuffer = dns.encode(response);
            this.server.send(
                responseBuffer,
                rinfo.port,
                rinfo.address,
                (err) => {
                    if (err) {
                        logger.error("Error sending DNS response:", err);
                    }
                }
            );
        } catch (error) {
            logger.error("Error encoding DNS response:", error);
        }
    }

    private async loadAllDomains(): Promise<void> {
        try {
            const rows = await db
                .select({ baseDomain: domains.baseDomain })
                .from(domains);
            this.allDomains = new Set(rows.map((r) => r.baseDomain));
            logger.info(
                `Loaded ${this.allDomains.size} authoritative domains into memory`
            );
        } catch (error) {
            logger.error(
                "Failed to load authoritative domains, will retry next interval:",
                error
            );
        }
    }

    public async start(): Promise<void> {
        await this.loadAllDomains();
        this.domainRefreshInterval = setInterval(() => {
            this.loadAllDomains().catch((err) =>
                logger.error("Domain refresh failed:", err)
            );
        }, 60_000);

        return new Promise((resolve, reject) => {
            this.server.bind(this.port, (err?: Error) => {
                if (err) {
                    reject(err);
                } else {
                    resolve();
                }
            });
        });
    }

    public async stop(): Promise<void> {
        if (this.domainRefreshInterval) {
            clearInterval(this.domainRefreshInterval);
        }
        return new Promise((resolve) => {
            this.server.close(() => {
                logger.info("DNS server stopped");
                resolve();
            });
        });
    }

    public getCacheStats(): NodeCache.Stats {
        return this.cache.getStats();
    }

    public clearCache(): void {
        this.cache.flushAll();
        logger.info("DNS cache cleared");
    }

    // Add this new method for ACME challenge TXT lookup
    private async getAcmeChallengeTXT(name: string): Promise<DNSRecord[]> {
        // Remove any trailing dot for FQDN
        const domain = name.endsWith(".") ? name.slice(0, -1) : name;
        const cacheKey = `acme:${domain}`;
        const cached = this.cache.get<DNSRecord[]>(cacheKey);
        if (cached !== undefined) {
            logger.info(`ACME TXT cache hit for ${domain}`);
            return cached;
        }
        try {
            // Use primaryDb, not db (which may be routed to a lagging read
            // replica) - these rows are inserted moments before this lookup
            // runs, and a stale replica read here causes the ACME client's
            // own DNS pre-check to see no TXT record and fail the order.
            // Ordered newest-first (not just limited to one row) so that if
            // more than one non-expired, uncompleted challenge exists for
            // this domain at once - e.g. an overlapping/duplicate order -
            // we can log the collision instead of silently picking whichever
            // row Postgres happens to return first, which was previously
            // non-deterministic and could serve a stale/wrong TXT value.
            const challenges = await primaryDb
                .select({
                    id: dnsChallenge.dnsChallengeId,
                    domain: dnsChallenge.domain,
                    token: dnsChallenge.token,
                    keyAuthorization: dnsChallenge.keyAuthorization,
                    expiresAt: dnsChallenge.expiresAt
                })
                .from(dnsChallenge)
                .where(
                    and(
                        eq(dnsChallenge.domain, domain),
                        eq(dnsChallenge.completed, false),
                        gt(
                            dnsChallenge.expiresAt,
                            Math.floor(Date.now() / 1000)
                        )
                    )
                )
                .orderBy(desc(dnsChallenge.dnsChallengeId));

            if (challenges.length === 0) {
                // Keep the negative-cache TTL short: challenges are inserted
                // right before verification starts, so caching a "not found"
                // result for too long can outlive that insert and make a
                // just-created challenge look absent for several more seconds.
                this.cache.set(cacheKey, [], 1);
                return [];
            }

            // A wildcard order challenges both `domain` and `*.domain`, and
            // both authorizations' identifier value is the bare `domain` -
            // so a wildcard cert legitimately has two live, uncompleted
            // challenge rows here at once, each needing its own TXT value
            // published at the same _acme-challenge.<domain> name (DNS
            // allows multiple TXT records per name; the CA's DNS-01 check
            // just looks for its expected value among whatever comes back).
            // Serving only the newest silently drops the other
            // authorization's value, which makes that authorization fail
            // DNS-01 validation forever - so every non-expired, uncompleted
            // challenge for this domain must be served together.
            const result: DNSRecord[] = challenges.map((c) => ({
                id: c.id,
                zone: c.domain,
                name: c.domain,
                type: "TXT",
                value: c.keyAuthorization,
                // Kept short deliberately: a downstream resolver that
                // caches (or serve-stales) this answer for the full 60s
                // can hand Let's Encrypt a value from an already-replaced
                // challenge, since a validation attempt only needs this
                // record for a few seconds. Shrinking the window a
                // caching layer can serve a wrong answer during matters
                // more here than the extra query volume costs.
                ttl: 5,
                priority: 0,
                enabled: true
            }));
            logger.info(
                `Serving ${result.length} ACME challenge TXT record(s) for ${domain}: ${challenges
                    .map((c) => `id ${c.id}/token ${c.token}`)
                    .join(", ")}`
            );
            this.cache.set(cacheKey, result, 3);
            return result;
        } catch (error) {
            logger.error("Error querying ACME challenge TXT:", error);
            return [];
        }
    }

    private async getSiteSubnetIpByNewtId(
        newtId: string
    ): Promise<string | null> {
        const cacheKey = `site-subnet:${newtId}`;
        const cached = this.cache.get<string | null>(cacheKey);
        if (cached !== undefined) {
            return cached;
        }

        try {
            const [site] = await db
                .select({ subnet: sites.exitNodeSubnet })
                .from(sites)
                .innerJoin(newts, eq(newts.siteId, sites.siteId))
                .where(eq(newts.newtId, newtId))
                .limit(1);

            if (!site?.subnet) {
                this.cache.set(cacheKey, null, 60);
                return null;
            }

            // Strip CIDR prefix notation (e.g. "100.64.0.1/24" -> "100.64.0.1")
            const ip = site.subnet.split("/")[0];
            this.cache.set(cacheKey, ip, 60);
            return ip;
        } catch (error) {
            logger.error("Error querying site subnet by niceId:", error);
            return null;
        }
    }

    // Add this new method to get NS records
    private async getNSRecords(zone: string | null): Promise<string[]> {
        const cacheKey = `ns:${zone}`;
        const cached = this.cache.get<string[]>(cacheKey);
        if (cached) {
            logger.info(`NS cache hit for ${zone}`);
            return cached;
        }

        try {
            // Return the configured nameserver(s)
            const nameservers = [
                config.getRawConfig().dns!.nameserver_name,
                ...config.getRawConfig().dns!.alternate_nameservers
            ];

            this.cache.set(cacheKey, nameservers, 300); // Cache for 5 minutes
            logger.info(`NS cache miss for ${zone}, returning: ${nameservers}`);
            return nameservers;
        } catch (error) {
            logger.error("Error getting NS records:", error);
            return [];
        }
    }

    private async createRecordsFromEndpoint(
        endpoint: string,
        name: string,
        queryType: dns.RecordType
    ): Promise<DNSRecord[]> {
        const results: DNSRecord[] = [];

        // First, check if endpoint is already an IP address
        const ipv4Record = this.createRecordFromIp(endpoint, name, "A");
        const ipv6Record = this.createRecordFromIp(endpoint, name, "AAAA");

        if (ipv4Record && queryType === "A") {
            logger.info(`Endpoint ${endpoint} is IPv4, returning A record`);
            results.push(ipv4Record);
            return results;
        }

        if (ipv6Record && queryType === "AAAA") {
            logger.info(`Endpoint ${endpoint} is IPv6, returning AAAA record`);
            results.push(ipv6Record);
            return results;
        }

        // If not an IP, try to resolve as DNS name
        if (!ipv4Record && !ipv6Record) {
            // Basic validation for DNS name
            if (this.isValidDNSName(endpoint)) {
                try {
                    logger.info(
                        `Attempting to resolve DNS name: ${endpoint} for type ${queryType}`
                    );
                    const resolvedIPs = await this.resolveDNSName(
                        endpoint,
                        queryType
                    );
                    for (const ip of resolvedIPs) {
                        const record = this.createRecordFromIp(
                            ip,
                            name,
                            queryType
                        );
                        if (record) {
                            results.push(record);
                        }
                    }
                } catch (error) {
                    logger.error(
                        `Failed to resolve DNS name ${endpoint}:`,
                        error
                    );
                }
            } else {
                logger.warn(`Invalid DNS name or IP format: ${endpoint}`);
            }
        }

        return results;
    }

    private isValidDNSName(hostname: string): boolean {
        // Basic DNS name validation
        if (!hostname || hostname.length === 0 || hostname.length > 253) {
            return false;
        }

        // Check for valid characters and structure
        const dnsNameRegex =
            /^[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;
        return dnsNameRegex.test(hostname);
    }

    private async resolveDNSName(
        hostname: string,
        queryType: dns.RecordType
    ): Promise<string[]> {
        return new Promise((resolve) => {
            const results: string[] = [];
            const timeout = setTimeout(() => {
                logger.warn(`DNS resolution timeout for ${hostname}`);
                resolve(results);
            }, 5000); // 5 second timeout

            if (queryType === "A") {
                dnsResolver.resolve4(
                    hostname,
                    (err: any, addresses: string[]) => {
                        clearTimeout(timeout);
                        if (!err && addresses && Array.isArray(addresses)) {
                            logger.info(
                                `Resolved ${hostname} to IPv4: ${addresses.join(
                                    ", "
                                )}`
                            );
                            results.push(...addresses);
                        } else if (err) {
                            logger.warn(
                                `Failed to resolve ${hostname} to IPv4: ${err.message}`
                            );
                        }
                        resolve(results);
                    }
                );
            } else if (queryType === "AAAA") {
                dnsResolver.resolve6(
                    hostname,
                    (err: any, addresses: string[]) => {
                        clearTimeout(timeout);
                        if (!err && addresses && Array.isArray(addresses)) {
                            logger.info(
                                `Resolved ${hostname} to IPv6: ${addresses.join(
                                    ", "
                                )}`
                            );
                            results.push(...addresses);
                        } else if (err) {
                            logger.warn(
                                `Failed to resolve ${hostname} to IPv6: ${err.message}`
                            );
                        }
                        resolve(results);
                    }
                );
            } else {
                clearTimeout(timeout);
                resolve(results);
            }
        });
    }

    private getWildcardPattern(name: string): string | null {
        const normalized = name.replace(/\.$/, "");
        const dotIndex = normalized.indexOf(".");
        if (dotIndex === -1) return null;
        return `*.${normalized.slice(dotIndex + 1)}`;
    }

    private createRecordFromIp(
        ip: string,
        name: string,
        recordType: dns.RecordType
    ): DNSRecord | null {
        const isIPv4 =
            /^(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/.test(
                ip
            );
        const isIPv6 =
            /^(?:[0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}$|^::1$|^::$|^(?:[0-9a-fA-F]{1,4}:)*::[0-9a-fA-F]{1,4}(?::[0-9a-fA-F]{1,4})*$/.test(
                ip
            );

        if (isIPv4 && recordType === "A") {
            return {
                id: 0,
                zone: name,
                name: name,
                type: "A",
                value: ip,
                ttl: 300,
                priority: 0,
                enabled: true
            };
        } else if (isIPv6 && recordType === "AAAA") {
            return {
                id: 0,
                zone: name,
                name: name,
                type: "AAAA",
                value: ip,
                ttl: 300,
                priority: 0,
                enabled: true
            };
        }

        return null;
    }
}
