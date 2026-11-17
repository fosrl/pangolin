import { encodeHexLowerCase } from "@oslojs/encoding";
import { sha256 } from "@oslojs/crypto/sha2";
import { Olm, olms, olmSessions, OlmSession } from "@server/db";
import { db } from "@server/db";
import { eq } from "drizzle-orm";

export const EXPIRES = 1000 * 60 * 60 * 24 * 30;

export async function createOlmSession(
    token: string,
    olmId: string
): Promise<OlmSession> {
    const sessionId = encodeHexLowerCase(
        sha256(new TextEncoder().encode(token))
    );
    const session: OlmSession = {
        sessionId: sessionId,
        olmId,
        expiresAt: new Date(Date.now() + EXPIRES).getTime()
    };
    await db.insert(olmSessions).values(session);
    return session;
}

export async function validateOlmSessionToken(
    token: string
): Promise<SessionValidationResult> {
    return validateOlmSession(
        encodeHexLowerCase(sha256(new TextEncoder().encode(token)))
    );
}

// For callers that only have the hash of the token, like the WebSocket gateway
export async function validateOlmSession(
    sessionId: string
): Promise<SessionValidationResult> {
    const result = await db
        .select({ olm: olms, session: olmSessions })
        .from(olmSessions)
        .innerJoin(olms, eq(olmSessions.olmId, olms.olmId))
        .where(eq(olmSessions.sessionId, sessionId));
    if (result.length < 1) {
        return { session: null, olm: null };
    }
    const { olm, session } = result[0];
    if (Date.now() >= session.expiresAt) {
        await db
            .delete(olmSessions)
            .where(eq(olmSessions.sessionId, session.sessionId));
        return { session: null, olm: null };
    }
    if (Date.now() >= session.expiresAt - EXPIRES / 2) {
        session.expiresAt = new Date(Date.now() + EXPIRES).getTime();
        await db
            .update(olmSessions)
            .set({
                expiresAt: session.expiresAt
            })
            .where(eq(olmSessions.sessionId, session.sessionId));
    }
    return { session, olm };
}

export async function invalidateOlmSession(sessionId: string): Promise<void> {
    await db.delete(olmSessions).where(eq(olmSessions.sessionId, sessionId));
}

export async function invalidateAllOlmSessions(olmId: string): Promise<void> {
    await db.delete(olmSessions).where(eq(olmSessions.olmId, olmId));
}

export type SessionValidationResult =
    | { session: OlmSession; olm: Olm }
    | { session: null; olm: null };
