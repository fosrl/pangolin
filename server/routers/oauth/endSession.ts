import type { Request, Response } from "express";
import jsonwebtoken from "jsonwebtoken";
import { and, eq, isNull } from "drizzle-orm";
import {
    db,
    oauthAccessTokens,
    oauthAuthorizationCodes,
    oauthClients,
    oauthRefreshTokens
} from "@server/db";
import { getActiveSigningPublicKeys } from "@server/lib/oauth/keys";
import { getIssuerUrl } from "@server/lib/oauth/issuer";
import {
    createBlankSessionTokenCookie,
    invalidateSession
} from "@server/auth/sessions/app";
import { verifySession } from "@server/auth/sessions/verifySession";
import logger from "@server/logger";

export async function handleEndSession(
    req: Request,
    res: Response
): Promise<void> {
    try {
        const params = req.method === "POST" ? req.body : req.query;

        const idTokenHint = params.id_token_hint as string | undefined;
        const clientIdParam = params.client_id as string | undefined;
        const postLogoutRedirectUri = params.post_logout_redirect_uri as
            | string
            | undefined;
        const state = params.state as string | undefined;

        const fallbackUrl = getIssuerUrl();
        let redirectTarget = fallbackUrl;
        let clientId: string | undefined;
        let userId: string | undefined;
        let clientIdMismatch = false;
        let hasValidIdTokenHint = false;

        if (idTokenHint) {
            try {
                const signingKeys = await getActiveSigningPublicKeys();
                let decoded: string | jsonwebtoken.JwtPayload | undefined;

                for (const signingKey of signingKeys) {
                    try {
                        decoded = jsonwebtoken.verify(
                            idTokenHint,
                            signingKey.publicKeyPem,
                            {
                                algorithms: ["RS256"],
                                issuer: getIssuerUrl(),
                                ignoreExpiration: true
                            }
                        );
                        break;
                    } catch {
                        continue;
                    }
                }

                if (!decoded) {
                    throw new Error("Invalid id_token_hint");
                }

                if (
                    typeof decoded === "object" &&
                    decoded !== null &&
                    "aud" in decoded
                ) {
                    clientId =
                        typeof decoded.aud === "string"
                            ? decoded.aud
                            : Array.isArray(decoded.aud)
                              ? decoded.aud[0]
                              : undefined;

                    if ("sub" in decoded && typeof decoded.sub === "string") {
                        userId = decoded.sub;
                    }
                }

                hasValidIdTokenHint = true;

                if (clientIdParam && clientId && clientIdParam !== clientId) {
                    clientId = undefined;
                    clientIdMismatch = true;
                }
            } catch {
                // Invalid token hints are ignored.
            }
        }

        if (
            hasValidIdTokenHint &&
            !clientId &&
            clientIdParam &&
            !clientIdMismatch
        ) {
            clientId = clientIdParam;
        }

        if (hasValidIdTokenHint && clientId && userId) {
            await db.transaction(async (trx) => {
                await trx
                    .delete(oauthAuthorizationCodes)
                    .where(
                        and(
                            eq(oauthAuthorizationCodes.userId, userId),
                            eq(oauthAuthorizationCodes.clientId, clientId)
                        )
                    );

                await trx
                    .delete(oauthAccessTokens)
                    .where(
                        and(
                            eq(oauthAccessTokens.userId, userId),
                            eq(oauthAccessTokens.clientId, clientId)
                        )
                    );

                await trx
                    .update(oauthRefreshTokens)
                    .set({ revokedAt: Date.now() })
                    .where(
                        and(
                            eq(oauthRefreshTokens.userId, userId),
                            eq(oauthRefreshTokens.clientId, clientId),
                            isNull(oauthRefreshTokens.revokedAt)
                        )
                    );
            });
        }

        let clientLogoutTerminatesPangolinSession = false;

        if (clientId) {
            const [client] = await db
                .select({
                    postLogoutRedirectUris: oauthClients.postLogoutRedirectUris,
                    logoutTerminatesPangolinSession:
                        oauthClients.logoutTerminatesPangolinSession
                })
                .from(oauthClients)
                .where(eq(oauthClients.clientId, clientId))
                .limit(1);

            if (client) {
                clientLogoutTerminatesPangolinSession =
                    client.logoutTerminatesPangolinSession;
                const registeredUris = client.postLogoutRedirectUris ?? [];

                if (
                    postLogoutRedirectUri &&
                    registeredUris.includes(postLogoutRedirectUri)
                ) {
                    if (state) {
                        const url = new URL(postLogoutRedirectUri);
                        url.searchParams.set("state", state);
                        redirectTarget = url.toString();
                    } else {
                        redirectTarget = postLogoutRedirectUri;
                    }
                }
            }
        }

        if (
            clientLogoutTerminatesPangolinSession &&
            hasValidIdTokenHint &&
            userId
        ) {
            const { user, session } = await verifySession(req);

            if (user && session && user.userId === userId) {
                await invalidateSession(session.sessionId);
                res.setHeader(
                    "Set-Cookie",
                    createBlankSessionTokenCookie(req.protocol === "https")
                );
            }
        }

        res.redirect(redirectTarget);
    } catch (error) {
        logger.error("End session error", error);
        res.redirect(getIssuerUrl());
    }
}
