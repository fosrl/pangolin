import type { Request, Response } from "express";
import { and, eq } from "drizzle-orm";
import {
    db,
    oauthAccessTokens,
    oauthRefreshTokens
} from "@server/db";
import HttpCode from "@server/types/HttpCode";
import { hashToken } from "@server/lib/oauth/tokens";
import {
    authenticateClient,
    getBodyValue,
    sendOAuthError
} from "@server/lib/oauth/clientAuth";
import logger from "@server/logger";

export async function revokeToken(
    req: Request,
    res: Response
): Promise<Response | void> {
    try {
        const authResult = await authenticateClient(req);

        if (!("client" in authResult)) {
            return sendOAuthError(
                res,
                authResult.status,
                authResult.oauthError
            );
        }

        const client = authResult.client;
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
                        eq(
                            oauthRefreshTokens.refreshTokenId,
                            refreshToken.refreshTokenId
                        )
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
                        eq(
                            oauthAccessTokens.accessTokenId,
                            accessToken.accessTokenId
                        )
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
                .where(
                    eq(
                        oauthAccessTokens.accessTokenId,
                        accessToken.accessTokenId
                    )
                );
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
                    eq(
                        oauthRefreshTokens.refreshTokenId,
                        refreshToken.refreshTokenId
                    )
                );
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
