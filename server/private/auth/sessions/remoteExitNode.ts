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

import { encodeHexLowerCase } from "@oslojs/encoding";
import { sha256 } from "@oslojs/crypto/sha2";
import {
    RemoteExitNode,
    remoteExitNodes,
    remoteExitNodeSessions,
    RemoteExitNodeSession
} from "@server/db";
import { db } from "@server/db";
import { eq } from "drizzle-orm";

export const EXPIRES = 1000 * 60 * 60 * 24 * 30;

export async function createRemoteExitNodeSession(
    token: string,
    remoteExitNodeId: string
): Promise<RemoteExitNodeSession> {
    const sessionId = encodeHexLowerCase(
        sha256(new TextEncoder().encode(token))
    );
    const session: RemoteExitNodeSession = {
        sessionId: sessionId,
        remoteExitNodeId,
        expiresAt: new Date(Date.now() + EXPIRES).getTime()
    };
    await db.insert(remoteExitNodeSessions).values(session);
    return session;
}

export async function validateRemoteExitNodeSessionToken(
    token: string
): Promise<SessionValidationResult> {
    return validateRemoteExitNodeSession(
        encodeHexLowerCase(sha256(new TextEncoder().encode(token)))
    );
}

// For callers that only have the hash of the token, like the WebSocket gateway
export async function validateRemoteExitNodeSession(
    sessionId: string
): Promise<SessionValidationResult> {
    const result = await db
        .select({
            remoteExitNode: remoteExitNodes,
            session: remoteExitNodeSessions
        })
        .from(remoteExitNodeSessions)
        .innerJoin(
            remoteExitNodes,
            eq(
                remoteExitNodeSessions.remoteExitNodeId,
                remoteExitNodes.remoteExitNodeId
            )
        )
        .where(eq(remoteExitNodeSessions.sessionId, sessionId));
    if (result.length < 1) {
        return { session: null, remoteExitNode: null };
    }
    const { remoteExitNode, session } = result[0];
    if (Date.now() >= session.expiresAt) {
        await db
            .delete(remoteExitNodeSessions)
            .where(eq(remoteExitNodeSessions.sessionId, session.sessionId));
        return { session: null, remoteExitNode: null };
    }
    if (Date.now() >= session.expiresAt - EXPIRES / 2) {
        session.expiresAt = new Date(Date.now() + EXPIRES).getTime();
        await db
            .update(remoteExitNodeSessions)
            .set({
                expiresAt: session.expiresAt
            })
            .where(eq(remoteExitNodeSessions.sessionId, session.sessionId));
    }
    return { session, remoteExitNode };
}

export async function invalidateRemoteExitNodeSession(
    sessionId: string
): Promise<void> {
    await db
        .delete(remoteExitNodeSessions)
        .where(eq(remoteExitNodeSessions.sessionId, sessionId));
}

export async function invalidateAllRemoteExitNodeSessions(
    remoteExitNodeId: string
): Promise<void> {
    await db
        .delete(remoteExitNodeSessions)
        .where(eq(remoteExitNodeSessions.remoteExitNodeId, remoteExitNodeId));
}

export type SessionValidationResult =
    | { session: RemoteExitNodeSession; remoteExitNode: RemoteExitNode }
    | { session: null; remoteExitNode: null };
