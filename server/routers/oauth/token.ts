import type { Request, Response } from "express";
import { createHash, timingSafeEqual } from "crypto";
import { and, eq, isNull } from "drizzle-orm";
import {
    db,
    oauthAccessTokens,
    oauthAuthorizationCodes,
    oauthRefreshTokens,
    Transaction
} from "@server/db";
import HttpCode from "@server/types/HttpCode";
import { buildIdTokenClaims } from "@server/lib/oauth/claims";
import { getActiveSigningKey } from "@server/lib/oauth/keys";
import {
    generateAccessToken,
    generateRefreshToken,
    hashToken,
    signIdToken
} from "@server/lib/oauth/tokens";
import { generateIdFromEntropySize } from "@server/auth/sessions/app";
import {
    hasScope,
    isScopeSubset,
    OFFLINE_ACCESS_SCOPE
} from "@server/lib/oauth/scopes";
import {
    ACCESS_TOKEN_LIFETIME_MS,
    ACCESS_TOKEN_LIFETIME_SECONDS,
    REFRESH_TOKEN_LIFETIME_MS
} from "@server/lib/oauth/lifetimes";
import {
    authenticateClient,
    getBodyValue,
    sendOAuthError
} from "@server/lib/oauth/clientAuth";
import { userBelongsToClientOrg } from "@server/lib/oauth/clientMembership";
import logger from "@server/logger";

function verifyPkce(codeVerifier: string, codeChallenge: string): boolean {
    const hash = createHash("sha256").update(codeVerifier).digest();
    const expected = Buffer.from(codeChallenge, "base64url");
    if (hash.length !== expected.length) {
        return false;
    }
    return timingSafeEqual(hash, expected);
}

async function insertTokenPair(
    trx: Transaction,
    params: {
        accessToken: string;
        refreshToken?: string;
        clientId: string;
        userId: string;
        scope: string;
        now: number;
    }
) {
    await trx.insert(oauthAccessTokens).values({
        accessTokenId: generateIdFromEntropySize(12),
        tokenHash: hashToken(params.accessToken),
        clientId: params.clientId,
        userId: params.userId,
        scope: params.scope,
        expiresAt: params.now + ACCESS_TOKEN_LIFETIME_MS,
        createdAt: params.now
    });

    if (params.refreshToken) {
        await trx.insert(oauthRefreshTokens).values({
            refreshTokenId: generateIdFromEntropySize(12),
            tokenHash: hashToken(params.refreshToken),
            clientId: params.clientId,
            userId: params.userId,
            scope: params.scope,
            expiresAt: params.now + REFRESH_TOKEN_LIFETIME_MS,
            createdAt: params.now
        });
    }
}

async function sendTokenResponse(
    res: Response,
    params: {
        accessToken: string;
        refreshToken?: string;
        scope: string;
        userId: string;
        clientId: string;
        nonce?: string;
    }
): Promise<Response> {
    const responseBody: Record<string, unknown> = {
        access_token: params.accessToken,
        token_type: "Bearer",
        expires_in: ACCESS_TOKEN_LIFETIME_SECONDS,
        scope: params.scope
    };

    if (params.refreshToken) {
        responseBody.refresh_token = params.refreshToken;
    }

    if (hasScope(params.scope, "openid")) {
        const claims = await buildIdTokenClaims(
            params.userId,
            params.clientId,
            params.scope,
            params.nonce
        );
        const signingKey = await getActiveSigningKey();

        responseBody.id_token = signIdToken(
            claims,
            signingKey.privateKeyPem,
            signingKey.keyId
        );
    }

    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Pragma", "no-cache");
    return res.status(HttpCode.OK).json(responseBody);
}

export async function issueToken(
    req: Request,
    res: Response
): Promise<Response | void> {
    try {
        const authResult = await authenticateClient(req);
        if (!("client" in authResult)) {
            if (req.headers.authorization) {
                res.setHeader("WWW-Authenticate", "Basic");
            }
            return sendOAuthError(
                res,
                authResult.status,
                authResult.oauthError
            );
        }

        const grantType = getBodyValue(req.body, "grant_type");

        if (!grantType) {
            return sendOAuthError(res, HttpCode.BAD_REQUEST, {
                error: "invalid_request",
                error_description: "Missing grant_type"
            });
        }

        if (grantType === "authorization_code") {
            const code = getBodyValue(req.body, "code");
            const redirectUri = getBodyValue(req.body, "redirect_uri");
            const codeVerifier = getBodyValue(req.body, "code_verifier");

            if (!code || !redirectUri) {
                return sendOAuthError(res, HttpCode.BAD_REQUEST, {
                    error: "invalid_request",
                    error_description: "Missing code or redirect_uri"
                });
            }

            // Atomically consume the auth code to prevent race conditions (TOCTOU).
            // Per RFC 6749 Section 10.5, a code presented with invalid params
            // after atomic deletion is correctly invalidated.
            const [authCode] = await db
                .delete(oauthAuthorizationCodes)
                .where(eq(oauthAuthorizationCodes.codeHash, hashToken(code)))
                .returning();

            if (!authCode) {
                return sendOAuthError(res, HttpCode.BAD_REQUEST, {
                    error: "invalid_grant",
                    error_description: "Authorization code is invalid"
                });
            }

            if (Date.now() > authCode.expiresAt) {
                return sendOAuthError(res, HttpCode.BAD_REQUEST, {
                    error: "invalid_grant",
                    error_description: "Authorization code has expired"
                });
            }

            if (authCode.clientId !== authResult.client.clientId) {
                return sendOAuthError(res, HttpCode.BAD_REQUEST, {
                    error: "invalid_grant",
                    error_description: "Authorization code client mismatch"
                });
            }

            if (authCode.redirectUri !== redirectUri) {
                return sendOAuthError(res, HttpCode.BAD_REQUEST, {
                    error: "invalid_grant",
                    error_description: "redirect_uri does not match"
                });
            }

            if (authCode.codeChallenge) {
                if (!codeVerifier) {
                    return sendOAuthError(res, HttpCode.BAD_REQUEST, {
                        error: "invalid_grant",
                        error_description: "Missing PKCE code_verifier"
                    });
                }

                if (
                    authCode.codeChallengeMethod &&
                    authCode.codeChallengeMethod !== "S256"
                ) {
                    return sendOAuthError(res, HttpCode.BAD_REQUEST, {
                        error: "invalid_grant",
                        error_description: "Unsupported code_challenge_method"
                    });
                }

                if (!verifyPkce(codeVerifier, authCode.codeChallenge)) {
                    return sendOAuthError(res, HttpCode.BAD_REQUEST, {
                        error: "invalid_grant",
                        error_description: "Invalid PKCE code_verifier"
                    });
                }
            }

            const now = Date.now();
            const accessToken = generateAccessToken();
            const refreshToken = hasScope(authCode.scope, OFFLINE_ACCESS_SCOPE)
                ? generateRefreshToken()
                : undefined;

            await db.transaction(async (trx) => {
                await insertTokenPair(trx, {
                    accessToken,
                    refreshToken,
                    clientId: authCode.clientId,
                    userId: authCode.userId,
                    scope: authCode.scope,
                    now
                });
            });

            return sendTokenResponse(res, {
                accessToken,
                refreshToken,
                scope: authCode.scope,
                userId: authCode.userId,
                clientId: authCode.clientId,
                nonce: authCode.nonce ?? undefined
            });
        }

        if (grantType === "refresh_token") {
            const refreshToken = getBodyValue(req.body, "refresh_token");
            const scope = getBodyValue(req.body, "scope");

            if (!refreshToken) {
                return sendOAuthError(res, HttpCode.BAD_REQUEST, {
                    error: "invalid_request",
                    error_description: "Missing refresh_token"
                });
            }

            const now = Date.now();

            // Atomically revoke the refresh token to prevent reuse race conditions.
            // Same pattern as auth code consumption above (DELETE...RETURNING).
            const [existingRefreshToken] = await db
                .update(oauthRefreshTokens)
                .set({ revokedAt: now })
                .where(
                    and(
                        eq(
                            oauthRefreshTokens.tokenHash,
                            hashToken(refreshToken)
                        ),
                        isNull(oauthRefreshTokens.revokedAt)
                    )
                )
                .returning();

            if (!existingRefreshToken) {
                return sendOAuthError(res, HttpCode.BAD_REQUEST, {
                    error: "invalid_grant",
                    error_description: "Refresh token is invalid"
                });
            }

            if (now > existingRefreshToken.expiresAt) {
                return sendOAuthError(res, HttpCode.BAD_REQUEST, {
                    error: "invalid_grant",
                    error_description: "Refresh token has expired"
                });
            }

            if (existingRefreshToken.clientId !== authResult.client.clientId) {
                return sendOAuthError(res, HttpCode.BAD_REQUEST, {
                    error: "invalid_grant",
                    error_description: "Refresh token client mismatch"
                });
            }

            const finalScope = scope || existingRefreshToken.scope;

            if (scope && !isScopeSubset(scope, existingRefreshToken.scope)) {
                return sendOAuthError(res, HttpCode.BAD_REQUEST, {
                    error: "invalid_scope",
                    error_description: "Requested scope is not a subset"
                });
            }
            if (!isScopeSubset(finalScope, authResult.client.scopes)) {
                return sendOAuthError(res, HttpCode.BAD_REQUEST, {
                    error: "invalid_scope",
                    error_description:
                        "Requested scope is no longer allowed for this client"
                });
            }
            if (!hasScope(finalScope, "openid")) {
                return sendOAuthError(res, HttpCode.BAD_REQUEST, {
                    error: "invalid_scope",
                    error_description: "openid scope is required"
                });
            }
            if (
                !(await userBelongsToClientOrg(
                    existingRefreshToken.userId,
                    existingRefreshToken.clientId
                ))
            ) {
                return sendOAuthError(res, HttpCode.BAD_REQUEST, {
                    error: "invalid_grant",
                    error_description:
                        "User no longer belongs to this client's organization"
                });
            }

            const nextAccessToken = generateAccessToken();
            const nextRefreshToken = hasScope(finalScope, OFFLINE_ACCESS_SCOPE)
                ? generateRefreshToken()
                : undefined;

            await db.transaction(async (trx) => {
                await insertTokenPair(trx, {
                    accessToken: nextAccessToken,
                    refreshToken: nextRefreshToken,
                    clientId: existingRefreshToken.clientId,
                    userId: existingRefreshToken.userId,
                    scope: finalScope,
                    now
                });
            });

            return sendTokenResponse(res, {
                accessToken: nextAccessToken,
                refreshToken: nextRefreshToken,
                scope: finalScope,
                userId: existingRefreshToken.userId,
                clientId: existingRefreshToken.clientId
            });
        }

        return sendOAuthError(res, HttpCode.BAD_REQUEST, {
            error: "unsupported_grant_type",
            error_description: "Unsupported grant_type"
        });
    } catch (error) {
        logger.error(error);
        return sendOAuthError(res, HttpCode.INTERNAL_SERVER_ERROR, {
            error: "server_error",
            error_description: "An internal server error occurred"
        });
    }
}
