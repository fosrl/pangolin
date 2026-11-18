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
    orgs,
    resources,
    siteResources,
    sites,
    userOrgs,
    Newt
} from "@server/db";
import { MessageHandler } from "@server/routers/ws";
import { and, eq, inArray } from "drizzle-orm";
import logger from "@server/logger";
import { inflate } from "zlib";
import { promisify } from "util";
import {
    cleanUpOldSshSessionLogs,
    logSshSession
} from "#private/lib/logSshSessionAudit";
import {
    resolveClientsBySourceAddr,
    sourceAddrToIp
} from "#private/lib/resolveClientsBySourceAddr";

export { cleanUpOldSshSessionLogs };

const zlibInflate = promisify(inflate);

const MAX_COMMAND_LENGTH = 4096;

interface SshCommandData {
    command: string;
    channel: string;
    timestamp: string; // ISO 8601 timestamp
    inexact?: boolean;
}

interface SshSessionData {
    sessionId: string;
    sourceAddr: string;
    destAddr: string;
    username: string;
    transport?: string; // "ssh" (default) or "browser"
    authMethod?: string;
    keyFingerprint?: string;
    certKeyId?: string;
    certPrincipals?: string[];
    startedAt: string; // ISO 8601 timestamp
    endedAt?: string; // ISO 8601 timestamp
    commands?: SshCommandData[];
}

async function decompressSshSessionLog(
    compressed: string
): Promise<SshSessionData[]> {
    const compressedBuffer = Buffer.from(compressed, "base64");
    const decompressed = await zlibInflate(compressedBuffer);
    const parsed = JSON.parse(decompressed.toString("utf-8"));

    if (!Array.isArray(parsed)) {
        throw new Error("Decompressed SSH session log data is not an array");
    }

    return parsed;
}

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

/**
 * Native SSH certificates are issued with principals [username, resource
 * niceId], so any principal other than the login username names the site
 * resource (or, for browser gateway sessions, the public resource) the
 * session was opened for.
 */
function resourceNiceIdCandidates(session: SshSessionData): string[] {
    return (session.certPrincipals ?? []).filter(
        (p) => typeof p === "string" && p !== "" && p !== session.username
    );
}

export const handleSshSessionLogMessage: MessageHandler = async (context) => {
    const { message, client } = context;
    const newt = client as Newt;

    if (!newt) {
        logger.warn("SSH session log received but no newt client in context");
        return;
    }

    if (!newt.siteId) {
        logger.warn("SSH session log received but newt has no siteId");
        return;
    }

    if (!message.data?.compressed) {
        logger.warn("SSH session log message missing compressed data");
        return;
    }

    const [site] = await db
        .select({
            orgId: sites.orgId,
            orgSubnet: orgs.subnet,
            settingsLogRetentionDaysSsh: orgs.settingsLogRetentionDaysSsh
        })
        .from(sites)
        .innerJoin(orgs, eq(sites.orgId, orgs.orgId))
        .where(eq(sites.siteId, newt.siteId));

    if (!site) {
        logger.warn(
            `SSH session log received but site ${newt.siteId} not found in database`
        );
        return;
    }

    const orgId = site.orgId;
    const siteId = newt.siteId;

    if (site.settingsLogRetentionDaysSsh === 0) {
        logger.debug(
            `SSH session log retention is disabled for org ${orgId}, skipping`
        );
        return;
    }

    let sessions: SshSessionData[];
    try {
        sessions = await decompressSshSessionLog(message.data.compressed);
    } catch (error) {
        logger.error("Failed to decompress SSH session log data:", error);
        return;
    }

    if (sessions.length === 0) {
        return;
    }

    // Browser gateway sessions arrive from the Pangolin side of the tunnel,
    // so their source address never belongs to a client.
    const ipToClient = await resolveClientsBySourceAddr({
        orgId,
        orgSubnet: site.orgSubnet,
        siteId,
        sourceAddrs: sessions
            .filter((s) => s.transport !== "browser")
            .map((s) => s.sourceAddr)
    });

    const niceIds = new Set<string>();
    for (const session of sessions) {
        for (const niceId of resourceNiceIdCandidates(session)) {
            niceIds.add(niceId);
        }
    }
    const niceIdToSiteResource = new Map<string, number>();
    const niceIdToResource = new Map<string, number>();
    if (niceIds.size > 0) {
        const [matchedSiteResources, matchedResources] = await Promise.all([
            db
                .select({
                    siteResourceId: siteResources.siteResourceId,
                    niceId: siteResources.niceId
                })
                .from(siteResources)
                .where(
                    and(
                        eq(siteResources.orgId, orgId),
                        inArray(siteResources.niceId, Array.from(niceIds))
                    )
                ),
            db
                .select({
                    resourceId: resources.resourceId,
                    niceId: resources.niceId
                })
                .from(resources)
                .where(
                    and(
                        eq(resources.orgId, orgId),
                        inArray(resources.niceId, Array.from(niceIds))
                    )
                )
        ]);
        for (const r of matchedSiteResources) {
            niceIdToSiteResource.set(r.niceId, r.siteResourceId);
        }
        for (const r of matchedResources) {
            niceIdToResource.set(r.niceId, r.resourceId);
        }
    }

    // Pangolin-issued certificates in push mode log in as the user's
    // generated PAM username, which is unique within the org. This identifies
    // the user when no client does, e.g. for browser sessions.
    const usernames = Array.from(new Set(sessions.map((s) => s.username)));
    const pamUsernameToUser = new Map<string, string>();
    if (usernames.length > 0) {
        const matched = await db
            .select({
                userId: userOrgs.userId,
                pamUsername: userOrgs.pamUsername
            })
            .from(userOrgs)
            .where(
                and(
                    eq(userOrgs.orgId, orgId),
                    inArray(userOrgs.pamUsername, usernames)
                )
            );
        for (const u of matched) {
            if (u.pamUsername) {
                pamUsernameToUser.set(u.pamUsername, u.userId);
            }
        }
    }

    let written = 0;
    for (const session of sessions) {
        if (
            !session.sessionId ||
            !session.sourceAddr ||
            !session.destAddr ||
            !session.username
        ) {
            logger.debug(
                `Skipping SSH session log with missing required fields: ${session.sessionId}`
            );
            continue;
        }

        const startedAt = toEpochSeconds(session.startedAt);
        if (startedAt === null) {
            logger.debug(
                `Skipping SSH session log with invalid startedAt: ${session.startedAt}`
            );
            continue;
        }

        const commands = (session.commands ?? []).flatMap((c) => {
            const timestamp = toEpochSeconds(c.timestamp);
            if (typeof c.command !== "string" || timestamp === null) {
                return [];
            }
            return [
                {
                    command: c.command.slice(0, MAX_COMMAND_LENGTH),
                    channel: c.channel === "exec" ? "exec" : "shell",
                    inexact: c.inexact === true,
                    timestamp
                }
            ];
        });

        const transport = session.transport === "browser" ? "browser" : "ssh";
        const clientInfo =
            transport === "ssh"
                ? (ipToClient.get(sourceAddrToIp(session.sourceAddr)) ?? null)
                : null;
        const userId =
            clientInfo?.userId ??
            pamUsernameToUser.get(session.username) ??
            null;

        // Browser gateway sessions are for public resources; native SSH over
        // a client is for site resources.
        const candidates = resourceNiceIdCandidates(session);
        const firstMatch = (m: Map<string, number>) =>
            candidates
                .map((niceId) => m.get(niceId))
                .find((id) => id !== undefined) ?? null;
        const resourceId =
            transport === "browser" ? firstMatch(niceIdToResource) : null;
        const siteResourceId =
            resourceId === null ? firstMatch(niceIdToSiteResource) : null;

        try {
            await logSshSession({
                sessionId: session.sessionId,
                orgId,
                siteId,
                siteResourceId,
                resourceId,
                clientId: clientInfo?.clientId ?? null,
                userId,
                transport,
                sourceAddr: session.sourceAddr,
                destAddr: session.destAddr,
                username: session.username,
                authMethod: session.authMethod || null,
                keyFingerprint: session.keyFingerprint || null,
                certKeyId: session.certKeyId || null,
                startedAt,
                endedAt: toEpochSeconds(session.endedAt),
                commands
            });
            written++;
        } catch (error) {
            logger.error(
                `Failed to write SSH session log ${session.sessionId}:`,
                error
            );
        }
    }

    logger.debug(
        `Wrote ${written} SSH session log record(s) from newt ${newt.newtId} (site ${siteId})`
    );
};
