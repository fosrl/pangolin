import { db } from "@server/db";
import { sites, clients, olms } from "@server/db";
import { and, eq, inArray } from "drizzle-orm";
import logger from "@server/logger";
import { fireSiteOnlineAlert } from "@server/lib/alerts";
import { withRetry } from "@server/lib/dbRetry";

/**
 * Ping Accumulator
 *
 * Instead of writing to the database on every single newt/olm ping (which
 * causes pool exhaustion under load, especially with cross-region latency),
 * we accumulate pings in memory and flush them to the database periodically
 * in a single batch.
 *
 * This is the same pattern used for bandwidth flushing in
 * receiveBandwidth.ts and handleReceiveBandwidthMessage.ts.
 *
 * Supports two kinds of pings:
 *   - **Site pings** (from newts): update `sites.online` and `sites.lastPing`
 *   - **Client pings** (from OLMs): update `clients.online`, `clients.lastPing`,
 *     `clients.archived`, and optionally reset `olms.archived`
 */

const FLUSH_INTERVAL_MS = 10_000; // Flush every 10 seconds

// ── Site (newt) pings ──────────────────────────────────────────────────
// Map of siteId -> latest ping timestamp (unix seconds)
const pendingSitePings: Map<number, number> = new Map();

// ── Client (OLM) pings ────────────────────────────────────────────────
// Map of clientId -> latest ping timestamp (unix seconds)
const pendingClientPings: Map<number, number> = new Map();
// Set of olmIds whose `archived` flag should be reset to false
const pendingOlmArchiveResets: Set<string> = new Set();

let flushTimer: NodeJS.Timeout | null = null;

/**
 * Guard that prevents two flush cycles from running concurrently.
 * setInterval does not await async callbacks, so without this a slow flush
 * (e.g. due to DB latency) would overlap with the next scheduled cycle and
 * the two concurrent bulk UPDATEs would deadlock each other.
 */
let isFlushing = false;

// ── Public API ─────────────────────────────────────────────────────────

/**
 * Record a ping for a newt site. This does NOT write to the database
 * immediately. Instead it stores the latest ping timestamp in memory,
 * to be flushed periodically by the background timer.
 */
export function recordSitePing(siteId: number): void {
    const now = Math.floor(Date.now() / 1000);
    pendingSitePings.set(siteId, now);
}

/**
 * Record a ping for an OLM client. Batches the `clients` table update
 * (`online`, `lastPing`, `archived`) and, when `olmArchived` is true,
 * also queues an `olms` table update to clear the archived flag.
 */
export function recordClientPing(
    clientId: number,
    olmId: string,
    olmArchived: boolean
): void {
    const now = Math.floor(Date.now() / 1000);
    pendingClientPings.set(clientId, now);
    if (olmArchived) {
        pendingOlmArchiveResets.add(olmId);
    }
}

// ── Flush Logic ────────────────────────────────────────────────────────

/**
 * Flush all accumulated site pings to the database.
 *
 * Each batch of up to BATCH_SIZE rows is written with a **single** UPDATE
 * statement. We use the maximum timestamp across the batch so that `lastPing`
 * reflects the most recent ping seen for any site in the group. This avoids
 * the multi-statement transaction that previously created additional
 * row-lock ordering hazards.
 */
async function flushSitePingsToDb(): Promise<void> {
    if (pendingSitePings.size === 0) {
        return;
    }

    // Snapshot and clear so new pings arriving during the flush go into a
    // fresh map for the next cycle.
    const pingsToFlush = new Map(pendingSitePings);
    pendingSitePings.clear();

    const entries = Array.from(pingsToFlush.entries());

    const BATCH_SIZE = 50;
    for (let i = 0; i < entries.length; i += BATCH_SIZE) {
        const batch = entries.slice(i, i + BATCH_SIZE);

        // Use the latest timestamp in the batch so that `lastPing` always
        // moves forward. Using a single timestamp for the whole batch means
        // we only ever need one UPDATE statement (no transaction).
        const maxTimestamp = Math.max(...batch.map(([, ts]) => ts));
        const siteIds = batch.map(([id]) => id);

        try {
            const newlyOnlineSites = await withRetry(async () => {
                // Only update sites that were offline - these are the
                // offline→online transitions. .returning() gives us exactly
                // the site IDs that changed state.
                const transitioned = await db
                    .update(sites)
                    .set({
                        online: true,
                        lastPing: maxTimestamp
                    })
                    .where(
                        and(
                            inArray(sites.siteId, siteIds),
                            eq(sites.online, false)
                        )
                    )
                    .returning({
                        siteId: sites.siteId,
                        orgId: sites.orgId,
                        name: sites.name
                    });

                // Update lastPing for sites that were already online.
                // After the update above, the newly-online sites now have
                // online = true, so this catches all remaining sites in the
                // batch and keeps lastPing current for them too.
                await db
                    .update(sites)
                    .set({ lastPing: maxTimestamp })
                    .where(
                        and(
                            inArray(sites.siteId, siteIds),
                            eq(sites.online, true)
                        )
                    );

                return transitioned;
            }, "flushSitePingsToDb");

            for (const site of newlyOnlineSites) {
                await db.transaction(async (trx) => {
                    await fireSiteOnlineAlert(
                        site.orgId,
                        site.siteId,
                        site.name,
                        undefined,
                        trx
                    );
                });
            }
        } catch (error) {
            logger.error(
                `Failed to flush site ping batch (${batch.length} sites), re-queuing for next cycle`,
                { error }
            );
            // Re-queue only if the preserved timestamp is newer than any
            // update that may have landed since we snapshotted.
            for (const [siteId, timestamp] of batch) {
                const existing = pendingSitePings.get(siteId);
                if (!existing || existing < timestamp) {
                    pendingSitePings.set(siteId, timestamp);
                }
            }
        }
    }
}

/**
 * Flush all accumulated client (OLM) pings to the database.
 *
 * Same single-UPDATE-per-batch approach as `flushSitePingsToDb`.
 */
async function flushClientPingsToDb(): Promise<void> {
    if (pendingClientPings.size === 0 && pendingOlmArchiveResets.size === 0) {
        return;
    }

    // Snapshot and clear
    const pingsToFlush = new Map(pendingClientPings);
    pendingClientPings.clear();

    const olmResetsToFlush = new Set(pendingOlmArchiveResets);
    pendingOlmArchiveResets.clear();

    // ── Flush client pings ─────────────────────────────────────────────
    if (pingsToFlush.size > 0) {
        const entries = Array.from(pingsToFlush.entries());

        const BATCH_SIZE = 50;
        for (let i = 0; i < entries.length; i += BATCH_SIZE) {
            const batch = entries.slice(i, i + BATCH_SIZE);

            const maxTimestamp = Math.max(...batch.map(([, ts]) => ts));
            const clientIds = batch.map(([id]) => id);

            try {
                await withRetry(async () => {
                    await db
                        .update(clients)
                        .set({
                            lastPing: maxTimestamp,
                            online: true,
                            archived: false
                        })
                        .where(inArray(clients.clientId, clientIds));
                }, "flushClientPingsToDb");
            } catch (error) {
                logger.error(
                    `Failed to flush client ping batch (${batch.length} clients), re-queuing for next cycle`,
                    { error }
                );
                for (const [clientId, timestamp] of batch) {
                    const existing = pendingClientPings.get(clientId);
                    if (!existing || existing < timestamp) {
                        pendingClientPings.set(clientId, timestamp);
                    }
                }
            }
        }
    }

    // ── Flush OLM archive resets ───────────────────────────────────────
    if (olmResetsToFlush.size > 0) {
        const olmIds = Array.from(olmResetsToFlush).sort();

        const BATCH_SIZE = 50;
        for (let i = 0; i < olmIds.length; i += BATCH_SIZE) {
            const batch = olmIds.slice(i, i + BATCH_SIZE);

            try {
                await withRetry(async () => {
                    await db
                        .update(olms)
                        .set({ archived: false })
                        .where(inArray(olms.olmId, batch));
                }, "flushOlmArchiveResets");
            } catch (error) {
                logger.error(
                    `Failed to flush OLM archive reset batch (${batch.length} olms), re-queuing for next cycle`,
                    { error }
                );
                for (const olmId of batch) {
                    pendingOlmArchiveResets.add(olmId);
                }
            }
        }
    }
}

/**
 * Flush everything - called by the interval timer and during shutdown.
 */
export async function flushPingsToDb(): Promise<void> {
    await flushSitePingsToDb();
    await flushClientPingsToDb();
}

// ── Retry / Error Helpers ──────────────────────────────────────────────
// See @server/lib/dbRetry for the shared withRetry/isTransientError helpers.

// ── Lifecycle ──────────────────────────────────────────────────────────

/**
 * Start the background flush timer. Call this once at server startup.
 */
export function startPingAccumulator(): void {
    if (flushTimer) {
        return; // Already running
    }

    flushTimer = setInterval(async () => {
        // Skip this tick if the previous flush is still in progress.
        // setInterval does not await async callbacks, so without this guard
        // two flush cycles can run concurrently and deadlock each other on
        // overlapping bulk UPDATE statements.
        if (isFlushing) {
            logger.debug(
                "Ping accumulator: previous flush still in progress, skipping cycle"
            );
            return;
        }

        isFlushing = true;
        try {
            await flushPingsToDb();
        } catch (error) {
            logger.error("Unhandled error in ping accumulator flush", {
                error
            });
        } finally {
            isFlushing = false;
        }
    }, FLUSH_INTERVAL_MS);

    // Don't prevent the process from exiting
    flushTimer.unref();

    logger.debug(
        `Ping accumulator started (flush interval: ${FLUSH_INTERVAL_MS}ms)`
    );
}

/**
 * Stop the background flush timer and perform a final flush.
 * Call this during graceful shutdown.
 */
export async function stopPingAccumulator(): Promise<void> {
    if (flushTimer) {
        clearInterval(flushTimer);
        flushTimer = null;
    }

    // Final flush to persist any remaining pings.
    // Wait for any in-progress flush to finish first so we don't race.
    if (isFlushing) {
        logger.debug(
            "Ping accumulator: waiting for in-progress flush before stopping…"
        );
        await new Promise<void>((resolve) => {
            const poll = setInterval(() => {
                if (!isFlushing) {
                    clearInterval(poll);
                    resolve();
                }
            }, 50);
        });
    }

    try {
        await flushPingsToDb();
    } catch (error) {
        logger.error("Error during final ping accumulator flush", { error });
    }

    logger.info("Ping accumulator stopped");
}

/**
 * Get the number of pending (unflushed) pings. Useful for monitoring.
 */
export function getPendingPingCount(): number {
    return pendingSitePings.size + pendingClientPings.size;
}
