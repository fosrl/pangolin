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

import { db } from "@server/db";
import { MessageHandler } from "@server/routers/ws";
import { sites, Newt, orgs, clients, clientSitesAssociationsCache, users } from "@server/db";
import { and, eq, inArray } from "drizzle-orm";
import logger from "@server/logger";
import { inflate } from "zlib";
import { promisify } from "util";
import { logRequestAudit } from "@server/routers/badger/logRequestAudit";
import { getCountryCodeForIp } from "@server/lib/geoip";

export async function flushRequestLogToDb(): Promise<void> {
    return;
}

const zlibInflate = promisify(inflate);

interface HTTPRequestLogData {
    requestId: string;
    resourceId: number; // siteResourceId
    timestamp: string; // ISO 8601
    method: string;
    scheme: string; // "http" or "https"
    host: string;
    path: string;
    rawQuery?: string;
    userAgent?: string;
    sourceAddr: string; // ip:port
    tls: boolean;
}

/**
 * Decompress a base64-encoded zlib-compressed string into parsed JSON.
 */
async function decompressRequestLog(
    compressed: string
): Promise<HTTPRequestLogData[]> {
    const compressedBuffer = Buffer.from(compressed, "base64");
    const decompressed = await zlibInflate(compressedBuffer);
    const jsonString = decompressed.toString("utf-8");
    const parsed = JSON.parse(jsonString);

    if (!Array.isArray(parsed)) {
        throw new Error("Decompressed request log data is not an array");
    }

    return parsed;
}

export const handleRequestLogMessage: MessageHandler = async (context) => {
    const { message, client } = context;
    const newt = client as Newt;

    if (!newt) {
        logger.warn("Request log received but no newt client in context");
        return;
    }

    if (!newt.siteId) {
        logger.warn("Request log received but newt has no siteId");
        return;
    }

    if (!message.data?.compressed) {
        logger.warn("Request log message missing compressed data");
        return;
    }

    // Look up the org for this site and check retention settings
    const [site] = await db
        .select({
            orgId: sites.orgId,
            orgSubnet: orgs.subnet,
            settingsLogRetentionDaysRequest:
                orgs.settingsLogRetentionDaysRequest
        })
        .from(sites)
        .innerJoin(orgs, eq(sites.orgId, orgs.orgId))
        .where(eq(sites.siteId, newt.siteId));

    if (!site) {
        logger.warn(
            `Request log received but site ${newt.siteId} not found in database`
        );
        return;
    }

    const orgId = site.orgId;

    if (site.settingsLogRetentionDaysRequest === 0) {
        logger.debug(
            `Request log retention is disabled for org ${orgId}, skipping`
        );
        return;
    }

    let entries: HTTPRequestLogData[];
    try {
        entries = await decompressRequestLog(message.data.compressed);
    } catch (error) {
        logger.error("Failed to decompress request log data:", error);
        return;
    }

    if (entries.length === 0) {
        return;
    }

    logger.debug(`Request log entries: ${JSON.stringify(entries)}`);

    // Build a map from sourceIp → external endpoint string by joining clients
    // with clientSitesAssociationsCache. The endpoint is the real-world IP:port
    // of the client device and is used for GeoIP lookup.
    const ipToEndpoint = new Map<string, string>();
    // Build a map from sourceIp → the user associated with the client (if any)
    const ipToUser = new Map<string, { username: string; userId: string }>();

    const cidrSuffix = site.orgSubnet?.includes("/")
        ? site.orgSubnet.substring(site.orgSubnet.indexOf("/"))
        : null;

    if (cidrSuffix) {
        const uniqueSourceAddrs = new Set<string>();
        for (const entry of entries) {
            if (entry.sourceAddr) {
                uniqueSourceAddrs.add(entry.sourceAddr);
            }
        }

        if (uniqueSourceAddrs.size > 0) {
            const subnetQueries = Array.from(uniqueSourceAddrs).map((addr) => {
                const ip = addr.includes(":") ? addr.split(":")[0] : addr;
                return `${ip}${cidrSuffix}`;
            });

            const matchedClients = await db
                .select({
                    subnet: clients.subnet,
                    endpoint: clientSitesAssociationsCache.endpoint,
                    username: users.username,
                    userId: users.userId
                })
                .from(clients)
                .innerJoin(
                    clientSitesAssociationsCache,
                    and(
                        eq(
                            clientSitesAssociationsCache.clientId,
                            clients.clientId
                        ),
                        eq(clientSitesAssociationsCache.siteId, newt.siteId)
                    )
                )
                .leftJoin(users, eq(clients.userId, users.userId))
                .where(
                    and(
                        eq(clients.orgId, orgId),
                        inArray(clients.subnet, subnetQueries)
                    )
                );

            for (const c of matchedClients) {
                const ip = c.subnet.split("/")[0];
                if (c.endpoint) {
                    ipToEndpoint.set(ip, c.endpoint);
                }
                if (c.userId && c.username) {
                    ipToUser.set(ip, { userId: c.userId, username: c.username });
                }
            }
        }
    }

    for (const entry of entries) {
        if (
            !entry.requestId ||
            !entry.resourceId ||
            !entry.method ||
            !entry.scheme ||
            !entry.host ||
            !entry.path ||
            !entry.sourceAddr
        ) {
            logger.debug(
                `Skipping request log entry with missing required fields: ${JSON.stringify(entry)}`
            );
            continue;
        }

        const originalRequestURL =
            entry.scheme +
            "://" +
            entry.host +
            entry.path +
            (entry.rawQuery ? "?" + entry.rawQuery : "");

        // Resolve the client's external endpoint for GeoIP lookup.
        // sourceAddr is the WireGuard IP (possibly ip:port), so strip the port.
        const sourceIp = entry.sourceAddr.includes(":")
            ? entry.sourceAddr.split(":")[0]
            : entry.sourceAddr;
        const endpoint = ipToEndpoint.get(sourceIp);
        let location: string | undefined;
        if (endpoint) {
            const endpointIp = endpoint.includes(":")
                ? endpoint.split(":")[0]
                : endpoint;
            location = await getCountryCodeForIp(endpointIp);
        }
        const user = ipToUser.get(sourceIp);

        await logRequestAudit(
            {
                action: true,
                reason: 108,
                siteResourceId: entry.resourceId,
                orgId,
                location,
                user
            },
            {
                path: entry.path,
                originalRequestURL,
                scheme: entry.scheme,
                host: entry.host,
                method: entry.method,
                tls: entry.tls,
                requestIp: entry.sourceAddr
            }
        );
    }

    logger.debug(
        `Buffered ${entries.length} request log entry/entries from newt ${newt.newtId} (site ${newt.siteId})`
    );
};
