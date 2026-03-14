import {
    db,
    oauthClients,
    oauthAccessTokens,
    oauthRefreshTokens
} from "@server/db";
import { eq, and, or, isNotNull, exists, gt, isNull } from "drizzle-orm";
import { getActiveSigningKey } from "@server/lib/oauth/keys";
import { getIssuerUrl } from "@server/lib/oauth/issuer";
import { signLogoutToken } from "@server/lib/oauth/tokens";
import { generateIdFromEntropySize } from "@server/auth/sessions/app";
import logger from "@server/logger";
import { assertBackchannelLogoutDestinationAllowed } from "@server/lib/oauth/backchannelLogoutSecurity";

export async function sendBackchannelLogout(userId: string): Promise<void> {
    try {
        const now = Date.now();

        // Find all clients with a backchannelLogoutUri that have active tokens for this user
        const clients = await db
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
                            db
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
                            db
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

        // Revoke all tokens for this user
        await db
            .delete(oauthAccessTokens)
            .where(eq(oauthAccessTokens.userId, userId));
        await db
            .delete(oauthRefreshTokens)
            .where(eq(oauthRefreshTokens.userId, userId));

        if (clients.length === 0) {
            return;
        }

        const signingKey = await getActiveSigningKey();
        const issuer = getIssuerUrl();

        const promises = clients.map(async (client) => {
            try {
                if (!client.backchannelLogoutUri) {
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

                if (!res.ok) {
                    logger.warn(
                        `Back-channel logout to ${client.clientId} returned ${res.status}`
                    );
                }
            } catch (err) {
                logger.warn(
                    `Back-channel logout to ${client.clientId} failed: ${err}`
                );
            }
        });

        await Promise.all(promises);
    } catch (err) {
        logger.error(`sendBackchannelLogout failed for user ${userId}: ${err}`);
    }
}
