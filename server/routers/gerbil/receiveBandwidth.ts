import { Request, Response, NextFunction } from "express";
import { sql } from "drizzle-orm";
import { db, DB_TYPE } from "@server/db";
import logger from "@server/logger";
import createHttpError from "http-errors";
import HttpCode from "@server/types/HttpCode";
import response from "@server/lib/response";
import { usageService } from "@server/lib/billing/usageService";
import { LimitId } from "@server/lib/billing/features";
import { checkExitNodeOrg } from "#dynamic/lib/exitNodes";
import { build } from "@server/build";

interface PeerBandwidth {
    publicKey: string;
    bytesIn: number;
    bytesOut: number;
}

interface AccumulatorEntry {
    bytesIn: number;
    bytesOut: number;
    /** Present when the update came through a remote exit node. */
    exitNodeId?: number;
    /** Whether to record egress usage for billing purposes. */
    calcUsage: boolean;
}

// Retry configuration for deadlock handling
const MAX_RETRIES = 3;
const BASE_DELAY_MS = 50;

// How often to flush accumulated bandwidth data to the database
const FLUSH_INTERVAL_MS = 300_000; // 300 seconds

// Maximum number of sites to include in a single batch UPDATE statement
const BATCH_CHUNK_SIZE = 250;

// In-memory accumulator: publicKey -> AccumulatorEntry
let accumulator = new Map<string, AccumulatorEntry>();

/**
 * Check if an error is a deadlock error
 */
function isDeadlockError(error: any): boolean {
    return (
        error?.code === "40P01" ||
        error?.cause?.code === "40P01" ||
        (error?.message && error.message.includes("deadlock"))
    );
}

/**
 * Execute a function with retry logic for deadlock handling
 */
async function withDeadlockRetry<T>(
    operation: () => Promise<T>,
    context: string
): Promise<T> {
    let attempt = 0;
    while (true) {
        try {
            return await operation();
        } catch (error: any) {
            if (isDeadlockError(error) && attempt < MAX_RETRIES) {
                attempt++;
                const baseDelay = Math.pow(2, attempt - 1) * BASE_DELAY_MS;
                const jitter = Math.random() * baseDelay;
                const delay = baseDelay + jitter;
                logger.warn(
                    `Deadlock detected in ${context}, retrying attempt ${attempt}/${MAX_RETRIES} after ${delay.toFixed(0)}ms`
                );
                await new Promise((resolve) => setTimeout(resolve, delay));
                continue;
            }
            throw error;
        }
    }
}

/**
 * Execute a raw SQL query that returns rows, in a way that works across both
 * the PostgreSQL driver (which exposes `execute`) and the SQLite driver (which
 * exposes `all`).  Drizzle's typed query builder doesn't support bulk
 * UPDATE … FROM (VALUES …) natively, so we drop to raw SQL here.
 */
async function dbQueryRows<T extends Record<string, unknown>>(
    query: Parameters<(typeof sql)["join"]>[0][number]
): Promise<T[]> {
    const anyDb = db as any;
    if (typeof anyDb.execute === "function") {
        // PostgreSQL (node-postgres via Drizzle) - returns { rows: [...] } or an array
        const result = await anyDb.execute(query);
        return (Array.isArray(result) ? result : (result.rows ?? [])) as T[];
    }
    // SQLite (better-sqlite3 via Drizzle) - returns an array directly
    return (await anyDb.all(query)) as T[];
}

function isSQLite(): boolean {
    return DB_TYPE == "sqlite";
}

/**
 * Flush all accumulated site bandwidth data to the database.
 *
 * Swaps out the accumulator before writing so that any bandwidth messages
 * received during the flush are captured in the new accumulator rather than
 * being lost or causing contention. Sites are updated in chunks via a single
 * batch UPDATE per chunk. Failed chunks are discarded - exact per-flush
 * accuracy is not critical and re-queuing is not worth the added complexity.
 *
 * This function is exported so that the application's graceful-shutdown
 * cleanup handler can call it before the process exits.
 */
export async function flushSiteBandwidthToDb(): Promise<void> {
    if (accumulator.size === 0) {
        return;
    }

    // Atomically swap out the accumulator so new data keeps flowing in
    // while we write the snapshot to the database.
    const snapshot = accumulator;
    accumulator = new Map<string, AccumulatorEntry>();

    const currentTime = new Date().toISOString();

    // Sort by publicKey for consistent lock ordering across concurrent
    // writers - deadlock-prevention strategy.
    const sortedEntries = [...snapshot.entries()].sort(([a], [b]) =>
        a.localeCompare(b)
    );

    logger.debug(
        `Flushing accumulated bandwidth data for ${sortedEntries.length} site(s) to the database`
    );

    // Build a lookup so post-processing can reach each entry by publicKey.
    const snapshotMap = new Map(sortedEntries);

    // Aggregate billing usage by org across all chunks.
    const orgUsageMap = new Map<string, number>();

    // Process in chunks so individual queries stay at a reasonable size.
    for (let i = 0; i < sortedEntries.length; i += BATCH_CHUNK_SIZE) {
        const chunk = sortedEntries.slice(i, i + BATCH_CHUNK_SIZE);
        const chunkEnd = i + chunk.length - 1;

        let rows: { orgId: string; pubKey: string }[] = [];

        try {
            rows = await withDeadlockRetry(async () => {
                if (isSQLite()) {
                    // SQLite: one UPDATE per row - no need for batch efficiency here.
                    const results: { orgId: string; pubKey: string }[] = [];
                    for (const [publicKey, { bytesIn, bytesOut }] of chunk) {
                        const result = await dbQueryRows<{
                            orgId: string;
                            pubKey: string;
                        }>(sql`
                            UPDATE sites
                            SET
                                "bytesOut"            = COALESCE("bytesOut", 0) + ${bytesIn},
                                "bytesIn"             = COALESCE("bytesIn", 0)  + ${bytesOut},
                                "lastBandwidthUpdate" = ${currentTime}
                            WHERE "pubKey" = ${publicKey}
                            RETURNING "orgId", "pubKey"
                        `);
                        results.push(...result);
                    }
                    return results;
                }

                // PostgreSQL: batch UPDATE … FROM (VALUES …) - single round-trip per chunk.
                const valuesList = chunk.map(
                    ([publicKey, { bytesIn, bytesOut }]) =>
                        sql`(${publicKey}::text, ${bytesIn}::real, ${bytesOut}::real)`
                );
                const valuesClause = sql.join(valuesList, sql`, `);
                return dbQueryRows<{ orgId: string; pubKey: string }>(sql`
                    UPDATE sites
                    SET
                        "bytesOut"            = COALESCE("bytesOut", 0) + v.bytes_in,
                        "bytesIn"             = COALESCE("bytesIn", 0)  + v.bytes_out,
                        "lastBandwidthUpdate" = ${currentTime}
                    FROM (VALUES ${valuesClause}) AS v(pub_key, bytes_in, bytes_out)
                    WHERE sites."pubKey" = v.pub_key
                    RETURNING sites."orgId" AS "orgId", sites."pubKey" AS "pubKey"
                `);
            }, `flush bandwidth chunk [${i}–${chunkEnd}]`);
        } catch (error) {
            logger.error(
                `Failed to flush bandwidth chunk [${i}–${chunkEnd}], discarding ${chunk.length} site(s):`,
                error
            );
            // Discard the chunk - exact per-flush accuracy is not critical.
            continue;
        }

        // Collect billing usage from the returned rows.
        for (const { orgId, pubKey } of rows) {
            const entry = snapshotMap.get(pubKey);
            if (!entry) continue;

            const { bytesIn, bytesOut, exitNodeId, calcUsage } = entry;

            if (exitNodeId) {
                const notAllowed = await checkExitNodeOrg(exitNodeId, orgId);
                if (notAllowed) {
                    logger.warn(
                        `Exit node ${exitNodeId} is not allowed for org ${orgId}`
                    );
                    continue;
                }
            }

            if (calcUsage) {
                const current = orgUsageMap.get(orgId) ?? 0;
                orgUsageMap.set(orgId, current + bytesIn + bytesOut);
            }
        }
    }

    // Process billing usage updates after all chunks are written.
    if (orgUsageMap.size > 0) {
        const sortedOrgIds = [...orgUsageMap.keys()].sort();

        for (const orgId of sortedOrgIds) {
            try {
                const totalBandwidth = orgUsageMap.get(orgId)!;
                const bandwidthUsage = await usageService.add(
                    orgId,
                    LimitId.EGRESS_DATA_MB,
                    totalBandwidth
                );
                if (bandwidthUsage) {
                    // Fire-and-forget - don't block the flush on limit checking.
                    usageService
                        .checkLimitSet(
                            orgId,
                            LimitId.EGRESS_DATA_MB,
                            bandwidthUsage
                        )
                        .catch((error: any) => {
                            logger.error(
                                `Error checking bandwidth limits for org ${orgId}:`,
                                error
                            );
                        });
                }
            } catch (error) {
                logger.error(`Error processing usage for org ${orgId}:`, error);
                // Continue with other orgs.
            }
        }
    }
}

// ---------------------------------------------------------------------------
// Periodic flush timer
// ---------------------------------------------------------------------------

const flushTimer = setInterval(async () => {
    try {
        await flushSiteBandwidthToDb();
    } catch (error) {
        logger.error(
            "Unexpected error during periodic site bandwidth flush:",
            error
        );
    }
}, FLUSH_INTERVAL_MS);

// Allow the process to exit normally even while the timer is pending.
// The graceful-shutdown path (see server/cleanup.ts) will call
// flushSiteBandwidthToDb() explicitly before process.exit(), so no data
// is lost.
flushTimer.unref();

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Accumulate bandwidth data reported by a gerbil or remote exit node.
 *
 * Only peers that actually transferred data (bytesIn > 0) are added to the
 * accumulator; peers with no activity are silently ignored, which means the
 * flush will only write rows that have genuinely changed.
 *
 * The function is intentionally synchronous in its fast path so that the
 * HTTP handler can respond immediately without waiting for any I/O.
 */
export async function updateSiteBandwidth(
    bandwidthData: PeerBandwidth[],
    calcUsageAndLimits: boolean,
    exitNodeId?: number
): Promise<void> {
    for (const { publicKey, bytesIn, bytesOut } of bandwidthData) {
        // Skip peers that haven't transferred any data - writing zeros to the
        // database would be a no-op anyway.
        if (bytesIn <= 0 && bytesOut <= 0) {
            continue;
        }

        const existing = accumulator.get(publicKey);
        if (existing) {
            existing.bytesIn += bytesIn;
            existing.bytesOut += bytesOut;
            // Retain the most-recent exitNodeId for this peer.
            if (exitNodeId !== undefined) {
                existing.exitNodeId = exitNodeId;
            }
            // Once calcUsage has been requested for a peer, keep it set for
            // the lifetime of this flush window.
            if (calcUsageAndLimits) {
                existing.calcUsage = true;
            }
        } else {
            accumulator.set(publicKey, {
                bytesIn,
                bytesOut,
                exitNodeId,
                calcUsage: calcUsageAndLimits
            });
        }
    }
}

// ---------------------------------------------------------------------------
// HTTP handler
// ---------------------------------------------------------------------------

export const receiveBandwidth = async (
    req: Request,
    res: Response,
    next: NextFunction
): Promise<any> => {
    try {
        const bandwidthData: PeerBandwidth[] = req.body;

        if (!Array.isArray(bandwidthData)) {
            throw new Error("Invalid bandwidth data");
        }

        // Accumulate in memory; the periodic timer (and the shutdown hook)
        // will write to the database.
        await updateSiteBandwidth(bandwidthData, build == "saas");

        return response(res, {
            data: {},
            success: true,
            error: false,
            message: "Bandwidth data updated successfully",
            status: HttpCode.OK
        });
    } catch (error) {
        logger.error("Error updating bandwidth data:", error);
        return next(
            createHttpError(
                HttpCode.INTERNAL_SERVER_ERROR,
                "An error occurred..."
            )
        );
    }
};
