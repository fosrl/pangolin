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

import { logsDb, sshCommandLog, sshSessionLog } from "@server/db";
import logger from "@server/logger";
import { and, eq, lt, sql } from "drizzle-orm";
import { calculateCutoffTimestamp } from "@server/lib/cleanupLogs";

/** Maximum number of command rows to insert in a single statement. */
const INSERT_BATCH_SIZE = 100;

export interface SshSessionLogRecord {
    sessionId: string;
    orgId: string;
    siteId: number;
    siteResourceId: number | null;
    resourceId: number | null;
    clientId: number | null;
    userId: string | null;
    transport: "ssh" | "browser";
    sourceAddr: string;
    destAddr: string;
    username: string;
    authMethod: string | null;
    keyFingerprint: string | null;
    certKeyId: string | null;
    startedAt: number; // epoch seconds
    endedAt: number | null;
    commands: {
        command: string;
        channel: string;
        inexact: boolean;
        timestamp: number; // epoch seconds
    }[];
}

/**
 * Persist one batch entry for an SSH session. Newt reports long-running
 * sessions once per flush with only the commands recorded since the last
 * flush, so the session row is upserted on (siteId, sessionId): the end time
 * is filled in once known and the command count accumulates.
 */
export async function logSshSession(record: SshSessionLogRecord) {
    const { commands, ...session } = record;

    const [row] = await logsDb
        .insert(sshSessionLog)
        .values({ ...session, commandCount: commands.length })
        .onConflictDoUpdate({
            target: [sshSessionLog.siteId, sshSessionLog.sessionId],
            set: {
                endedAt: sql`coalesce(excluded."endedAt", ${sshSessionLog.endedAt})`,
                commandCount: sql`${sshSessionLog.commandCount} + excluded."commandCount"`
            }
        })
        .returning({ id: sshSessionLog.id });

    if (!row || commands.length === 0) {
        return;
    }

    for (let i = 0; i < commands.length; i += INSERT_BATCH_SIZE) {
        await logsDb.insert(sshCommandLog).values(
            commands.slice(i, i + INSERT_BATCH_SIZE).map((c) => ({
                ...c,
                sshSessionLogId: row.id,
                orgId: record.orgId
            }))
        );
    }
}

export async function cleanUpOldSshSessionLogs(
    orgId: string,
    retentionDays: number
): Promise<void> {
    const cutoffTimestamp = calculateCutoffTimestamp(retentionDays);

    try {
        await logsDb
            .delete(sshCommandLog)
            .where(
                and(
                    lt(sshCommandLog.timestamp, cutoffTimestamp),
                    eq(sshCommandLog.orgId, orgId)
                )
            );
        await logsDb
            .delete(sshSessionLog)
            .where(
                and(
                    lt(sshSessionLog.startedAt, cutoffTimestamp),
                    eq(sshSessionLog.orgId, orgId)
                )
            );
    } catch (error) {
        logger.error("Error cleaning up old SSH session logs:", error);
    }
}
