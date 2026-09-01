import { logsDb, primaryLogsDb, db, orgs, requestAuditLog } from "@server/db";
import logger from "@server/logger";
import { and, eq, lt, sql } from "drizzle-orm";
import cache from "#dynamic/lib/cache";
import { calculateCutoffTimestamp } from "@server/lib/cleanupLogs";
import { stripPortFromHost } from "@server/lib/ip";

import { sanitizeString } from "@server/lib/sanitize";

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

export async function logRequestAudit(
    data: {
        action: boolean;
        reason: number;
        resourceId?: number;
        siteResourceId?: number;
        orgId?: string;
        location?: string;
        user?: { username: string; userId: string };
        apiKey?: { name: string | null; apiKeyId: string };
        metadata?: any;
        // userAgent?: string;
    },
    body: {
        path: string;
        originalRequestURL: string;
        scheme: string;
        host: string;
        method: string;
        tls: boolean;
        sessions?: Record<string, string>;
        headers?: Record<string, string>;
        query?: Record<string, string>;
        requestIp?: string;
    }
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

        let actorType: string | undefined;
        let actor: string | undefined;
        let actorId: string | undefined;

        const user = data.user;
        if (user) {
            actorType = "user";
            actor = user.username;
            actorId = user.userId;
        }
        const apiKey = data.apiKey;
        if (apiKey) {
            actorType = "apiKey";
            actor = apiKey.name || apiKey.apiKeyId;
            actorId = apiKey.apiKeyId;
        }

        const timestamp = Math.floor(Date.now() / 1000);

        let metadata = null;
        if (data.metadata) {
            metadata = JSON.stringify(data.metadata);
        }

        const clientIp = body.requestIp
            ? stripPortFromHost(body.requestIp)
            : undefined;

        // Prevent unbounded buffer growth - drop oldest entries if buffer is too large
        if (auditLogBuffer.length >= MAX_BUFFER_SIZE) {
            const dropped = auditLogBuffer.splice(0, BATCH_SIZE);
            logger.warn(
                `Audit log buffer exceeded max size (${MAX_BUFFER_SIZE}), dropped ${dropped.length} oldest entries`
            );
        }

        // Add to buffer instead of writing directly to DB
        auditLogBuffer.push({
            timestamp,
            orgId: sanitizeString(data.orgId),
            actorType: sanitizeString(actorType),
            actor: sanitizeString(actor),
            actorId: sanitizeString(actorId),
            metadata: sanitizeString(metadata),
            action: data.action,
            resourceId: data.resourceId,
            siteResourceId: data.siteResourceId,
            reason: data.reason,
            location: sanitizeString(data.location),
            originalRequestURL: sanitizeString(body.originalRequestURL) ?? "",
            scheme: sanitizeString(body.scheme) ?? "",
            host: sanitizeString(body.host) ?? "",
            path: sanitizeString(body.path) ?? "",
            method: sanitizeString(body.method) ?? "",
            ip: sanitizeString(clientIp),
            tls: body.tls
        });
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
