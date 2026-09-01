import type { Request, Response } from "express";
import { and, eq, isNull } from "drizzle-orm";
import {
    db,
    oauthAccessTokens,
    oauthAuthorizationCodes,
    oauthClients,
    oauthRefreshTokens
} from "@server/db";
import { getIssuerUrl } from "@server/lib/oauth/issuer";
import {
    createBlankSessionTokenCookie,
    invalidateSession
} from "@server/auth/sessions/app";
import { verifySession } from "@server/auth/sessions/verifySession";
import logger from "@server/logger";
import { OAuthSessionTokenIds } from "@server/middlewares";

type OAuthEndSessionConfig = {
    redirectUrl: URL;
    endPangolinSession: boolean;
};

export async function handleEndSession(
    req: Request,
    res: Response
): Promise<Response | void> {
    try {
        const idToken = req.oauthIdToken!;
        const params = req.method === "POST" ? req.body : req.query;

        await deleteToken(idToken);
        const clientConfig = await getClientEndSessionConfig(
            idToken,
            params.post_logout_redirect_uri,
            params.state
        );

        if (clientConfig.endPangolinSession) {
            await endPangolinSession(req, res, idToken);
        }

        return res.redirect(clientConfig.redirectUrl.toString());
    } catch (error) {
        logger.error("End session error", error);
        return res.redirect(getIssuerUrl());
    }
}

async function deleteToken(idToken: OAuthSessionTokenIds): Promise<void> {
    await db.transaction(async (trx) => {
        await trx
            .delete(oauthAuthorizationCodes)
            .where(
                and(
                    eq(oauthAuthorizationCodes.userId, idToken.userId),
                    eq(oauthAuthorizationCodes.clientId, idToken.clientId)
                )
            );

        await trx
            .delete(oauthAccessTokens)
            .where(
                and(
                    eq(oauthAccessTokens.userId, idToken.userId),
                    eq(oauthAccessTokens.clientId, idToken.clientId)
                )
            );

        await trx
            .update(oauthRefreshTokens)
            .set({ revokedAt: Date.now() })
            .where(
                and(
                    eq(oauthRefreshTokens.userId, idToken.userId),
                    eq(oauthRefreshTokens.clientId, idToken.clientId),
                    isNull(oauthRefreshTokens.revokedAt)
                )
            );
    });
}

async function getClientEndSessionConfig(
    idToken: OAuthSessionTokenIds,
    requestedUrl: string | undefined,
    state: string | undefined
): Promise<OAuthEndSessionConfig> {
    const config: OAuthEndSessionConfig = {
        redirectUrl: new URL(getIssuerUrl()),
        endPangolinSession: false
    };

    const [client] = await db
        .select({
            postLogoutRedirectUris: oauthClients.postLogoutRedirectUris,
            logoutTerminatesPangolinSession:
                oauthClients.logoutTerminatesPangolinSession
        })
        .from(oauthClients)
        .where(eq(oauthClients.clientId, idToken.clientId))
        .limit(1);

    if (!client) {
        return config;
    }

    config.endPangolinSession = client.logoutTerminatesPangolinSession;

    const registeredUris = client.postLogoutRedirectUris ?? [];
    if (requestedUrl && registeredUris.includes(requestedUrl)) {
        config.redirectUrl = new URL(requestedUrl);
        if (state) {
            config.redirectUrl.searchParams.set("state", state);
        }
    }

    return config;
}

async function endPangolinSession(
    req: Request,
    res: Response,
    idToken: OAuthSessionTokenIds
) {
    const { user, session } = await verifySession(req);

    if (user && session && user.userId === idToken.userId) {
        await invalidateSession(session.sessionId);
        res.setHeader(
            "Set-Cookie",
            createBlankSessionTokenCookie(req.protocol === "https")
        );
    }
}
