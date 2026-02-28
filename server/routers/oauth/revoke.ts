import type { Request, Response } from "express";
import { and, eq } from "drizzle-orm";
import { verifyPassword } from "@server/auth/password";
import {
    db,
    oauthAccessTokens,
    oauthClients,
    oauthRefreshTokens
} from "@server/db";
import HttpCode from "@server/types/HttpCode";
import { hashToken } from "@server/lib/oauth/tokens";

type OAuthClientRecord = typeof oauthClients.$inferSelect;

function getBodyValue(body: unknown, key: string): string | undefined {
    if (!body || typeof body !== "object") {
        return undefined;
    }

    const value = Reflect.get(body, key);

    if (typeof value === "string") {
        return value;
    }

    if (Array.isArray(value) && value.length > 0 && typeof value[0] === "string") {
        return value[0];
    }

    return undefined;
}

function parseBasicAuth(
    authorizationHeader: string | undefined
): { clientId: string; clientSecret: string } | null {
    if (!authorizationHeader || !authorizationHeader.startsWith("Basic ")) {
        return null;
    }

    try {
        const decoded = Buffer.from(
            authorizationHeader.slice("Basic ".length),
            "base64"
        ).toString("utf8");
        const separatorIndex = decoded.indexOf(":");
        if (separatorIndex < 0) {
            return null;
        }

        return {
            clientId: decoded.slice(0, separatorIndex),
            clientSecret: decoded.slice(separatorIndex + 1)
        };
    } catch {
        return null;
    }
}

async function authenticateClient(req: Request): Promise<OAuthClientRecord | null> {
    const basicCredentials = parseBasicAuth(req.headers.authorization);

    const clientId = basicCredentials?.clientId || getBodyValue(req.body, "client_id");
    const clientSecret =
        basicCredentials?.clientSecret || getBodyValue(req.body, "client_secret");

    if (!clientId) {
        return null;
    }

    const [client] = await db
        .select()
        .from(oauthClients)
        .where(eq(oauthClients.clientId, clientId))
        .limit(1);

    if (!client || !client.enabled) {
        return null;
    }

    if (client.clientSecretHash) {
        if (!clientSecret) {
            return null;
        }

        const validSecret = await verifyPassword(clientSecret, client.clientSecretHash);
        if (!validSecret) {
            return null;
        }
    }

    return client;
}

export async function revokeToken(
    req: Request,
    res: Response
): Promise<Response | void> {
    const client = await authenticateClient(req);

    if (!client) {
        return res.status(HttpCode.UNAUTHORIZED).json({
            error: "invalid_client",
            error_description: "Invalid client credentials"
        });
    }

    const token = getBodyValue(req.body, "token");
    const tokenTypeHint = getBodyValue(req.body, "token_type_hint");

    if (!token) {
        return res.status(HttpCode.OK).json({});
    }

    const tokenHash = hashToken(token);

    if (tokenTypeHint === "refresh_token") {
        const [refreshToken] = await db
            .select()
            .from(oauthRefreshTokens)
            .where(
                and(
                    eq(oauthRefreshTokens.tokenHash, tokenHash),
                    eq(oauthRefreshTokens.clientId, client.clientId)
                )
            )
            .limit(1);

        if (refreshToken) {
            await db
                .update(oauthRefreshTokens)
                .set({ revokedAt: Date.now() })
                .where(
                    eq(oauthRefreshTokens.refreshTokenId, refreshToken.refreshTokenId)
                );
        }

        return res.status(HttpCode.OK).json({});
    }

    if (tokenTypeHint === "access_token") {
        const [accessToken] = await db
            .select()
            .from(oauthAccessTokens)
            .where(
                and(
                    eq(oauthAccessTokens.tokenHash, tokenHash),
                    eq(oauthAccessTokens.clientId, client.clientId)
                )
            )
            .limit(1);

        if (accessToken) {
            await db
                .delete(oauthAccessTokens)
                .where(
                    eq(oauthAccessTokens.accessTokenId, accessToken.accessTokenId)
                );
        }

        return res.status(HttpCode.OK).json({});
    }

    const [accessToken] = await db
        .select()
        .from(oauthAccessTokens)
        .where(
            and(
                eq(oauthAccessTokens.tokenHash, tokenHash),
                eq(oauthAccessTokens.clientId, client.clientId)
            )
        )
        .limit(1);

    if (accessToken) {
        await db
            .delete(oauthAccessTokens)
            .where(eq(oauthAccessTokens.accessTokenId, accessToken.accessTokenId));
        return res.status(HttpCode.OK).json({});
    }

    const [refreshToken] = await db
        .select()
        .from(oauthRefreshTokens)
        .where(
            and(
                eq(oauthRefreshTokens.tokenHash, tokenHash),
                eq(oauthRefreshTokens.clientId, client.clientId)
            )
        )
        .limit(1);

    if (refreshToken) {
        await db
            .update(oauthRefreshTokens)
            .set({ revokedAt: Date.now() })
            .where(
                eq(oauthRefreshTokens.refreshTokenId, refreshToken.refreshTokenId)
            );
    }

    return res.status(HttpCode.OK).json({});
}
