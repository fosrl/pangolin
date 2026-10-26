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
import { sites, Newt, orgs } from "@server/db";
import { eq } from "drizzle-orm";
import logger from "@server/logger";
import { inflate } from "zlib";
import { promisify } from "util";
import {
    logConnectionAudit,
    flushConnectionLogToDb,
    cleanUpOldLogs
} from "#private/lib/logConnectionAudit";
import {
    resolveClientsBySourceAddr,
    sourceAddrToIp
} from "#private/lib/resolveClientsBySourceAddr";

export { flushConnectionLogToDb, cleanUpOldLogs };

const zlibInflate = promisify(inflate);

interface ConnectionSessionData {
    sessionId: string;
    resourceId: number;
    sourceAddr: string;
    destAddr: string;
    protocol: string;
    startedAt: string; // ISO 8601 timestamp
    endedAt?: string; // ISO 8601 timestamp
    bytesTx?: number;
    bytesRx?: number;
}

/**
 * Decompress a base64-encoded zlib-compressed string into parsed JSON.
 */
async function decompressConnectionLog(
    compressed: string
): Promise<ConnectionSessionData[]> {
    const compressedBuffer = Buffer.from(compressed, "base64");
    const decompressed = await zlibInflate(compressedBuffer);
    const jsonString = decompressed.toString("utf-8");
    const parsed = JSON.parse(jsonString);

    if (!Array.isArray(parsed)) {
        throw new Error("Decompressed connection log data is not an array");
    }

    return parsed;
}

/**
 * Convert an ISO 8601 timestamp string to epoch seconds.
 * Returns null if the input is falsy.
 */
function toEpochSeconds(isoString: string | undefined | null): number | null {
    if (!isoString) {
        return null;
    }
    const ms = new Date(isoString).getTime();
    if (isNaN(ms)) {
        return null;
    }
    return Math.floor(ms / 1000);
}

export const handleConnectionLogMessage: MessageHandler = async (context) => {
    const { message, client } = context;
    const newt = client as Newt;

    if (!newt) {
        logger.warn("Connection log received but no newt client in context");
        return;
    }

    if (!newt.siteId) {
        logger.warn("Connection log received but newt has no siteId");
        return;
    }

    if (!message.data?.compressed) {
        logger.warn("Connection log message missing compressed data");
        return;
    }

    // Look up the org for this site and check retention settings
    const [site] = await db
        .select({
            orgId: sites.orgId,
            orgSubnet: orgs.subnet,
            settingsLogRetentionDaysConnection:
                orgs.settingsLogRetentionDaysConnection
        })
        .from(sites)
        .innerJoin(orgs, eq(sites.orgId, orgs.orgId))
        .where(eq(sites.siteId, newt.siteId));

    if (!site) {
        logger.warn(
            `Connection log received but site ${newt.siteId} not found in database`
        );
        return;
    }

    const orgId = site.orgId;

    if (site.settingsLogRetentionDaysConnection === 0) {
        logger.debug(
            `Connection log retention is disabled for org ${orgId}, skipping`
        );
        return;
    }

    let sessions: ConnectionSessionData[];
    try {
        sessions = await decompressConnectionLog(message.data.compressed);
    } catch (error) {
        logger.error("Failed to decompress connection log data:", error);
        return;
    }

    if (sessions.length === 0) {
        return;
    }

    logger.debug(`Sessions: ${JSON.stringify(sessions)}`);

    const ipToClient = await resolveClientsBySourceAddr({
        orgId,
        orgSubnet: site.orgSubnet,
        siteId: newt.siteId,
        sourceAddrs: sessions.map((session) => session.sourceAddr)
    });

    // Convert to DB records and hand off to the audit logger
    for (const session of sessions) {
        // Validate required fields
        if (
            !session.sessionId ||
            !session.resourceId ||
            !session.sourceAddr ||
            !session.destAddr ||
            !session.protocol
        ) {
            logger.debug(
                `Skipping connection log session with missing required fields: ${JSON.stringify(session)}`
            );
            continue;
        }

        const startedAt = toEpochSeconds(session.startedAt);
        if (startedAt === null) {
            logger.debug(
                `Skipping connection log session with invalid startedAt: ${session.startedAt}`
            );
            continue;
        }

        // Match the source address to a client by its WireGuard IP.
        const clientInfo =
            ipToClient.get(sourceAddrToIp(session.sourceAddr)) ?? null;

        logConnectionAudit({
            sessionId: session.sessionId,
            siteResourceId: session.resourceId,
            orgId,
            siteId: newt.siteId,
            clientId: clientInfo?.clientId ?? null,
            clientEndpoint: clientInfo?.clientEndpoint ?? null,
            userId: clientInfo?.userId ?? null,
            sourceAddr: session.sourceAddr,
            destAddr: session.destAddr,
            protocol: session.protocol,
            startedAt,
            endedAt: toEpochSeconds(session.endedAt),
            bytesTx: session.bytesTx ?? null,
            bytesRx: session.bytesRx ?? null
        });
    }

    logger.debug(
        `Buffered ${sessions.length} connection log session(s) from newt ${newt.newtId} (site ${newt.siteId})`
    );
};
