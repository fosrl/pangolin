import type { Request, Response } from "express";
import { and, eq } from "drizzle-orm";
import { db, oauthAccessTokens, oauthRefreshTokens } from "@server/db";
import HttpCode from "@server/types/HttpCode";
import { hashToken } from "@server/lib/oauth/tokens";
import { sendOAuthError } from "@server/routers/oauth/token";
import {
    authenticateClient,
    OAuthClientWithSecret
} from "@server/lib/oauth/clientAuth";
import { getBodyValue } from "@server/lib/requestParams";
import logger from "@server/logger";

export async function revokeToken(
    req: Request,
    res: Response
): Promise<Response | void> {
    try {
        let client: OAuthClientWithSecret;
        try {
            client = await authenticateClient(req);
        } catch (error) {
            logger.warn(error);
            if (req.headers.authorization) {
                res.setHeader("WWW-Authenticate", "Basic");
            }
            return sendOAuthError(res, HttpCode.UNAUTHORIZED, {
                error: "invalid_client",
                error_description: "Invalid client credentials"
            });
        }

        const token = getBodyValue(req, "token");
        const tokenTypeHint = getBodyValue(req, "token_type_hint");

        if (!token) {
            return res.status(HttpCode.OK).json({});
        }

        const tokenHash = hashToken(token);
        const grantWhere = (
            table: typeof oauthAccessTokens | typeof oauthRefreshTokens,
            grantId: string
        ) =>
            and(
                eq(table.grantId, grantId),
                eq(table.clientId, client.clientId)
            );

        async function revokeGrantById(grantId: string): Promise<void> {
            await db.transaction(async (trx) => {
                await trx
                    .delete(oauthAccessTokens)
                    .where(grantWhere(oauthAccessTokens, grantId));
                await trx
                    .update(oauthRefreshTokens)
                    .set({ revokedAt: Date.now() })
                    .where(grantWhere(oauthRefreshTokens, grantId));
            });
        }

        if (tokenTypeHint === "refresh_token") {
            const [refreshTokenRecord] = await db
                .select({ grantId: oauthRefreshTokens.grantId })
                .from(oauthRefreshTokens)
                .where(
                    and(
                        eq(oauthRefreshTokens.tokenHash, tokenHash),
                        eq(oauthRefreshTokens.clientId, client.clientId)
                    )
                )
                .limit(1);

            if (refreshTokenRecord) {
                await revokeGrantById(refreshTokenRecord.grantId);
            }
            return res.status(HttpCode.OK).json({});
        }

        if (tokenTypeHint === "access_token") {
            const [accessTokenRecord] = await db
                .select({ grantId: oauthAccessTokens.grantId })
                .from(oauthAccessTokens)
                .where(
                    and(
                        eq(oauthAccessTokens.tokenHash, tokenHash),
                        eq(oauthAccessTokens.clientId, client.clientId)
                    )
                )
                .limit(1);

            if (accessTokenRecord) {
                await revokeGrantById(accessTokenRecord.grantId);
            }
            return res.status(HttpCode.OK).json({});
        }

        // No hint — try access token first, then refresh token
        const [accessTokenRecord] = await db
            .select({ grantId: oauthAccessTokens.grantId })
            .from(oauthAccessTokens)
            .where(
                and(
                    eq(oauthAccessTokens.tokenHash, tokenHash),
                    eq(oauthAccessTokens.clientId, client.clientId)
                )
            )
            .limit(1);

        if (accessTokenRecord) {
            await revokeGrantById(accessTokenRecord.grantId);
            return res.status(HttpCode.OK).json({});
        }

        const [refreshTokenRecord] = await db
            .select({ grantId: oauthRefreshTokens.grantId })
            .from(oauthRefreshTokens)
            .where(
                and(
                    eq(oauthRefreshTokens.tokenHash, tokenHash),
                    eq(oauthRefreshTokens.clientId, client.clientId)
                )
            )
            .limit(1);

        if (refreshTokenRecord) {
            await revokeGrantById(refreshTokenRecord.grantId);
        }

        return res.status(HttpCode.OK).json({});
    } catch (error) {
        logger.error(error);
        return sendOAuthError(res, HttpCode.INTERNAL_SERVER_ERROR, {
            error: "server_error",
            error_description: "An internal server error occurred"
        });
    }
}
