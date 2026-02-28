import type { Request, Response } from "express";
import { createHash } from "crypto";
import { and, eq, isNull } from "drizzle-orm";
import { verifyPassword } from "@server/auth/password";
import {
    db,
    oauthAccessTokens,
    oauthAuthorizationCodes,
    oauthClients,
    oauthRefreshTokens
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
import { parseScopeString } from "@server/lib/oauth/scopes";
import logger from "@server/logger";

type OAuthClientRecord = typeof oauthClients.$inferSelect;

type OAuthError = {
    error: string;
    error_description: string;
};

function getBodyValue(body: unknown, key: string): string | undefined {
    if (!body || typeof body !== "object") {
        return undefined;
    }

    const value = Reflect.get(body, key);

    if (typeof value === "string") {
        return value;
    }

    if (
        Array.isArray(value) &&
        value.length > 0 &&
        typeof value[0] === "string"
    ) {
        return value[0];
    }

    return undefined;
}

function sendOAuthError(
    res: Response,
    status: number,
    oauthError: OAuthError
): void {
    res.status(status).json(oauthError);
}

function parseBasicAuth(
    authorizationHeader: string | undefined
): { clientId: string; clientSecret: string } | null {
    if (!authorizationHeader || !authorizationHeader.startsWith("Basic ")) {
        return null;
    }

    const encoded = authorizationHeader.slice("Basic ".length);

    try {
        const decoded = Buffer.from(encoded, "base64").toString("utf8");
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

async function authenticateClient(
    req: Request
): Promise<
    { client: OAuthClientRecord } | { status: number; oauthError: OAuthError }
> {
    const basicCredentials = parseBasicAuth(req.headers.authorization);

    const clientId =
        basicCredentials?.clientId || getBodyValue(req.body, "client_id");
    const clientSecret =
        basicCredentials?.clientSecret ||
        getBodyValue(req.body, "client_secret");

    if (!clientId) {
        return {
            status: HttpCode.UNAUTHORIZED,
            oauthError: {
                error: "invalid_client",
                error_description: "Missing client_id"
            }
        };
    }

    const [client] = await db
        .select()
        .from(oauthClients)
        .where(eq(oauthClients.clientId, clientId))
        .limit(1);

    if (!client || !client.enabled) {
        return {
            status: HttpCode.UNAUTHORIZED,
            oauthError: {
                error: "invalid_client",
                error_description: "Invalid client credentials"
            }
        };
    }

    if (client.clientSecretHash) {
        if (!clientSecret) {
            return {
                status: HttpCode.UNAUTHORIZED,
                oauthError: {
                    error: "invalid_client",
                    error_description: "Missing client_secret"
                }
            };
        }

        const validSecret = await verifyPassword(
            clientSecret,
            client.clientSecretHash
        );
        if (!validSecret) {
            return {
                status: HttpCode.UNAUTHORIZED,
                oauthError: {
                    error: "invalid_client",
                    error_description: "Invalid client credentials"
                }
            };
        }
    }

    return { client };
}

function verifyPkce(codeVerifier: string, codeChallenge: string): boolean {
    const hash = createHash("sha256").update(codeVerifier).digest();
    return hash.toString("base64url") === codeChallenge;
}

function isScopeSubset(candidateScope: string, originalScope: string): boolean {
    const original = new Set(parseScopeString(originalScope));
    const candidate = parseScopeString(candidateScope);

    return candidate.every((scope) => original.has(scope));
}

export async function issueToken(
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

            const [authCode] = await db
                .select()
                .from(oauthAuthorizationCodes)
                .where(eq(oauthAuthorizationCodes.codeHash, hashToken(code)))
                .limit(1);

            if (!authCode) {
                return sendOAuthError(res, HttpCode.BAD_REQUEST, {
                    error: "invalid_grant",
                    error_description: "Authorization code is invalid"
                });
            }

            if (Date.now() > authCode.expiresAt) {
                await db
                    .delete(oauthAuthorizationCodes)
                    .where(eq(oauthAuthorizationCodes.codeId, authCode.codeId));
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
            const refreshToken = generateRefreshToken();

            await db.transaction(async (trx) => {
                await trx
                    .delete(oauthAuthorizationCodes)
                    .where(eq(oauthAuthorizationCodes.codeId, authCode.codeId));

                await trx.insert(oauthAccessTokens).values({
                    accessTokenId: generateIdFromEntropySize(12),
                    tokenHash: hashToken(accessToken),
                    clientId: authCode.clientId,
                    userId: authCode.userId,
                    scope: authCode.scope,
                    expiresAt: now + 60 * 60 * 1000,
                    createdAt: now
                });

                await trx.insert(oauthRefreshTokens).values({
                    refreshTokenId: generateIdFromEntropySize(12),
                    tokenHash: hashToken(refreshToken),
                    clientId: authCode.clientId,
                    userId: authCode.userId,
                    scope: authCode.scope,
                    expiresAt: now + 30 * 24 * 60 * 60 * 1000,
                    createdAt: now
                });
            });

            const includeIdToken = parseScopeString(authCode.scope).includes(
                "openid"
            );

            const responseBody: Record<string, unknown> = {
                access_token: accessToken,
                token_type: "Bearer",
                expires_in: 3600,
                refresh_token: refreshToken,
                scope: authCode.scope
            };

            if (includeIdToken) {
                const claims = await buildIdTokenClaims(
                    authCode.userId,
                    authCode.clientId,
                    authCode.scope,
                    authCode.nonce || undefined
                );
                const signingKey = await getActiveSigningKey();

                responseBody.id_token = signIdToken(
                    claims,
                    signingKey.privateKeyPem,
                    signingKey.keyId
                );
            }

            return res.status(HttpCode.OK).json(responseBody);
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

            const [existingRefreshToken] = await db
                .select()
                .from(oauthRefreshTokens)
                .where(
                    and(
                        eq(
                            oauthRefreshTokens.tokenHash,
                            hashToken(refreshToken)
                        ),
                        isNull(oauthRefreshTokens.revokedAt)
                    )
                )
                .limit(1);

            if (!existingRefreshToken) {
                return sendOAuthError(res, HttpCode.BAD_REQUEST, {
                    error: "invalid_grant",
                    error_description: "Refresh token is invalid"
                });
            }

            if (Date.now() > existingRefreshToken.expiresAt) {
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
            if (!parseScopeString(finalScope).includes("openid")) {
                return sendOAuthError(res, HttpCode.BAD_REQUEST, {
                    error: "invalid_scope",
                    error_description: "openid scope is required"
                });
            }

            const now = Date.now();
            const nextAccessToken = generateAccessToken();
            const nextRefreshToken = generateRefreshToken();

            await db.transaction(async (trx) => {
                await trx
                    .update(oauthRefreshTokens)
                    .set({
                        revokedAt: now
                    })
                    .where(
                        eq(
                            oauthRefreshTokens.refreshTokenId,
                            existingRefreshToken.refreshTokenId
                        )
                    );

                await trx.insert(oauthAccessTokens).values({
                    accessTokenId: generateIdFromEntropySize(12),
                    tokenHash: hashToken(nextAccessToken),
                    clientId: existingRefreshToken.clientId,
                    userId: existingRefreshToken.userId,
                    scope: finalScope,
                    expiresAt: now + 60 * 60 * 1000,
                    createdAt: now
                });

                await trx.insert(oauthRefreshTokens).values({
                    refreshTokenId: generateIdFromEntropySize(12),
                    tokenHash: hashToken(nextRefreshToken),
                    clientId: existingRefreshToken.clientId,
                    userId: existingRefreshToken.userId,
                    scope: finalScope,
                    expiresAt: now + 30 * 24 * 60 * 60 * 1000,
                    createdAt: now
                });
            });

            const claims = await buildIdTokenClaims(
                existingRefreshToken.userId,
                existingRefreshToken.clientId,
                finalScope
            );
            const signingKey = await getActiveSigningKey();

            return res.status(HttpCode.OK).json({
                access_token: nextAccessToken,
                token_type: "Bearer",
                expires_in: 3600,
                refresh_token: nextRefreshToken,
                id_token: signIdToken(
                    claims,
                    signingKey.privateKeyPem,
                    signingKey.keyId
                ),
                scope: finalScope
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
