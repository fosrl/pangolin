import {
    db,
    idp,
    idpGrants,
    idpOidcConfig,
    IdpOidcConfig,
    primaryDb,
    resourceSessions,
    safeRead,
    sessionIdpGrants,
    sessions
} from "@server/db";
import config from "@server/lib/config";
import { decrypt, encrypt } from "@server/lib/crypto";
import logger from "@server/logger";
import { encodeBase32LowerCaseNoPadding, encodeBase64 } from "@oslojs/encoding";
import * as arctic from "arctic";
import { and, eq, inArray, isNull, lt, or } from "drizzle-orm";

const REVALIDATION_INTERVAL_MS =
    1000 * 60 * config.getRawConfig().server.idp_session_revalidation_minutes;

const RETRY_INTERVAL_MS = Math.min(1000 * 60, REVALIDATION_INTERVAL_MS);

const TOKEN_REQUEST_TIMEOUT_MS = 1000 * 10;

const LEASE_MS = 1000 * 60;

const inFlight = new Map<string, Promise<boolean>>();

function randomId(): string {
    return encodeBase32LowerCaseNoPadding(
        crypto.getRandomValues(new Uint8Array(20))
    );
}

export async function storeIdpRefreshToken(
    sessionId: string,
    idpId: number,
    tokens: arctic.OAuth2Tokens
): Promise<void> {
    const [existingIdp] = await db
        .select({ sessionRevalidation: idp.sessionRevalidation })
        .from(idp)
        .where(eq(idp.idpId, idpId))
        .limit(1);

    if (!existingIdp?.sessionRevalidation) {
        return;
    }

    if (!tokens.hasRefreshToken()) {
        logger.debug("IdP returned no refresh token", { idpId });
        return;
    }

    const grantId = randomId();
    const key = config.getRawConfig().server.secret!;
    await db.transaction(async (trx) => {
        await trx.insert(idpGrants).values({
            grantId,
            idpId,
            refreshToken: encrypt(tokens.refreshToken(), key),
            validatedAt: Date.now()
        });
        await trx.insert(sessionIdpGrants).values({ sessionId, grantId });
    });
}

export async function clearIdpSessionGrants(idpId: number): Promise<void> {
    await db.delete(idpGrants).where(eq(idpGrants.idpId, idpId));
}

export async function revalidateIdpSession(
    sessionId: string
): Promise<boolean> {
    // select the session so safeRead only falls back if the replica fails
    const [row] = await safeRead((d) =>
        d
            .select({ grant: idpGrants })
            .from(sessions)
            .leftJoin(
                sessionIdpGrants,
                eq(sessionIdpGrants.sessionId, sessions.sessionId)
            )
            .leftJoin(
                idpGrants,
                eq(idpGrants.grantId, sessionIdpGrants.grantId)
            )
            .where(eq(sessions.sessionId, sessionId))
    );

    if (!row?.grant) {
        return true;
    }

    const { grant } = row;

    if (grant.revokedAt) {
        await endGrantSessions(grant.grantId);
        return false;
    }

    if (Date.now() - grant.validatedAt < REVALIDATION_INTERVAL_MS) {
        return true;
    }

    return revalidateGrant(grant.grantId);
}

export async function inheritIdpGrant(
    approvingSessionId: string,
    deviceSessionId: string
): Promise<boolean> {
    // primary: a lagging replica could miss the grant link
    const [approving] = await primaryDb
        .select({ grantId: sessionIdpGrants.grantId })
        .from(sessions)
        .leftJoin(
            sessionIdpGrants,
            eq(sessionIdpGrants.sessionId, sessions.sessionId)
        )
        .where(eq(sessions.sessionId, approvingSessionId));

    if (!approving) {
        return false;
    }

    if (!approving.grantId) {
        return true;
    }

    if (!(await revalidateIdpSession(approvingSessionId))) {
        return false;
    }

    await primaryDb.insert(sessionIdpGrants).values({
        sessionId: deviceSessionId,
        grantId: approving.grantId
    });

    return true;
}

function revalidateGrant(grantId: string): Promise<boolean> {
    const pending = inFlight.get(grantId);
    if (pending) {
        return pending;
    }

    const check = revalidate(grantId).finally(() => {
        inFlight.delete(grantId);
    });
    inFlight.set(grantId, check);
    return check;
}

async function revalidate(grantId: string): Promise<boolean> {
    const now = Date.now();
    const leaseId = randomId();

    const [grant] = await primaryDb
        .update(idpGrants)
        .set({ leaseId, leaseExpiresAt: now + LEASE_MS })
        .where(
            and(
                eq(idpGrants.grantId, grantId),
                isNull(idpGrants.revokedAt),
                lt(idpGrants.validatedAt, now - REVALIDATION_INTERVAL_MS),
                or(
                    isNull(idpGrants.attemptedAt),
                    lt(idpGrants.attemptedAt, now - RETRY_INTERVAL_MS)
                ),
                or(
                    isNull(idpGrants.leaseExpiresAt),
                    lt(idpGrants.leaseExpiresAt, now)
                )
            )
        )
        .returning();

    if (!grant) {
        const [current] = await primaryDb
            .select({ revokedAt: idpGrants.revokedAt })
            .from(idpGrants)
            .where(eq(idpGrants.grantId, grantId));
        if (current && !current.revokedAt) {
            return true;
        }
        await endGrantSessions(grantId);
        return false;
    }

    const leased = and(
        eq(idpGrants.grantId, grantId),
        eq(idpGrants.leaseId, leaseId)
    );
    const releaseLease = { leaseId: null, leaseExpiresAt: null };

    const [oidc] = await primaryDb
        .select()
        .from(idpOidcConfig)
        .where(eq(idpOidcConfig.idpId, grant.idpId));

    let tokens: arctic.OAuth2Tokens;
    try {
        tokens = await redeemRefreshToken(oidc, grant.refreshToken);
    } catch (err: unknown) {
        if (
            err instanceof arctic.OAuth2RequestError &&
            err.code === "invalid_grant"
        ) {
            const [revoked] = await primaryDb
                .update(idpGrants)
                .set({ revokedAt: Date.now(), ...releaseLease })
                .where(leased)
                .returning({ grantId: idpGrants.grantId });
            if (!revoked) {
                logger.warn("Lost IdP grant lease while revalidating", {
                    idpId: grant.idpId
                });
                return true;
            }

            logger.info("IdP rejected refresh token, ending sessions", {
                idpId: grant.idpId,
                error: err.code,
                description: err.description
            });
            await endGrantSessions(grantId);
            return false;
        }

        // config errors and outages must not log out every user
        if (err instanceof arctic.OAuth2RequestError) {
            logger.error("IdP refused to revalidate session", {
                idpId: grant.idpId,
                error: err.code,
                description: err.description
            });
        } else {
            logger.warn("Could not revalidate session with IdP", {
                idpId: grant.idpId,
                error: err instanceof Error ? err.message : String(err)
            });
        }
        await primaryDb
            .update(idpGrants)
            .set({ attemptedAt: Date.now(), ...releaseLease })
            .where(leased);
        return true;
    }

    const [stored] = await primaryDb
        .update(idpGrants)
        .set({
            refreshToken: rotatedRefreshToken(tokens, grant.refreshToken),
            validatedAt: Date.now(),
            attemptedAt: null,
            ...releaseLease
        })
        .where(leased)
        .returning({ grantId: idpGrants.grantId });
    if (!stored) {
        logger.warn("Lost IdP grant lease while revalidating", {
            idpId: grant.idpId
        });
    }

    return true;
}

// the revoked grant stays so sessions linked to it later are refused too
async function endGrantSessions(grantId: string): Promise<void> {
    const linked = primaryDb
        .select({ sessionId: sessionIdpGrants.sessionId })
        .from(sessionIdpGrants)
        .where(eq(sessionIdpGrants.grantId, grantId));

    await primaryDb.transaction(async (trx) => {
        await trx
            .delete(resourceSessions)
            .where(inArray(resourceSessions.userSessionId, linked));
        await trx.delete(sessions).where(inArray(sessions.sessionId, linked));
    });
}

// arctic's refreshAccessToken cannot be aborted
async function redeemRefreshToken(
    oidc: IdpOidcConfig,
    encryptedRefreshToken: string
): Promise<arctic.OAuth2Tokens> {
    const key = config.getRawConfig().server.secret!;
    const credentials = encodeBase64(
        new TextEncoder().encode(
            `${decrypt(oidc.clientId, key)}:${decrypt(oidc.clientSecret, key)}`
        )
    );
    const body = new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: decrypt(encryptedRefreshToken, key)
    });
    const scopes = oidc.scopes
        .split(" ")
        .map((scope) => scope.trim())
        .filter((scope) => scope.length > 0);
    if (scopes.length > 0) {
        body.set("scope", scopes.join(" "));
    }

    const response = await fetch(oidc.tokenUrl, {
        method: "POST",
        headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            Accept: "application/json",
            Authorization: `Basic ${credentials}`
        },
        body,
        signal: AbortSignal.timeout(TOKEN_REQUEST_TIMEOUT_MS)
    });
    const data: unknown = await response.json().catch(() => null);

    if (response.status === 200 && typeof data === "object" && data) {
        return new arctic.OAuth2Tokens(data);
    }
    if (
        (response.status === 400 || response.status === 401) &&
        typeof data === "object" &&
        data &&
        "error" in data &&
        typeof data.error === "string"
    ) {
        const description =
            "error_description" in data &&
            typeof data.error_description === "string"
                ? data.error_description
                : null;
        throw new arctic.OAuth2RequestError(
            data.error,
            description,
            null,
            null
        );
    }
    throw new Error(`Unexpected token endpoint response: ${response.status}`);
}

function rotatedRefreshToken(
    tokens: arctic.OAuth2Tokens,
    encryptedPrevious: string
): string {
    if (!tokens.hasRefreshToken()) {
        return encryptedPrevious;
    }
    return encrypt(tokens.refreshToken(), config.getRawConfig().server.secret!);
}
