import {
    db,
    oauthClients,
    oauthAccessTokens,
    oauthRefreshTokens
} from "@server/db";
import { eq, and, isNotNull } from "drizzle-orm";
import { getActiveSigningKey } from "@server/lib/oauth/keys";
import { getIssuerUrl } from "@server/lib/oauth/issuer";
import { signLogoutToken } from "@server/lib/oauth/tokens";
import { generateIdFromEntropySize } from "@server/auth/sessions/app";
import logger from "@server/logger";

export async function sendBackchannelLogout(
    userId: string
): Promise<void> {
    try {
        // Find all clients with a backchannelLogoutUri that have active tokens for this user
        const clientsWithTokens = await db
            .selectDistinct({
                clientId: oauthClients.clientId,
                backchannelLogoutUri: oauthClients.backchannelLogoutUri
            })
            .from(oauthClients)
            .innerJoin(
                oauthAccessTokens,
                and(
                    eq(oauthAccessTokens.clientId, oauthClients.clientId),
                    eq(oauthAccessTokens.userId, userId)
                )
            )
            .where(isNotNull(oauthClients.backchannelLogoutUri));

        const clientsWithRefresh = await db
            .selectDistinct({
                clientId: oauthClients.clientId,
                backchannelLogoutUri: oauthClients.backchannelLogoutUri
            })
            .from(oauthClients)
            .innerJoin(
                oauthRefreshTokens,
                and(
                    eq(oauthRefreshTokens.clientId, oauthClients.clientId),
                    eq(oauthRefreshTokens.userId, userId)
                )
            )
            .where(isNotNull(oauthClients.backchannelLogoutUri));

        // Deduplicate by clientId
        const clientMap = new Map<
            string,
            { clientId: string; backchannelLogoutUri: string }
        >();
        for (const c of [...clientsWithTokens, ...clientsWithRefresh]) {
            if (c.backchannelLogoutUri) {
                clientMap.set(c.clientId, {
                    clientId: c.clientId,
                    backchannelLogoutUri: c.backchannelLogoutUri
                });
            }
        }

        const clients = Array.from(clientMap.values());

        if (clients.length === 0) {
            return;
        }

        const signingKey = await getActiveSigningKey();
        const issuer = getIssuerUrl();

        // Send logout tokens to all clients (fire-and-forget)
        const promises = clients.map(async (client) => {
            try {
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

                const res = await fetch(client.backchannelLogoutUri, {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/x-www-form-urlencoded"
                    },
                    body: `logout_token=${encodeURIComponent(logoutToken)}`,
                    signal: AbortSignal.timeout(10000)
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

        await Promise.allSettled(promises);

        // Revoke all tokens for this user
        await db
            .delete(oauthAccessTokens)
            .where(eq(oauthAccessTokens.userId, userId));
        await db
            .delete(oauthRefreshTokens)
            .where(eq(oauthRefreshTokens.userId, userId));
    } catch (err) {
        logger.error(`sendBackchannelLogout failed for user ${userId}: ${err}`);
    }
}
