import { and, eq } from "drizzle-orm";
import type { Request, Response } from "express";
import logger from "@server/logger";
import HttpCode from "@server/types/HttpCode";
import { getBodyValue } from "@server/lib/requestParams";
import { hashToken } from "@server/lib/oauth/tokens";
import { sendJsonHttpError } from "@server/middlewares/verifyOAuthClient";
import { db, oauthAccessTokens, oauthRefreshTokens } from "@server/db";

// matches refresh and access token
interface IntrospectionRow {
    userId: string | null;
    scope: string | null;
    expiresAt: number | null;
    createdAt: number | null;
    revokedAt?: number | null; // absent from access token
}

type OAuthTokenTableType = typeof oauthAccessTokens | typeof oauthRefreshTokens;

export async function introspectToken(
    req: Request,
    res: Response
): Promise<Response | void> {
    try {
        const client = req.oauthClient!;
        const token = getBodyValue(req, "token");
        if (!token) {
            return sendJsonHttpError(res, HttpCode.BAD_REQUEST, {
                error: "invalid_request",
                error_description: "Missing required parameter 'token'"
            });
        }

        // RFC 7662 doesn't require no cache headers, but it's best practice since
        // caching could open a window where revoked token still looks valid.
        res.setHeader("Cache-Control", "no-store");
        res.setHeader("Pragma", "no-cache");

        const tokenTypeHint = getBodyValue(req, "token_type_hint");
        const row = await findTokenRow(client.clientId, token, tokenTypeHint);

        const now = Date.now();
        if (!row || !row.expiresAt || row.revokedAt || row.expiresAt <= now) {
            return res.status(HttpCode.OK).json({ active: false });
        }

        return res.status(HttpCode.OK).json({
            active: true,

            client_id: client.clientId,
            scope: row.scope ? row.scope : undefined,
            sub: row.userId ? row.userId : undefined,

            // integer seconds (RFC Numeric-Date) from stored epoch ms
            exp: Math.floor((row.expiresAt ?? 0) / 1000),
            iat: Math.floor((row.createdAt ?? 0) / 1000)
        });
    } catch (error) {
        logger.error(error);
        return sendJsonHttpError(res, HttpCode.INTERNAL_SERVER_ERROR, {
            error: "server_error",
            error_description: "Internal server error"
        });
    }
}

async function findTokenRow(
    clientId: string,
    token: string,
    tokenTypeHint: string | null
): Promise<IntrospectionRow | null> {
    const tokenHash = hashToken(token);

    // RFC 7662 §2.1: If the server is unable to locate the token using the given hint,
    // it MUST extend its search across all of its supported token types.
    if (tokenTypeHint === "refresh_token") {
        return (
            (await getTokenRow(oauthRefreshTokens, tokenHash, clientId)) ??
            (await getTokenRow(oauthAccessTokens, tokenHash, clientId))
        );
    }

    return (
        (await getTokenRow(oauthAccessTokens, tokenHash, clientId)) ??
        (await getTokenRow(oauthRefreshTokens, tokenHash, clientId))
    );
}

async function getTokenRow(
    table: OAuthTokenTableType,
    tokenHash: string,
    clientId: string
): Promise<IntrospectionRow | null> {
    const [row] = await db
        .select({
            userId: table.userId,
            scope: table.scope,
            expiresAt: table.expiresAt,
            createdAt: table.createdAt,
            ...("revokedAt" in table ? { revokedAt: table.revokedAt } : {})
        })
        .from(table)
        .where(
            and(eq(table.tokenHash, tokenHash), eq(table.clientId, clientId))
        )
        .limit(1);
    return row ?? null;
}
