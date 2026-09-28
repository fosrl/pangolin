import type { Request, Response } from "express";
import { createHash, timingSafeEqual } from "crypto";
import { and, eq, isNull } from "drizzle-orm";
import {
    db,
    oauthAccessTokens,
    oauthAuthorizationCodes,
    OauthClient,
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
import { JsonHttpError, sendJsonHttpError } from "@server/middlewares";
import { getBodyValue } from "@server/lib/requestParams";
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

type insetTokenPairParams = {
    grantId: string;
    accessToken: string;
    refreshToken?: string;
    clientId: string;
    userId: string;
    scope: string;
    now: number;
};

async function insertTokenPair(trx: Transaction, params: insetTokenPairParams) {
    await trx.insert(oauthAccessTokens).values({
        accessTokenId: generateIdFromEntropySize(12),
        grantId: params.grantId,
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
            grantId: params.grantId,
            tokenHash: hashToken(params.refreshToken),
            clientId: params.clientId,
            userId: params.userId,
            scope: params.scope,
            expiresAt: params.now + REFRESH_TOKEN_LIFETIME_MS,
            createdAt: params.now
        });
    }
}

type sendTokenResponseParams = {
    accessToken: string;
    refreshToken?: string;
    scope: string;
    userId: string;
    clientId: string;
    nonce?: string;
};

async function sendTokenResponse(
    res: Response,
    params: sendTokenResponseParams
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
        const client = req.oauthClient!;
        const grantType = getBodyValue(req, "grant_type");

        if (!grantType) {
            return sendJsonHttpError(res, HttpCode.BAD_REQUEST, {
                error: "invalid_request",
                error_description: "Missing grant_type"
            });
        }

        if (grantType === "authorization_code") {
            return await issueAuthorizationCode(req, res, client);
        }

        if (grantType === "refresh_token") {
            return await issueRefreshToken(req, res, client);
        }

        return sendJsonHttpError(res, HttpCode.BAD_REQUEST, {
            error: "unsupported_grant_type",
            error_description: "Unsupported grant_type"
        });
    } catch (error) {
        logger.error(error);
        return sendJsonHttpError(res, HttpCode.INTERNAL_SERVER_ERROR, {
            error: "server_error",
            error_description: "An internal server error occurred"
        });
    }
}

async function issueAuthorizationCode(
    req: Request,
    res: Response,
    client: OauthClient
): Promise<Response> {
    const code = getBodyValue(req, "code");
    const redirectUri = getBodyValue(req, "redirect_uri");
    const codeVerifier = getBodyValue(req, "code_verifier");

    if (!code || !redirectUri) {
        return sendJsonHttpError(res, HttpCode.BAD_REQUEST, {
            error: "invalid_request",
            error_description: "Missing code or redirect_uri"
        });
    }

    // Atomically consume the auth code to prevent race conditions (TOCTOU).
    // Per RFC 6749 Section 10.5, a code presented with invalid params
    // after atomic deletion is correctly invalidated.
    const [authCode] = await db
        .delete(oauthAuthorizationCodes)
        .where(
            and(
                eq(oauthAuthorizationCodes.codeHash, hashToken(code)),
                eq(oauthAuthorizationCodes.clientId, client.clientId)
            )
        )
        .returning();

    if (!authCode) {
        return sendJsonHttpError(res, HttpCode.BAD_REQUEST, {
            error: "invalid_grant",
            error_description: "Authorization code is invalid"
        });
    }

    if (Date.now() > authCode.expiresAt) {
        return sendJsonHttpError(res, HttpCode.BAD_REQUEST, {
            error: "invalid_grant",
            error_description: "Authorization code has expired"
        });
    }

    if (authCode.redirectUri !== redirectUri) {
        return sendJsonHttpError(res, HttpCode.BAD_REQUEST, {
            error: "invalid_grant",
            error_description: "redirect_uri does not match"
        });
    }

    if (authCode.codeChallenge) {
        if (!codeVerifier) {
            return sendJsonHttpError(res, HttpCode.BAD_REQUEST, {
                error: "invalid_grant",
                error_description: "Missing PKCE code_verifier"
            });
        }

        if (authCode.codeChallengeMethod !== "S256") {
            return sendJsonHttpError(res, HttpCode.BAD_REQUEST, {
                error: "invalid_grant",
                error_description: "Unsupported code_challenge_method"
            });
        }

        if (!verifyPkce(codeVerifier, authCode.codeChallenge)) {
            return sendJsonHttpError(res, HttpCode.BAD_REQUEST, {
                error: "invalid_grant",
                error_description: "Invalid PKCE code_verifier"
            });
        }
    }

    if (!isScopeSubset(authCode.scope, client.scopes)) {
        return sendJsonHttpError(res, HttpCode.BAD_REQUEST, {
            error: "invalid_scope",
            error_description:
                "Requested scope is no longer allowed for this client"
        });
    }

    const now = Date.now();
    const grantId = generateIdFromEntropySize(12);
    const accessToken = generateAccessToken();
    const refreshToken = hasScope(authCode.scope, OFFLINE_ACCESS_SCOPE)
        ? generateRefreshToken()
        : undefined;

    await db.transaction(async (trx) => {
        await insertTokenPair(trx, {
            grantId,
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

async function issueRefreshToken(
    req: Request,
    res: Response,
    client: OauthClient
): Promise<Response | void> {
    const refreshToken = getBodyValue(req, "refresh_token");
    const scope = getBodyValue(req, "scope");

    if (!refreshToken) {
        return sendJsonHttpError(res, HttpCode.BAD_REQUEST, {
            error: "invalid_request",
            error_description: "Missing refresh_token"
        });
    }

    const now = Date.now();

    // Atomically revoke the refresh token to prevent reuse race conditions.
    // Same pattern as auth code consumption above (DELETE...RETURNING).
    try {
        const result = await db.transaction<
            Promise<sendTokenResponseParams | JsonHttpError>
        >(async (trx) => {
            const [existingRefreshToken] = await trx
                .update(oauthRefreshTokens)
                .set({ revokedAt: now })
                .where(
                    and(
                        eq(
                            oauthRefreshTokens.tokenHash,
                            hashToken(refreshToken)
                        ),
                        eq(oauthRefreshTokens.clientId, client.clientId),
                        isNull(oauthRefreshTokens.revokedAt)
                    )
                )
                .returning();

            if (!existingRefreshToken) {
                return new JsonHttpError(HttpCode.BAD_REQUEST, {
                    error: "invalid_grant",
                    error_description: "Refresh token is invalid"
                });
            }

            if (now > existingRefreshToken.expiresAt) {
                return new JsonHttpError(HttpCode.BAD_REQUEST, {
                    error: "invalid_grant",
                    error_description: "Refresh token has expired"
                });
            }

            if (
                !(await userBelongsToClientOrg(
                    existingRefreshToken.userId,
                    existingRefreshToken.clientId,
                    trx
                ))
            ) {
                return new JsonHttpError(HttpCode.BAD_REQUEST, {
                    error: "invalid_grant",
                    error_description:
                        "User no longer belongs to this client's organization"
                });
            }

            const finalScope = scope || existingRefreshToken.scope;

            if (scope && !isScopeSubset(scope, existingRefreshToken.scope)) {
                throw new JsonHttpError(HttpCode.BAD_REQUEST, {
                    error: "invalid_scope",
                    error_description: "Requested scope is not a subset"
                });
            }
            if (!isScopeSubset(finalScope, client.scopes)) {
                throw new JsonHttpError(HttpCode.BAD_REQUEST, {
                    error: "invalid_scope",
                    error_description:
                        "Requested scope is no longer allowed for this client"
                });
            }
            if (!hasScope(finalScope, "openid")) {
                throw new JsonHttpError(HttpCode.BAD_REQUEST, {
                    error: "invalid_scope",
                    error_description: "openid scope is required"
                });
            }

            const nextAccessToken = generateAccessToken();
            const nextRefreshToken = hasScope(finalScope, OFFLINE_ACCESS_SCOPE)
                ? generateRefreshToken()
                : undefined;

            await insertTokenPair(trx, {
                grantId: existingRefreshToken.grantId,
                accessToken: nextAccessToken,
                refreshToken: nextRefreshToken,
                clientId: existingRefreshToken.clientId,
                userId: existingRefreshToken.userId,
                scope: finalScope,
                now
            });

            return {
                accessToken: nextAccessToken,
                refreshToken: nextRefreshToken,
                scope: finalScope,
                userId: existingRefreshToken.userId,
                clientId: existingRefreshToken.clientId
            } as sendTokenResponseParams;
        });

        if (result instanceof JsonHttpError) {
            return sendJsonHttpError(res, result.code, result.jsonError);
        }

        return sendTokenResponse(res, result);
    } catch (error: JsonHttpError | any) {
        if (error instanceof JsonHttpError) {
            return sendJsonHttpError(res, error.code, error.jsonError);
        }

        logger.error(error);
        return sendJsonHttpError(res, HttpCode.INTERNAL_SERVER_ERROR, {
            error: "server_error",
            error_description: "An internal server error occurred"
        });
    }
}
