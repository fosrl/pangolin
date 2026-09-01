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

import { logsDb, db, orgs, aiSessionLog, type AiProvider } from "@server/db";
import type { InferInsertModel } from "drizzle-orm";
import logger from "@server/logger";
import { and, eq, lt } from "drizzle-orm";
import cache from "#private/lib/cache";
import { calculateCutoffTimestamp } from "@server/lib/cleanupLogs";
import { sanitizeString } from "@server/lib/sanitize";
import { compressText } from "@server/lib/textCompression";
import type { AiCapability } from "@server/lib/aiCapabilities";
import {
    normalizeAiRequest,
    normalizeAiResponse
} from "@server/lib/aiMessageNormalization";

// Caps how much of the request/response body we keep per row, so a single
// huge multimodal payload can't blow up buffer memory or storage.
const AI_SESSION_LOG_MAX_BODY_CHARS = 200_000;

type AiSessionLogInsert = InferInsertModel<typeof aiSessionLog>;

// In-memory buffer for batching AI session log inserts, mirroring the
// approach in server/routers/badger/logRequestAudit.ts.
const sessionLogBuffer: AiSessionLogInsert[] = [];

const BATCH_SIZE = 100; // Write to DB every 100 logs
const BATCH_INTERVAL_MS = 5000; // Or every 5 seconds, whichever comes first
const MAX_BUFFER_SIZE = 10000; // Prevent unbounded memory growth
let flushTimer: NodeJS.Timeout | null = null;
let isFlushInProgress = false;

/**
 * Flush buffered logs to database
 */
async function flushSessionLogs() {
    if (sessionLogBuffer.length === 0 || isFlushInProgress) {
        return;
    }

    isFlushInProgress = true;

    // Take all current logs and clear buffer
    const logsToWrite = sessionLogBuffer.splice(0, sessionLogBuffer.length);

    try {
        // Use a transaction to ensure all inserts succeed or fail together
        await logsDb.transaction(async (tx) => {
            // Batch insert logs in groups of 25 to avoid overwhelming the database
            const BATCH_DB_SIZE = 25;
            for (let i = 0; i < logsToWrite.length; i += BATCH_DB_SIZE) {
                const batch = logsToWrite.slice(i, i + BATCH_DB_SIZE);
                await tx.insert(aiSessionLog).values(batch);
            }
        });
        logger.debug(
            `Flushed ${logsToWrite.length} AI session logs to database`
        );
    } catch (error) {
        logger.error("Error flushing AI session logs:", error);
        // On transaction error, put logs back at the front of the buffer to retry
        // but only if buffer isn't too large
        if (sessionLogBuffer.length < MAX_BUFFER_SIZE - logsToWrite.length) {
            sessionLogBuffer.unshift(...logsToWrite);
            logger.info(
                `Re-queued ${logsToWrite.length} AI session logs for retry`
            );
        } else {
            logger.error(
                `Buffer full, dropped ${logsToWrite.length} AI session logs`
            );
        }
    } finally {
        isFlushInProgress = false;
        // If buffer filled up while we were flushing, flush again
        if (sessionLogBuffer.length >= BATCH_SIZE) {
            flushSessionLogs().catch((err) =>
                logger.error("Error in follow-up AI session log flush:", err)
            );
        }
    }
}

/**
 * Schedule a flush if not already scheduled
 */
function scheduleFlush() {
    if (flushTimer === null) {
        flushTimer = setTimeout(() => {
            flushTimer = null;
            flushSessionLogs().catch((err) =>
                logger.error("Error in scheduled AI session log flush:", err)
            );
        }, BATCH_INTERVAL_MS);
    }
}

/**
 * Gracefully flush all pending logs (call this on shutdown)
 */
export async function shutdownAiSessionLogger() {
    if (flushTimer) {
        clearTimeout(flushTimer);
        flushTimer = null;
    }
    // Force flush even if one is in progress by waiting and retrying
    while (isFlushInProgress) {
        await new Promise((resolve) => setTimeout(resolve, 100));
    }
    await flushSessionLogs();
}

async function getRetentionDays(orgId: string): Promise<number> {
    // check cache first
    const cached = await cache.get<number>(`org_${orgId}_aiSessionsDays`);
    if (cached !== undefined) {
        return cached;
    }

    const [org] = await db
        .select({
            settingsLogRetentionDaysAISessions:
                orgs.settingsLogRetentionDaysAISessions
        })
        .from(orgs)
        .where(eq(orgs.orgId, orgId))
        .limit(1);

    if (!org) {
        return 0;
    }

    // store the result in cache
    await cache.set(
        `org_${orgId}_aiSessionsDays`,
        org.settingsLogRetentionDaysAISessions,
        300
    );

    return org.settingsLogRetentionDaysAISessions;
}

export async function cleanUpOldLogs(orgId: string, retentionDays: number) {
    const cutoffTimestamp = calculateCutoffTimestamp(retentionDays);

    try {
        await logsDb
            .delete(aiSessionLog)
            .where(
                and(
                    lt(aiSessionLog.createdAt, cutoffTimestamp),
                    eq(aiSessionLog.orgId, orgId)
                )
            );
    } catch (error) {
        logger.error("Error cleaning up old AI session logs:", error);
    }
}

function truncateBody(value: string): { value: string; truncated: boolean } {
    if (value.length <= AI_SESSION_LOG_MAX_BODY_CHARS) {
        return { value, truncated: false };
    }
    return {
        value: value.slice(0, AI_SESSION_LOG_MAX_BODY_CHARS),
        truncated: true
    };
}

export function logAiSession(data: {
    sessionId: string;
    capability: AiCapability;
    provider: AiProvider;
    requestedModel: string | undefined;
    requestBody: unknown;
    responseText: string;
    isStream: boolean;
    statusCode: number;
    orgId: string | null;
    resourceId: number | null;
    siteResourceId: number | null;
    requestUserId: string | null;
    virtualApiKeyId: string | null;
}): void {
    (async () => {
        try {
            // Check retention before buffering any logs
            if (data.orgId) {
                const retentionDays = await getRetentionDays(data.orgId);
                if (retentionDays === 0) {
                    // do not log
                    return;
                }
            } else {
                // No org resolved for this request - nothing to govern
                // retention with, so don't log it.
                return;
            }

            const requestBodyText = truncateBody(
                JSON.stringify(data.requestBody ?? "")
            );
            const responseBodyText = truncateBody(data.responseText ?? "");

            // Uniform, capability-agnostic transcript for search/display -
            // computed from the untruncated originals so normalization sees
            // the full content; the normalized result gets its own
            // (typically much smaller) truncation pass below.
            const normalizedRequestMessages = normalizeAiRequest(
                data.capability,
                data.requestBody
            );
            const normalizedResponseMessages = normalizeAiResponse(
                data.capability,
                data.responseText ?? "",
                data.isStream
            );
            const normalizedRequestText = normalizedRequestMessages
                ? truncateBody(JSON.stringify(normalizedRequestMessages))
                : null;
            const normalizedResponseText = normalizedResponseMessages
                ? truncateBody(JSON.stringify(normalizedResponseMessages))
                : null;

            // Prevent unbounded buffer growth - drop oldest entries if buffer is too large
            if (sessionLogBuffer.length >= MAX_BUFFER_SIZE) {
                const dropped = sessionLogBuffer.splice(0, BATCH_SIZE);
                logger.warn(
                    `AI session log buffer exceeded max size (${MAX_BUFFER_SIZE}), dropped ${dropped.length} oldest entries`
                );
            }

            const timestamp = Math.floor(Date.now() / 1000);

            sessionLogBuffer.push({
                sessionId: data.sessionId,
                orgId: sanitizeString(data.orgId),
                providerId: data.provider.providerId,
                capability: data.capability,
                resourceId: data.resourceId ?? undefined,
                siteResourceId: data.siteResourceId ?? undefined,
                userId: sanitizeString(data.requestUserId ?? undefined),
                virtualApiKeyId: sanitizeString(
                    data.virtualApiKeyId ?? undefined
                ),
                requestedModel: sanitizeString(data.requestedModel),
                isStream: data.isStream,
                requestBody: compressText(
                    sanitizeString(requestBodyText.value)
                ),
                responseBody: compressText(
                    sanitizeString(responseBodyText.value)
                ),
                normalizedRequest: normalizedRequestText
                    ? compressText(sanitizeString(normalizedRequestText.value))
                    : undefined,
                normalizedResponse: normalizedResponseText
                    ? compressText(
                          sanitizeString(normalizedResponseText.value)
                      )
                    : undefined,
                truncated:
                    requestBodyText.truncated ||
                    responseBodyText.truncated ||
                    (normalizedRequestText?.truncated ?? false) ||
                    (normalizedResponseText?.truncated ?? false),
                statusCode: data.statusCode,
                createdAt: timestamp
            });

            // Flush immediately if buffer is full, otherwise schedule a flush
            if (sessionLogBuffer.length >= BATCH_SIZE) {
                flushSessionLogs().catch((err) =>
                    logger.error("Error flushing AI session logs:", err)
                );
            } else {
                scheduleFlush();
            }
        } catch (error) {
            logger.error("Failed to log AI session", { error });
        }
    })();
}
