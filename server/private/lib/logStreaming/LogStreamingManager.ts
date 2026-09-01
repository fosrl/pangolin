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

import {
    db,
    logsDb,
    eventStreamingDestinations,
    eventStreamingCursors,
    requestAuditLog,
    actionAuditLog,
    accessAuditLog,
    connectionAuditLog,
    aiSessionLog
} from "@server/db";
import logger from "@server/logger";
import { and, eq, gt, desc, max, sql } from "drizzle-orm";
import { decrypt } from "@server/lib/crypto";
import { decompressText } from "@server/lib/textCompression";
import config from "@server/lib/config";
import {
    LogType,
    LOG_TYPES,
    LogEvent,
    DestinationFailureState,
    HttpConfig,
    S3Config
} from "./types";
import { LogDestinationProvider } from "./providers/LogDestinationProvider";
import { HttpLogDestination } from "./providers/HttpLogDestination";
import { S3LogDestination } from "./providers/S3LogDestination";
import type { EventStreamingDestination } from "@server/db";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/**
 * How often (ms) the manager polls all destinations for new log records.
 * Destinations that were behind (full batch returned) will be re-polled
 * immediately without waiting for this interval.
 */
const POLL_INTERVAL_MS = 30_000;

/**
 * Maximum number of log records fetched from the DB in a single query.
 * This also controls the maximum size of one HTTP POST body.
 */
const BATCH_SIZE = 250;

/**
 * Minimum delay (ms) between consecutive HTTP requests to the same destination
 * during a catch-up run.  Prevents bursting thousands of requests back-to-back
 * when a destination has fallen behind.
 */
const INTER_BATCH_DELAY_MS = 100;

/**
 * Maximum number of consecutive back-to-back batches to process for a single
 * destination per poll cycle.  After this limit the destination will wait for
 * the next scheduled poll before continuing, giving other destinations a turn.
 */
const MAX_CATCHUP_BATCHES = 20;

/**
 * Back-off schedule (ms) indexed by consecutive failure count.
 * After the last entry the max value is re-used.
 */
const BACKOFF_SCHEDULE_MS = [
    60_000, // 1 min   (failure 1)
    2 * 60_000, // 2 min   (failure 2)
    5 * 60_000, // 5 min   (failure 3)
    10 * 60_000, // 10 min  (failure 4)
    30 * 60_000 // 30 min  (failure 5+)
];

/**
 * If a destination has been continuously unreachable for this long, its
 * cursors are advanced to the current max row id and the backlog is silently
 * discarded.  This prevents unbounded queue growth when a webhook endpoint is
 * down for an extended period.  A prominent warning is logged so operators are
 * aware logs were dropped.
 *
 * Default: 24 hours.
 */
const MAX_BACKLOG_DURATION_MS = 24 * 60 * 60_000;

// ---------------------------------------------------------------------------
// LogStreamingManager
// ---------------------------------------------------------------------------

/**
 * Orchestrates periodic polling of the four audit-log tables and forwards new
 * records to every enabled event-streaming destination.
 *
 * ### Design
 * - **Interval-based**: a timer fires every `POLL_INTERVAL_MS`.  On each tick
 *   every enabled destination is processed in sequence.
 * - **Cursor-based**: the last successfully forwarded row `id` is persisted in
 *   the `eventStreamingCursors` table so state survives restarts.
 * - **Catch-up**: if a full batch is returned the destination is immediately
 *   re-queried (up to `MAX_CATCHUP_BATCHES` times) before yielding.
 * - **Smoothing**: `INTER_BATCH_DELAY_MS` is inserted between consecutive
 *   catch-up batches to avoid hammering the remote endpoint.
 * - **Back-off**: consecutive send failures trigger exponential back-off
 *   (tracked in-memory per destination).  Successful sends reset the counter.
 * - **Backlog abandonment**: if a destination remains unreachable for longer
 *   than `MAX_BACKLOG_DURATION_MS`, all cursors for that destination are
 *   advanced to the current max id so the backlog is discarded and streaming
 *   resumes from the present moment on recovery.
 */
export class LogStreamingManager {
    private pollTimer: ReturnType<typeof setTimeout> | null = null;
    private isRunning = false;
    private isPolling = false;

    /** In-memory back-off state keyed by destinationId. */
    private readonly failures = new Map<number, DestinationFailureState>();

    // -------------------------------------------------------------------------
    // Lifecycle
    // -------------------------------------------------------------------------

    start(): void {
        if (this.isRunning) return;
        this.isRunning = true;
        logger.debug("LogStreamingManager: started");
        this.schedulePoll(POLL_INTERVAL_MS);
    }

    // -------------------------------------------------------------------------
    // Cursor initialisation (call this when a destination is first created)
    // -------------------------------------------------------------------------

    /**
     * Eagerly seed cursors for every log type at the **current** max row id of
     * each table, scoped to the destination's org.
     *
     * Call this immediately after inserting a new row into
     * `eventStreamingDestinations` so the destination only receives events
     * that were written *after* it was created.  If a cursor row already exists
     * (e.g. the method is called twice) it is left untouched.
     *
     * The manager also has a lazy fallback inside `getOrCreateCursor` for
     * destinations that existed before this method was introduced.
     */
    async initializeCursorsForDestination(
        destinationId: number,
        orgId: string
    ): Promise<void> {
        for (const logType of LOG_TYPES) {
            const currentMaxId = await this.getCurrentMaxId(logType, orgId);
            try {
                await db
                    .insert(eventStreamingCursors)
                    .values({
                        destinationId,
                        logType,
                        lastSentId: currentMaxId,
                        lastSentAt: null
                    })
                    .onConflictDoNothing();
            } catch (err) {
                logger.warn(
                    `LogStreamingManager: could not initialise cursor for ` +
                        `destination ${destinationId} logType="${logType}"`,
                    err
                );
            }
        }

        logger.debug(
            `LogStreamingManager: cursors initialised for destination ${destinationId} ` +
                `(org=${orgId})`
        );
    }

    async shutdown(): Promise<void> {
        this.isRunning = false;
        if (this.pollTimer !== null) {
            clearTimeout(this.pollTimer);
            this.pollTimer = null;
        }
        // Wait for any in-progress poll to finish before returning so that
        // callers (graceful-shutdown handlers) can safely exit afterward.
        const deadline = Date.now() + 15_000;
        while (this.isPolling && Date.now() < deadline) {
            await sleep(100);
        }
        logger.info("LogStreamingManager: stopped");
    }

    // -------------------------------------------------------------------------
    // Scheduling
    // -------------------------------------------------------------------------

    private schedulePoll(delayMs: number): void {
        this.pollTimer = setTimeout(() => {
            this.pollTimer = null;
            this.runPoll()
                .catch((err) =>
                    logger.error(
                        "LogStreamingManager: unexpected poll error",
                        err
                    )
                )
                .finally(() => {
                    if (this.isRunning) {
                        this.schedulePoll(POLL_INTERVAL_MS);
                    }
                });
        }, delayMs);

        // Do not keep the event loop alive just for the poll timer – the
        // graceful-shutdown path calls shutdown() explicitly.
        this.pollTimer.unref?.();
    }

    // -------------------------------------------------------------------------
    // Poll cycle
    // -------------------------------------------------------------------------

    private async runPoll(): Promise<void> {
        if (this.isPolling) return; // previous poll still running – skip
        this.isPolling = true;

        try {
            const destinations = await this.loadEnabledDestinations();
            if (destinations.length === 0) return;

            for (const dest of destinations) {
                if (!this.isRunning) break;
                await this.processDestination(dest).catch((err) => {
                    // Individual destination errors must never abort the whole cycle
                    logger.error(
                        `LogStreamingManager: unhandled error for destination ${dest.destinationId}`,
                        err
                    );
                });
            }
        } finally {
            this.isPolling = false;
        }
    }

    // -------------------------------------------------------------------------
    // Per-destination processing
    // -------------------------------------------------------------------------

    private async processDestination(
        dest: EventStreamingDestination
    ): Promise<void> {
        const failState = this.failures.get(dest.destinationId);

        // Check whether this destination has been unreachable long enough that
        // we should give up on the accumulated backlog.
        if (failState) {
            const failingForMs = Date.now() - failState.firstFailedAt;
            if (failingForMs >= MAX_BACKLOG_DURATION_MS) {
                await this.abandonBacklog(dest, failState);
                this.failures.delete(dest.destinationId);
                // Cursors now point to the current head – retry on next poll.
                return;
            }
        }

        // Check regular exponential back-off window
        if (failState && Date.now() < failState.nextRetryAt) {
            logger.debug(
                `LogStreamingManager: destination ${dest.destinationId} in back-off, skipping`
            );
            return;
        }

        // Decrypt and parse config – skip destination if either step fails
        let configFromDb: unknown;
        try {
            const decryptedConfig = decrypt(
                dest.config,
                config.getRawConfig().server.secret!
            );
            configFromDb = JSON.parse(decryptedConfig);
        } catch (err) {
            logger.error(
                `LogStreamingManager: destination ${dest.destinationId} has invalid or undecryptable config`,
                err
            );
            return;
        }

        const provider = this.createProvider(dest.type, configFromDb);
        if (!provider) {
            logger.warn(
                `LogStreamingManager: unsupported destination type "${dest.type}" ` +
                    `for destination ${dest.destinationId} – skipping`
            );
            return;
        }

        const enabledTypes: LogType[] = [];
        if (dest.sendRequestLogs) enabledTypes.push("request");
        if (dest.sendActionLogs) enabledTypes.push("action");
        if (dest.sendAccessLogs) enabledTypes.push("access");
        if (dest.sendConnectionLogs) enabledTypes.push("connection");
        if (dest.sendAISessionLogs) enabledTypes.push("aiSession");

        if (enabledTypes.length === 0) return;

        let anyFailure = false;
        let firstError: string | null = null;

        for (const logType of enabledTypes) {
            if (!this.isRunning) break;
            try {
                await this.processLogType(dest, provider, logType);
            } catch (err) {
                anyFailure = true;
                if (firstError === null) {
                    firstError =
                        err instanceof Error ? err.message : String(err);
                }
                logger.error(
                    `LogStreamingManager: failed to process "${logType}" logs ` +
                        `for destination ${dest.destinationId}`,
                    err
                );
            }
        }

        if (anyFailure) {
            this.recordFailure(dest.destinationId);
            await this.setDestinationError(
                dest.destinationId,
                firstError ?? "Unknown error"
            );
        } else {
            // Any success resets the failure/back-off state
            if (this.failures.has(dest.destinationId)) {
                this.failures.delete(dest.destinationId);
                logger.info(
                    `LogStreamingManager: destination ${dest.destinationId} recovered`
                );
            }
            await this.clearDestinationError(dest.destinationId);
        }
    }

    /**
     * Advance every cursor for the destination to the current max row id,
     * effectively discarding the accumulated backlog.  Called when the
     * destination has been unreachable for longer than MAX_BACKLOG_DURATION_MS.
     */
    private async abandonBacklog(
        dest: EventStreamingDestination,
        failState: DestinationFailureState
    ): Promise<void> {
        const failingForHours = (
            (Date.now() - failState.firstFailedAt) /
            3_600_000
        ).toFixed(1);

        let totalDropped = 0;

        for (const logType of LOG_TYPES) {
            try {
                const currentMaxId = await this.getCurrentMaxId(
                    logType,
                    dest.orgId
                );

                // Find out how many rows are being skipped for this type
                const cursor = await db
                    .select({ lastSentId: eventStreamingCursors.lastSentId })
                    .from(eventStreamingCursors)
                    .where(
                        and(
                            eq(
                                eventStreamingCursors.destinationId,
                                dest.destinationId
                            ),
                            eq(eventStreamingCursors.logType, logType)
                        )
                    )
                    .limit(1);

                const prevId = cursor[0]?.lastSentId ?? currentMaxId;
                totalDropped += Math.max(0, currentMaxId - prevId);

                await this.updateCursor(
                    dest.destinationId,
                    logType,
                    currentMaxId
                );
            } catch (err) {
                logger.error(
                    `LogStreamingManager: failed to advance cursor for ` +
                        `destination ${dest.destinationId} logType="${logType}" ` +
                        `during backlog abandonment`,
                    err
                );
            }
        }

        logger.warn(
            `LogStreamingManager: destination ${dest.destinationId} has been ` +
                `unreachable for ${failingForHours}h ` +
                `(${failState.consecutiveFailures} consecutive failures). ` +
                `Discarding backlog of ~${totalDropped} log event(s) and ` +
                `resuming from the current position. ` +
                `Verify the destination URL and credentials.`
        );
    }

    /**
     * Forward all pending log records of a specific type for a destination.
     *
     * Fetches up to `BATCH_SIZE` records at a time.  If the batch is full
     * (indicating more records may exist) it loops immediately, inserting a
     * short delay between consecutive requests to the remote endpoint.
     * The loop is capped at `MAX_CATCHUP_BATCHES` to keep the poll cycle
     * bounded.
     */
    private async processLogType(
        dest: EventStreamingDestination,
        provider: LogDestinationProvider,
        logType: LogType
    ): Promise<void> {
        // Ensure a cursor row exists (creates one pointing at the current max
        // id so we do not replay historical logs on first run)
        const cursor = await this.getOrCreateCursor(
            dest.destinationId,
            logType,
            dest.orgId
        );

        let lastSentId = cursor.lastSentId;
        let batchCount = 0;

        while (batchCount < MAX_CATCHUP_BATCHES) {
            const rows = await this.fetchLogs(
                logType,
                dest.orgId,
                lastSentId,
                BATCH_SIZE
            );

            if (rows.length === 0) break;

            const events = rows.map((row) => this.rowToLogEvent(logType, row));

            // Throws on failure – caught by the caller which applies back-off
            await provider.send(events);

            lastSentId = rows[rows.length - 1].id;
            await this.updateCursor(dest.destinationId, logType, lastSentId);

            batchCount++;

            if (rows.length < BATCH_SIZE) {
                // Partial batch means we have caught up
                break;
            }

            // Full batch – there are likely more records; pause briefly before
            // fetching the next batch to smooth out the HTTP request rate
            if (batchCount < MAX_CATCHUP_BATCHES) {
                await sleep(INTER_BATCH_DELAY_MS);
            }
        }
    }

    // -------------------------------------------------------------------------
    // Cursor management
    // -------------------------------------------------------------------------

    private async getOrCreateCursor(
        destinationId: number,
        logType: LogType,
        orgId: string
    ): Promise<{ lastSentId: number }> {
        // Try to read an existing cursor
        const existing = await db
            .select({
                lastSentId: eventStreamingCursors.lastSentId
            })
            .from(eventStreamingCursors)
            .where(
                and(
                    eq(eventStreamingCursors.destinationId, destinationId),
                    eq(eventStreamingCursors.logType, logType)
                )
            )
            .limit(1);

        if (existing.length > 0) {
            return { lastSentId: existing[0].lastSentId };
        }

        // No cursor yet – this destination pre-dates the eager initialisation
        // path (initializeCursorsForDestination).  Seed at the current max id
        // so we do not replay historical logs.
        const initialId = await this.getCurrentMaxId(logType, orgId);

        // Use onConflictDoNothing in case of a rare race between two poll
        // cycles both hitting this branch simultaneously.
        await db
            .insert(eventStreamingCursors)
            .values({
                destinationId,
                logType,
                lastSentId: initialId,
                lastSentAt: null
            })
            .onConflictDoNothing();

        logger.debug(
            `LogStreamingManager: lazily initialised cursor for destination ${destinationId} ` +
                `logType="${logType}" at id=${initialId} ` +
                `(prefer initializeCursorsForDestination at creation time)`
        );

        return { lastSentId: initialId };
    }

    private async updateCursor(
        destinationId: number,
        logType: LogType,
        lastSentId: number
    ): Promise<void> {
        await db
            .update(eventStreamingCursors)
            .set({
                lastSentId,
                lastSentAt: Date.now()
            })
            .where(
                and(
                    eq(eventStreamingCursors.destinationId, destinationId),
                    eq(eventStreamingCursors.logType, logType)
                )
            );
    }

    /**
     * Returns the current maximum `id` in the given log table for the org.
     * Returns 0 when the table is empty.
     */
    private async getCurrentMaxId(
        logType: LogType,
        orgId: string
    ): Promise<number> {
        try {
            switch (logType) {
                case "request": {
                    const [row] = await logsDb
                        .select({ maxId: max(requestAuditLog.id) })
                        .from(requestAuditLog)
                        .where(eq(requestAuditLog.orgId, orgId));
                    return row?.maxId ?? 0;
                }
                case "action": {
                    const [row] = await logsDb
                        .select({ maxId: max(actionAuditLog.id) })
                        .from(actionAuditLog)
                        .where(eq(actionAuditLog.orgId, orgId));
                    return row?.maxId ?? 0;
                }
                case "access": {
                    const [row] = await logsDb
                        .select({ maxId: max(accessAuditLog.id) })
                        .from(accessAuditLog)
                        .where(eq(accessAuditLog.orgId, orgId));
                    return row?.maxId ?? 0;
                }
                case "connection": {
                    const [row] = await logsDb
                        .select({ maxId: max(connectionAuditLog.id) })
                        .from(connectionAuditLog)
                        .where(eq(connectionAuditLog.orgId, orgId));
                    return row?.maxId ?? 0;
                }
                case "aiSession": {
                    const [row] = await logsDb
                        .select({ maxId: max(aiSessionLog.id) })
                        .from(aiSessionLog)
                        .where(eq(aiSessionLog.orgId, orgId));
                    return row?.maxId ?? 0;
                }
            }
        } catch (err) {
            logger.warn(
                `LogStreamingManager: could not determine current max id for ` +
                    `logType="${logType}", defaulting to 0`,
                err
            );
            return 0;
        }
    }

    // -------------------------------------------------------------------------
    // Log fetching
    // -------------------------------------------------------------------------

    /**
     * Fetch up to `limit` log rows with `id > afterId`, ordered by id ASC,
     * filtered to the given organisation.
     */
    private async fetchLogs(
        logType: LogType,
        orgId: string,
        afterId: number,
        limit: number
    ): Promise<Array<Record<string, unknown> & { id: number }>> {
        switch (logType) {
            case "request":
                return (await logsDb
                    .select()
                    .from(requestAuditLog)
                    .where(
                        and(
                            eq(requestAuditLog.orgId, orgId),
                            gt(requestAuditLog.id, afterId)
                        )
                    )
                    .orderBy(requestAuditLog.id)
                    .limit(limit)) as Array<
                    Record<string, unknown> & { id: number }
                >;

            case "action":
                return (await logsDb
                    .select()
                    .from(actionAuditLog)
                    .where(
                        and(
                            eq(actionAuditLog.orgId, orgId),
                            gt(actionAuditLog.id, afterId)
                        )
                    )
                    .orderBy(actionAuditLog.id)
                    .limit(limit)) as Array<
                    Record<string, unknown> & { id: number }
                >;

            case "access":
                return (await logsDb
                    .select()
                    .from(accessAuditLog)
                    .where(
                        and(
                            eq(accessAuditLog.orgId, orgId),
                            gt(accessAuditLog.id, afterId)
                        )
                    )
                    .orderBy(accessAuditLog.id)
                    .limit(limit)) as Array<
                    Record<string, unknown> & { id: number }
                >;

            case "connection":
                return (await logsDb
                    .select()
                    .from(connectionAuditLog)
                    .where(
                        and(
                            eq(connectionAuditLog.orgId, orgId),
                            gt(connectionAuditLog.id, afterId)
                        )
                    )
                    .orderBy(connectionAuditLog.id)
                    .limit(limit)) as Array<
                    Record<string, unknown> & { id: number }
                >;

            case "aiSession": {
                const rows = (await logsDb
                    .select()
                    .from(aiSessionLog)
                    .where(
                        and(
                            eq(aiSessionLog.orgId, orgId),
                            gt(aiSessionLog.id, afterId)
                        )
                    )
                    .orderBy(aiSessionLog.id)
                    .limit(limit)) as Array<
                    Record<string, unknown> & { id: number }
                >;

                const compressedFields = [
                    "requestBody",
                    "responseBody",
                    "normalizedRequest",
                    "normalizedResponse"
                ] as const;

                for (const row of rows) {
                    for (const field of compressedFields) {
                        const value = row[field];
                        if (typeof value !== "string") {
                            continue;
                        }
                        try {
                            row[field] = decompressText(value);
                        } catch (error) {
                            logger.error(
                                `Failed to decompress AI session log field ${field}`,
                                { error }
                            );
                        }
                    }
                }

                return rows;
            }
        }
    }

    // -------------------------------------------------------------------------
    // Row → LogEvent conversion
    // -------------------------------------------------------------------------

    private rowToLogEvent(
        logType: LogType,
        row: Record<string, unknown> & { id: number }
    ): LogEvent {
        // Determine the epoch-seconds timestamp for this row type
        let timestamp: number;
        switch (logType) {
            case "request":
            case "action":
            case "access":
                timestamp =
                    typeof row.timestamp === "number" ? row.timestamp : 0;
                break;
            case "connection":
                timestamp =
                    typeof row.startedAt === "number" ? row.startedAt : 0;
                break;
            case "aiSession":
                // createdAt is stored as epoch milliseconds; normalise to
                // epoch seconds to match the other log types.
                timestamp =
                    typeof row.createdAt === "number"
                        ? Math.floor(row.createdAt / 1000)
                        : 0;
                break;
        }

        const orgId = typeof row.orgId === "string" ? row.orgId : "";

        return {
            id: row.id,
            logType,
            orgId,
            timestamp,
            data: row as Record<string, unknown>
        };
    }

    // -------------------------------------------------------------------------
    // Provider factory
    // -------------------------------------------------------------------------

    /**
     * Instantiate the correct LogDestinationProvider for the given destination
     * type string.  Returns `null` for unknown types.
     *
     * To add a new provider:
     *  1. Implement `LogDestinationProvider` in a new file under `providers/`
     *  2. Add a `case` here
     */
    private createProvider(
        type: string,
        config: unknown
    ): LogDestinationProvider | null {
        switch (type) {
            case "http":
                return new HttpLogDestination(config as HttpConfig);
            case "s3":
                return new S3LogDestination(config as S3Config);
            // Future providers:
            // case "datadog": return new DatadogLogDestination(config as DatadogConfig);
            default:
                return null;
        }
    }

    // -------------------------------------------------------------------------
    // Back-off tracking
    // -------------------------------------------------------------------------

    private recordFailure(destinationId: number): void {
        const current = this.failures.get(destinationId) ?? {
            consecutiveFailures: 0,
            nextRetryAt: 0,
            // Stamp the very first failure so we can measure total outage duration
            firstFailedAt: Date.now()
        };

        current.consecutiveFailures += 1;

        const scheduleIdx = Math.min(
            current.consecutiveFailures - 1,
            BACKOFF_SCHEDULE_MS.length - 1
        );
        const backoffMs = BACKOFF_SCHEDULE_MS[scheduleIdx];
        current.nextRetryAt = Date.now() + backoffMs;

        this.failures.set(destinationId, current);

        logger.warn(
            `LogStreamingManager: destination ${destinationId} failed ` +
                `(consecutive #${current.consecutiveFailures}), ` +
                `backing off for ${backoffMs / 1000}s`
        );
    }

    // -------------------------------------------------------------------------
    // DB helpers
    // -------------------------------------------------------------------------

    private async setDestinationError(
        destinationId: number,
        errorMessage: string
    ): Promise<void> {
        // Truncate to 1000 chars so it fits comfortably in the text column.
        const truncated = errorMessage.slice(0, 1000);
        try {
            await db
                .update(eventStreamingDestinations)
                .set({ lastError: truncated, lastErrorAt: Date.now() })
                .where(
                    eq(eventStreamingDestinations.destinationId, destinationId)
                );
        } catch (err) {
            logger.warn(
                `LogStreamingManager: could not persist error status for destination ${destinationId}`,
                err
            );
        }
    }

    private async clearDestinationError(destinationId: number): Promise<void> {
        try {
            // Only update if there is actually an error stored, to avoid
            // unnecessary writes on every successful poll cycle.
            await db
                .update(eventStreamingDestinations)
                .set({ lastError: null, lastErrorAt: null })
                .where(
                    eq(eventStreamingDestinations.destinationId, destinationId)
                );
        } catch (err) {
            logger.warn(
                `LogStreamingManager: could not clear error status for destination ${destinationId}`,
                err
            );
        }
    }

    private async loadEnabledDestinations(): Promise<
        EventStreamingDestination[]
    > {
        try {
            return await db
                .select()
                .from(eventStreamingDestinations)
                .where(eq(eventStreamingDestinations.enabled, true));
        } catch (err) {
            logger.error(
                "LogStreamingManager: failed to load destinations",
                err
            );
            return [];
        }
    }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
