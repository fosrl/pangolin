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

import { Olm, clients, db } from "@server/db";
import { MessageHandler } from "@server/routers/ws";
import { eq } from "drizzle-orm";
import logger from "@server/logger";
import { inflate } from "zlib";
import { promisify } from "util";
import {
    getDnsBlockRetentionDays,
    logDnsBlocks,
    DnsBlockLogRecord
} from "#private/lib/dnsBlocklist/logDnsBlockAudit";

const zlibInflate = promisify(inflate);

// Entries accepted from one batch. olm sends at most a few thousand distinct
// domains per batch; anything beyond this is ignored.
const MAX_ENTRIES_PER_BATCH = 5000;
const MAX_COUNT_PER_ENTRY = 10_000_000;

type BlockLogEntry = {
    domain?: unknown;
    count?: unknown;
    firstSeen?: unknown;
};

async function decompress(compressed: string): Promise<BlockLogEntry[]> {
    const inflated = await zlibInflate(Buffer.from(compressed, "base64"));
    const parsed = JSON.parse(inflated.toString("utf-8"));
    if (!Array.isArray(parsed)) {
        throw new Error("Decompressed DNS block log data is not an array");
    }
    return parsed;
}

// Domains come from a client we do not fully trust, so keep only plausible
// hostnames.
function cleanDomain(value: unknown): string | null {
    if (typeof value !== "string") return null;
    const domain = value.trim().toLowerCase();
    if (domain.length === 0 || domain.length > 253) return null;
    if (!/^[a-z0-9_.-]+$/.test(domain)) return null;
    return domain;
}

export const handleDnsBlockLogMessage: MessageHandler = async (context) => {
    const { message, client } = context;
    const olm = client as Olm;

    if (!olm) {
        logger.warn("DNS block log received but no olm in context");
        return;
    }
    if (!olm.clientId) {
        logger.warn("DNS block log received but olm has no client");
        return;
    }
    if (typeof message.data?.compressed !== "string") {
        logger.warn("DNS block log message missing compressed data");
        return;
    }

    const [clientRow] = await db
        .select({ orgId: clients.orgId })
        .from(clients)
        .where(eq(clients.clientId, olm.clientId))
        .limit(1);
    if (!clientRow) {
        logger.warn(`DNS block log: client ${olm.clientId} not found`);
        return;
    }
    const orgId = clientRow.orgId;

    const retentionDays = await getDnsBlockRetentionDays(orgId);
    if (retentionDays === 0) {
        return;
    }

    let entries: BlockLogEntry[];
    try {
        entries = await decompress(message.data.compressed);
    } catch (error) {
        logger.error("Failed to decompress DNS block log data:", error);
        return;
    }

    const now = Math.floor(Date.now() / 1000);
    const records: DnsBlockLogRecord[] = [];

    for (const entry of entries.slice(0, MAX_ENTRIES_PER_BATCH)) {
        const domain = cleanDomain(entry.domain);
        const count = Number(entry.count);
        if (!domain || !Number.isInteger(count) || count < 1) continue;

        let timestamp = Number(entry.firstSeen);
        // Trust the client's clock only loosely.
        if (
            !Number.isFinite(timestamp) ||
            timestamp > now ||
            timestamp < now - 24 * 60 * 60
        ) {
            timestamp = now;
        }

        records.push({
            orgId,
            clientId: olm.clientId,
            userId: olm.userId ?? null,
            domain,
            count: Math.min(count, MAX_COUNT_PER_ENTRY),
            timestamp: Math.floor(timestamp)
        });
    }

    if (records.length > 0) {
        logDnsBlocks(records);
    }
};
