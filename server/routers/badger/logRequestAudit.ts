import { logsDb, primaryLogsDb, db, orgs, requestAuditLog } from "@server/db";
import logger from "@server/logger";
import { and, eq, lt, sql } from "drizzle-orm";
import cache from "#dynamic/lib/cache";
import { calculateCutoffTimestamp } from "@server/lib/cleanupLogs";
import { stripPortFromHost } from "@server/lib/ip";
import {
    buildAuditLogEntry,
    type LogRequestAuditBody,
    type LogRequestAuditData
} from "./auditLogEntry";

/**

Reasons:
100 - Allowed by Rule
101 - Allowed No Auth
102 - Valid Access Token
103 - Valid Header Auth (HTTP Basic Auth)
104 - Valid Pincode
105 - Valid Password
106 - Valid email
107 - Valid SSO
108 - Connected Client
109 - Valid Virtual API Key

201 - Resource Not Found
202 - Resource Blocked
203 - Dropped by Rule
204 - No Sessions
205 - Temporary Request Token
299 - No More Auth Methods

 */

// In-memory buffer for batching audit logs
const auditLogBuffer: Array<{
    timestamp: number;
    orgId?: string;
    actorType?: string;
    actor?: string;
    actorId?: string;
    metadata: any;
    action: boolean;
    resourceId?: number;
    siteResourceId?: number;
    reason: number;
    location?: string;
    originalRequestURL: string;
    scheme: string;
    host: string;
    path: string;
    method: string;
    ip?: string;
    tls: boolean;
    userAgent?: string;
    headers?: string;
    query?: string;
}> = [];

const BATCH_SIZE = 100; // Write to DB every 100 logs
const BATCH_INTERVAL_MS = 5000; // Or every 5 seconds, whichever comes first
const MAX_BUFFER_SIZE = 10000; // Prevent unbounded memory growth
let flushTimer: NodeJS.Timeout | null = null;
let isFlushInProgress = false;

/**
 * Flush buffered logs to database
 */
async function flushAuditLogs() {
    if (auditLogBuffer.length === 0 || isFlushInProgress) {
        return;
    }

    isFlushInProgress = true;

    // Take all current logs and clear buffer
    const logsToWrite = auditLogBuffer.splice(0, auditLogBuffer.length);

    try {
        // Use a transaction to ensure all inserts succeed or fail together
        // This prevents index corruption from partial writes
        await logsDb.transaction(async (tx) => {
            // Batch insert logs in groups of 25 to avoid overwhelming the database
            const BATCH_DB_SIZE = 25;
            for (let i = 0; i < logsToWrite.length; i += BATCH_DB_SIZE) {
                const batch = logsToWrite.slice(i, i + BATCH_DB_SIZE);
                await tx.insert(requestAuditLog).values(batch);
            }
        });
        logger.debug(`Flushed ${logsToWrite.length} audit logs to database`);
    } catch (error) {
        logger.error("Error flushing audit logs:", error);
        // On transaction error, put logs back at the front of the buffer to retry
        // but only if buffer isn't too large
        if (auditLogBuffer.length < MAX_BUFFER_SIZE - logsToWrite.length) {
            auditLogBuffer.unshift(...logsToWrite);
            logger.info(`Re-queued ${logsToWrite.length} audit logs for retry`);
        } else {
            logger.error(
                `Buffer full, dropped ${logsToWrite.length} audit logs`
            );
        }
    } finally {
        isFlushInProgress = false;
        // If buffer filled up while we were flushing, flush again
        if (auditLogBuffer.length >= BATCH_SIZE) {
            flushAuditLogs().catch((err) =>
                logger.error("Error in follow-up flush:", err)
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
            flushAuditLogs().catch((err) =>
                logger.error("Error in scheduled flush:", err)
            );
        }, BATCH_INTERVAL_MS);
    }
}

/**
 * Gracefully flush all pending logs (call this on shutdown)
 */
export async function shutdownAuditLogger() {
    if (flushTimer) {
        clearTimeout(flushTimer);
        flushTimer = null;
    }
    // Force flush even if one is in progress by waiting and retrying
    while (isFlushInProgress) {
        await new Promise((resolve) => setTimeout(resolve, 100));
    }
    await flushAuditLogs();
}

async function getRetentionDays(orgId: string): Promise<number> {
    // check cache first
    const cached = await cache.get<number>(`org_${orgId}_retentionDays`);
    if (cached !== undefined) {
        return cached;
    }

    const [org] = await db
        .select({
            settingsLogRetentionDaysRequest:
                orgs.settingsLogRetentionDaysRequest
        })
        .from(orgs)
        .where(eq(orgs.orgId, orgId))
        .limit(1);

    if (!org) {
        return 0;
    }

    // store the result in cache
    await cache.set(
        `org_${orgId}_retentionDays`,
        org.settingsLogRetentionDaysRequest,
        300
    );

    return org.settingsLogRetentionDaysRequest;
}

export async function cleanUpOldLogs(orgId: string, retentionDays: number) {
    const cutoffTimestamp = calculateCutoffTimestamp(retentionDays);

    try {
        await logsDb
            .delete(requestAuditLog)
            .where(
                and(
                    lt(requestAuditLog.timestamp, cutoffTimestamp),
                    eq(requestAuditLog.orgId, orgId)
                )
            );

        // logger.debug(
        //     `Cleaned up request audit logs older than ${retentionDays} days`
        // );
    } catch (error) {
        logger.error("Error cleaning up old request audit logs:", error);
    }
}

export type { LogRequestAuditData, LogRequestAuditBody };

export async function logRequestAudit(
    data: LogRequestAuditData,
    body: LogRequestAuditBody
) {
    try {
        // Check retention before buffering any logs
        if (data.orgId) {
            const retentionDays = await getRetentionDays(data.orgId);
            if (retentionDays === 0) {
                // do not log
                return;
            }
        }

        // Prevent unbounded buffer growth - drop oldest entries if buffer is too large
        if (auditLogBuffer.length >= MAX_BUFFER_SIZE) {
            const dropped = auditLogBuffer.splice(0, BATCH_SIZE);
            logger.warn(
                `Audit log buffer exceeded max size (${MAX_BUFFER_SIZE}), dropped ${dropped.length} oldest entries`
            );
        }

        const clientIp = body.requestIp
            ? stripPortFromHost(body.requestIp)
            : undefined;

        // Add to buffer instead of writing directly to DB
        auditLogBuffer.push(buildAuditLogEntry(data, body, clientIp));
        // Flush immediately if buffer is full, otherwise schedule a flush
        if (auditLogBuffer.length >= BATCH_SIZE) {
            // Fire and forget - don't block the caller
            flushAuditLogs().catch((err) =>
                logger.error("Error flushing audit logs:", err)
            );
        } else {
            scheduleFlush();
        }
    } catch (error) {
        logger.error(error);
    }
}
