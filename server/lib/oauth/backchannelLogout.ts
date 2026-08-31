import {
    db,
    oauthClients,
    oauthAccessTokens,
    oauthAuthorizationCodes,
    oauthRefreshTokens
} from "@server/db";
import { eq, and, or, isNotNull, exists, gt, isNull } from "drizzle-orm";
import { getActiveSigningKey } from "@server/lib/oauth/keys";
import { getIssuerUrl } from "@server/lib/oauth/issuer";
import { signLogoutToken } from "@server/lib/oauth/tokens";
import { generateIdFromEntropySize } from "@server/auth/sessions/app";
import logger from "@server/logger";
import { assertBackchannelLogoutDestinationAllowed } from "@server/lib/oauth/backchannelLogoutSecurity";
import {
    CLIENT_BACKCHANNEL_MAX_RETRIES,
    CLIENT_BACKCHANNEL_RETRY_INTERVAL_MS,
    CLIENT_BACKCHANNEL_RETRY_LIFETIME_MS
} from "./lifetimes";
import HttpCode from "@server/types/HttpCode";

type BackchannelLogoutClient = {
    clientId: string;
    backchannelLogoutUri: string | null;
    retryUntil: number;
    retryAttempt: number;
};

const backchannelRetryCache = new Map<string, BackchannelLogoutClient[]>();

export async function revokeOAuthTokensAndCollectBackchannelClients(
    userId: string
): Promise<BackchannelLogoutClient[]> {
    const now = Date.now();

    return db.transaction(async (trx) => {
        // Find all clients with a backchannelLogoutUri that have active tokens for this user
        const clients = await trx
            .select({
                clientId: oauthClients.clientId,
                backchannelLogoutUri: oauthClients.backchannelLogoutUri
            })
            .from(oauthClients)
            .where(
                and(
                    isNotNull(oauthClients.backchannelLogoutUri),
                    or(
                        exists(
                            trx
                                .select()
                                .from(oauthAccessTokens)
                                .where(
                                    and(
                                        eq(
                                            oauthAccessTokens.clientId,
                                            oauthClients.clientId
                                        ),
                                        eq(oauthAccessTokens.userId, userId),
                                        gt(oauthAccessTokens.expiresAt, now)
                                    )
                                )
                        ),
                        exists(
                            trx
                                .select()
                                .from(oauthRefreshTokens)
                                .where(
                                    and(
                                        eq(
                                            oauthRefreshTokens.clientId,
                                            oauthClients.clientId
                                        ),
                                        eq(oauthRefreshTokens.userId, userId),
                                        gt(oauthRefreshTokens.expiresAt, now),
                                        isNull(oauthRefreshTokens.revokedAt)
                                    )
                                )
                        )
                    )
                )
            );

        await trx
            .delete(oauthAuthorizationCodes)
            .where(eq(oauthAuthorizationCodes.userId, userId));
        await trx
            .delete(oauthAccessTokens)
            .where(eq(oauthAccessTokens.userId, userId));
        await trx
            .delete(oauthRefreshTokens)
            .where(eq(oauthRefreshTokens.userId, userId));

        return clients.map((client) => ({
            ...client,
            retryAttempt: 0,
            retryUntil: Date.now() + CLIENT_BACKCHANNEL_RETRY_LIFETIME_MS
        }));
    });
}

export async function dispatchBackchannelLogout(
    userId: string,
    clients: BackchannelLogoutClient[]
): Promise<BackchannelLogoutClient[] | null> {
    if (clients.length === 0) {
        return null;
    }

    try {
        const signingKey = await getActiveSigningKey();
        const issuer = getIssuerUrl();

        // The promises return the client, if logout failed.
        const promises = clients.map(async (client) => {
            try {
                if (!client.backchannelLogoutUri) {
                    return;
                }

                if (client.retryUntil <= Date.now()) {
                    return;
                }

                const jti = generateIdFromEntropySize(16);
                const logoutToken = signLogoutToken(
                    {
                        iss: issuer,
                        sub: userId,
                        aud: client.clientId,
                        jti
                    },
                    signingKey.privateKeyPem,
                    signingKey.keyId
                );

                const logoutUrl =
                    await assertBackchannelLogoutDestinationAllowed(
                        client.backchannelLogoutUri
                    );
                const res = await fetch(logoutUrl, {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/x-www-form-urlencoded"
                    },
                    body: new URLSearchParams({
                        logout_token: logoutToken
                    }).toString(),
                    signal: AbortSignal.timeout(10000),
                    redirect: "error"
                });

                if (shouldRetryBackchannel(res.status)) {
                    ++client.retryAttempt;
                    logger.warn(
                        `Back-channel logout attempt ${client.retryAttempt}/${CLIENT_BACKCHANNEL_MAX_RETRIES}` +
                            ` to ${client.clientId} returned status ${res.status}`
                    );

                    if (client.retryAttempt < CLIENT_BACKCHANNEL_MAX_RETRIES) {
                        return client;
                    }
                }
            } catch (err) {
                ++client.retryAttempt;
                logger.warn(
                    `Back-channel logout attempt ${client.retryAttempt}/${CLIENT_BACKCHANNEL_MAX_RETRIES}` +
                        ` to ${client.clientId} failed: ${err}`
                );

                if (client.retryAttempt < CLIENT_BACKCHANNEL_MAX_RETRIES) {
                    return client;
                }
            }
        });

        // Empty results are successful, return failures only.
        const results = await Promise.all(promises);
        return results.filter((result) => !!result);
    } catch (err) {
        logger.error(
            `dispatchBackchannelLogout failed for user ${userId}: ${err}`
        );
        return clients;
    }
}

export async function scheduleBackchannelLogout(userId: string): Promise<void> {
    try {
        // Wait for the revocation
        const clients =
            await revokeOAuthTokensAndCollectBackchannelClients(userId);

        if (!clients || clients.length <= 0) {
            return;
        }

        // Fire and forget, don't wait for responses
        // Failed logouts will be queued for retry
        sendBackchannelLogouts(userId, clients);
    } catch (err) {
        logger.error(`sendBackchannelLogout failed for user ${userId}: ${err}`);
    }
}

export async function sendBackchannelLogouts(
    userId: string,
    clients: BackchannelLogoutClient[]
) {
    const remaining = await dispatchBackchannelLogout(userId, clients);

    // Handle all requested clients as dispatched
    const requested = new Set(clients.map((c) => c.clientId));
    const userCache = (backchannelRetryCache.get(userId) ?? []).filter(
        (uc) => !requested.has(uc.clientId)
    );

    // Queue clients with failed backchannel logouts
    if (remaining && remaining.length > 0) {
        userCache.push(...remaining);
        backchannelRetryCache.set(userId, userCache);
        return;
    }

    // All clients of this user logged out
    backchannelRetryCache.delete(userId);
}

let backchannelRetryRunning = false;
export async function retryBackchannelLogouts() {
    if (backchannelRetryRunning) return;
    backchannelRetryRunning = true;

    try {
        for (const [userId, clients] of backchannelRetryCache.entries()) {
            await sendBackchannelLogouts(userId, clients);
        }
    } finally {
        backchannelRetryRunning = false;
    }
}

export function initBackchannelLogoutRetryInterval(): NodeJS.Timeout {
    // Every 2 minutes
    return setInterval(
        retryBackchannelLogouts,
        CLIENT_BACKCHANNEL_RETRY_INTERVAL_MS
    );
}

function shouldRetryBackchannel(status: number): boolean {
    return (
        (status >= 500 && status <= 599) ||
        status === HttpCode.REQUEST_TIMEOUT ||
        status === HttpCode.TOO_MANY_REQUESTS
    );
}
