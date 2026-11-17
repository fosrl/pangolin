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

import { db, logsDb, dnsBlockLog, orgs } from "@server/db";
import logger from "@server/logger";
import { and, eq, lt } from "drizzle-orm";
import cache from "#private/lib/cache";
import { calculateCutoffTimestamp } from "@server/lib/cleanupLogs";

// ---------------------------------------------------------------------------
// Buffer / flush configuration
// ---------------------------------------------------------------------------

/** How often to flush accumulated rows to the database. */
const FLUSH_INTERVAL_MS = 30_000;

/** Rows buffered before forcing a flush. */
const MAX_BUFFERED_RECORDS = 1000;

/** Rows inserted per database statement. */
const INSERT_BATCH_SIZE = 200;

/** How long an org's retention setting is cached. */
const RETENTION_CACHE_SECONDS = 300;

export type DnsBlockLogRecord = {
    orgId: string;
    clientId: number | null;
    userId: string | null;
    domain: string;
    count: number;
    timestamp: number; // epoch seconds
};

let buffer: DnsBlockLogRecord[] = [];

/**
 * Retention in days for an org's DNS block log: 0 means do not store, -1 keep
 * forever. Cached because every batch from every olm asks.
 */
export async function getDnsBlockRetentionDays(orgId: string): Promise<number> {
    const key = `org_${orgId}_dnsBlockDays`;
    const cached = await cache.get<number>(key);
    if (cached !== undefined && cached !== null) return cached;

    const [org] = await db
        .select({ days: orgs.settingsLogRetentionDaysDnsBlock })
        .from(orgs)
        .where(eq(orgs.orgId, orgId))
        .limit(1);

    const days = org?.days ?? 0;
    await cache.set(key, days, RETENTION_CACHE_SECONDS);
    return days;
}

/**
 * Flush buffered rows to the database. The buffer is swapped out first so rows
 * added during the flush are not lost, and rows that fail to write are
 * re-queued for the next flush. Exported for the shutdown handler.
 */
export async function flushDnsBlockLogToDb(): Promise<void> {
    if (buffer.length === 0) return;

    const snapshot = buffer;
    buffer = [];

    for (let i = 0; i < snapshot.length; i += INSERT_BATCH_SIZE) {
        const batch = snapshot.slice(i, i + INSERT_BATCH_SIZE);
        try {
            await logsDb.insert(dnsBlockLog).values(batch);
        } catch (error) {
            logger.error(
                `Failed to flush DNS block log batch of ${batch.length} rows:`,
                error
            );

            // Keep this batch and everything after it for the next flush.
            buffer = [...snapshot.slice(i), ...buffer];

            // Do not grow without bound if the database is unreachable.
            const hardLimit = MAX_BUFFERED_RECORDS * 5;
            if (buffer.length > hardLimit) {
                const dropped = buffer.length - hardLimit;
                buffer = buffer.slice(dropped);
                logger.warn(
                    `DNS block log buffer overflow, dropped ${dropped} oldest rows`
                );
            }
            break;
        }
    }
}

const flushTimer = setInterval(async () => {
    try {
        await flushDnsBlockLogToDb();
    } catch (error) {
        logger.error("Unexpected error during DNS block log flush:", error);
    }
}, FLUSH_INTERVAL_MS);

// Do not keep the process alive; shutdown flushes explicitly.
flushTimer.unref();

/** Buffer rows for eventual persistence. */
export function logDnsBlocks(records: DnsBlockLogRecord[]): void {
    buffer.push(...records);

    if (buffer.length >= MAX_BUFFERED_RECORDS) {
        flushDnsBlockLogToDb().catch((error) => {
            logger.error(
                "Unexpected error during size-triggered DNS block log flush:",
                error
            );
        });
    }
}

export async function cleanUpOldDnsBlockLogs(
    orgId: string,
    retentionDays: number
): Promise<void> {
    const cutoff = calculateCutoffTimestamp(retentionDays);
    try {
        await logsDb
            .delete(dnsBlockLog)
            .where(
                and(
                    eq(dnsBlockLog.orgId, orgId),
                    lt(dnsBlockLog.timestamp, cutoff)
                )
            );
    } catch (error) {
        logger.error("Error cleaning up old DNS block logs:", error);
    }
}
