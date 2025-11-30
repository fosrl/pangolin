import { encodeHexLowerCase } from "@oslojs/encoding";
import { sha256 } from "@oslojs/crypto/sha2";
import { resourceSessions, ResourceSession } from "@server/db";
import { db } from "@server/db";
import { eq, and } from "drizzle-orm";
import config from "@server/lib/config";

export const SESSION_COOKIE_NAME =
    config.getRawConfig().server.session_cookie_name;
export const SESSION_COOKIE_EXPIRES =
    1000 * 60 * 60 * config.getRawConfig().server.resource_session_length_hours;

export async function createResourceSession(opts: {
    token: string;
    resourceId: number;
    isRequestToken?: boolean;
    passwordId?: number | null;
    pincodeId?: number | null;
    userSessionId?: string | null;
    whitelistId?: number | null;
    accessTokenId?: string | null;
    doNotExtend?: boolean;
    expiresAt?: number | null;
    sessionLength?: number | null;
}): Promise<ResourceSession> {
    if (
        !opts.passwordId &&
        !opts.pincodeId &&
        !opts.whitelistId &&
        !opts.accessTokenId &&
        !opts.userSessionId
    ) {
        throw new Error("Auth method must be provided");
    }

    const sessionId = encodeHexLowerCase(
        sha256(new TextEncoder().encode(opts.token))
    );

    const session: ResourceSession = {
        sessionId: sessionId,
        expiresAt:
            opts.expiresAt ||
            new Date(Date.now() + SESSION_COOKIE_EXPIRES).getTime(),
        sessionLength: opts.sessionLength || SESSION_COOKIE_EXPIRES,
        resourceId: opts.resourceId,
        passwordId: opts.passwordId || null,
        pincodeId: opts.pincodeId || null,
        whitelistId: opts.whitelistId || null,
        doNotExtend: opts.doNotExtend || false,
        accessTokenId: opts.accessTokenId || null,
        isRequestToken: opts.isRequestToken || false,
        userSessionId: opts.userSessionId || null,
        issuedAt: new Date().getTime()
    };

    await db.insert(resourceSessions).values(session);

    return session;
}

export async function validateResourceSessionToken(
    token: string,
    resourceId: number
): Promise<ResourceSessionValidationResult> {
    const sessionId = encodeHexLowerCase(
        sha256(new TextEncoder().encode(token))
    );
    const result = await db
        .select()
        .from(resourceSessions)
        .where(
            and(
                eq(resourceSessions.sessionId, sessionId),
                eq(resourceSessions.resourceId, resourceId)
            )
        );

    if (result.length < 1) {
        return { resourceSession: null };
    }

    const resourceSession = result[0];

    if (Date.now() >= resourceSession.expiresAt) {
        await db
            .delete(resourceSessions)
            .where(eq(resourceSessions.sessionId, resourceSessions.sessionId));
        return { resourceSession: null };
    } else if (
        Date.now() >=
        resourceSession.expiresAt - resourceSession.sessionLength / 2
    ) {
        if (!resourceSession.doNotExtend) {
            resourceSession.expiresAt = new Date(
                Date.now() + resourceSession.sessionLength
            ).getTime();
            await db
                .update(resourceSessions)
                .set({
                    expiresAt: resourceSession.expiresAt
                })
                .where(
                    eq(resourceSessions.sessionId, resourceSession.sessionId)
                );
        }
    }

    return { resourceSession };
}

export async function invalidateResourceSession(
    sessionId: string
): Promise<void> {
    await db
        .delete(resourceSessions)
        .where(eq(resourceSessions.sessionId, sessionId));
}

export async function invalidateAllSessions(
    resourceId: number,
    method?: {
        passwordId?: number;
        pincodeId?: number;
        whitelistId?: number;
    }
): Promise<void> {
    if (method?.passwordId) {
        await db
            .delete(resourceSessions)
            .where(
                and(
                    eq(resourceSessions.resourceId, resourceId),
                    eq(resourceSessions.passwordId, method.passwordId)
                )
            );
    }

    if (method?.pincodeId) {
        await db
            .delete(resourceSessions)
            .where(
                and(
                    eq(resourceSessions.resourceId, resourceId),
                    eq(resourceSessions.pincodeId, method.pincodeId)
                )
            );
    }

    if (method?.whitelistId) {
        await db
            .delete(resourceSessions)
            .where(
                and(
                    eq(resourceSessions.resourceId, resourceId),
                    eq(resourceSessions.whitelistId, method.whitelistId)
                )
            );
    }
    if (!method?.passwordId && !method?.pincodeId && !method?.whitelistId) {
        await db
            .delete(resourceSessions)
            .where(eq(resourceSessions.resourceId, resourceId));
    }
}

export function serializeResourceSessionCookie(
    cookieName: string,
    domain: string,
    token: string,
    isHttp: boolean = false,
    expiresAt?: Date
): string {
    const now = new Date().getTime();
    if (!isHttp) {
        if (expiresAt === undefined) {
            return `${cookieName}_s.${now}=${token}; HttpOnly; SameSite=Lax; Path=/; Secure; Domain=${domain}`;
        }
        return `${cookieName}_s.${now}=${token}; HttpOnly; SameSite=Lax; Expires=${expiresAt.toUTCString()}; Path=/; Secure; Domain=${domain}`;
    } else {
        if (expiresAt === undefined) {
            return `${cookieName}.${now}=${token}; HttpOnly; SameSite=Lax; Path=/; Domain=$domain}`;
        }
        return `${cookieName}.${now}=${token}; HttpOnly; SameSite=Lax; Expires=${expiresAt.toUTCString()}; Path=/; Domain=${domain}`;
    }
}

export function createBlankResourceSessionTokenCookie(
    cookieName: string,
    domain: string,
    isHttp: boolean = false
): string {
    if (!isHttp) {
        return `${cookieName}_s=; HttpOnly; SameSite=Lax; Max-Age=0; Path=/; Secure; Domain=${domain}`;
    } else {
        return `${cookieName}=; HttpOnly; SameSite=Lax; Max-Age=0; Path=/; Domain=${domain}`;
    }
}

export type ResourceSessionValidationResult = {
    resourceSession: ResourceSession | null;
};
