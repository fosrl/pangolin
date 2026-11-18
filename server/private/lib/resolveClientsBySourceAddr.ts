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

import { clientSitesAssociationsCache, clients, db } from "@server/db";
import logger from "@server/logger";
import { and, eq, inArray } from "drizzle-orm";

export type ResolvedClient = {
    clientId: number;
    userId: string | null;
    clientEndpoint: string | null;
};

/**
 * Strip the port from a source address (e.g. "100.90.128.1:38004" →
 * "100.90.128.1").
 */
export function sourceAddrToIp(addr: string): string {
    return addr.includes(":") ? addr.split(":")[0] : addr;
}

/**
 * Map the source addresses newt saw on its tunnel to the clients that own
 * them. A source address is the client's IP on the WireGuard network, which
 * is the IP portion of the client's subnet (stored with the org's CIDR
 * suffix, e.g. "100.90.128.5/16"), so we rebuild that exact string and do a
 * targeted IN query. The returned map is keyed by IP without port.
 */
export async function resolveClientsBySourceAddr({
    orgId,
    orgSubnet,
    siteId,
    sourceAddrs
}: {
    orgId: string;
    orgSubnet: string | null;
    siteId: number;
    sourceAddrs: Iterable<string>;
}): Promise<Map<string, ResolvedClient>> {
    const ipToClient = new Map<string, ResolvedClient>();

    const cidrSuffix = orgSubnet?.includes("/")
        ? orgSubnet.substring(orgSubnet.indexOf("/"))
        : null;
    if (!cidrSuffix) {
        return ipToClient;
    }

    const uniqueIps = new Set<string>();
    for (const addr of sourceAddrs) {
        if (addr) {
            uniqueIps.add(sourceAddrToIp(addr));
        }
    }
    if (uniqueIps.size === 0) {
        return ipToClient;
    }

    const subnetQueries = Array.from(uniqueIps).map(
        (ip) => `${ip}${cidrSuffix}`
    );

    logger.debug(`Subnet queries: ${JSON.stringify(subnetQueries)}`);

    const matchedClients = await db
        .select({
            clientId: clients.clientId,
            userId: clients.userId,
            subnet: clients.subnet,
            clientEndpoint: clientSitesAssociationsCache.endpoint
        })
        .from(clients)
        .leftJoin(
            // this should be one to one
            clientSitesAssociationsCache,
            and(
                eq(clients.clientId, clientSitesAssociationsCache.clientId),
                eq(clientSitesAssociationsCache.siteId, siteId)
            )
        )
        .where(
            and(
                eq(clients.orgId, orgId),
                inArray(clients.subnet, subnetQueries)
            )
        );

    for (const c of matchedClients) {
        const ip = c.subnet.split("/")[0];
        logger.debug(`Client ${c.clientId} subnet ${c.subnet} matches ${ip}`);
        ipToClient.set(ip, {
            clientId: c.clientId,
            userId: c.userId,
            clientEndpoint: c.clientEndpoint
        });
    }

    return ipToClient;
}
