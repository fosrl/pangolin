import type { NextFunction, Request, Response } from "express";
import createHttpError from "http-errors";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { fromError } from "zod-validation-error";
import { z } from "zod";
import config from "@server/lib/config";
import { encrypt } from "@server/lib/crypto";
import {
    db,
    Transaction,
    oauthClients,
    oauthAccessTokens,
    oauthAuthorizationCodes,
    oauthConsents,
    oauthInteractions,
    oauthRefreshTokens
} from "@server/db";
import HttpCode from "@server/types/HttpCode";
import logger from "@server/logger";
import response from "@server/lib/response";
import { generateIdFromEntropySize } from "@server/auth/sessions/app";
import {
    buildScopeString,
    parseScopeStringSet,
    VALID_SCOPES,
    validScopes
} from "@server/lib/oauth/scopes";
import { validateBackchannelLogoutUri } from "@server/lib/oauth/backchannelLogoutSecurity";
import { CLIENT_AUTH_METHODS } from "@server/lib/oauth/clientAuthMethods";

const paramsSchema = z.strictObject({
    orgId: z.string().min(1)
});

const clientParamsSchema = z.strictObject({
    orgId: z.string().min(1),
    clientId: z.string().min(1)
});

const createBodySchema = z.strictObject({
    clientName: z.string().min(1).max(255),
    redirectUris: z.array(z.httpUrl({ normalize: true })).min(1),
    clientUri: z.httpUrl({ normalize: true }).optional(),
    logoUri: z.httpUrl({ normalize: true }).optional(),
    backchannelLogoutUri: z.httpUrl({ normalize: true }).normalize().optional(),
    postLogoutRedirectUris: z.array(z.httpUrl({ normalize: true })).optional(),
    scopes: z
        .array(z.enum(VALID_SCOPES))
        .optional()
        .default(["openid", "profile", "email"]),
    pkceRequired: z.boolean().optional().default(true),
    clientAuthenticationMethod: z.enum(CLIENT_AUTH_METHODS).optional(),
    enabled: z.boolean().optional().default(true),
    logoutTerminatesPangolinSession: z.boolean().optional().default(false)
});

const updateBodySchema = z.strictObject({
    clientName: z.string().min(1).max(255).optional(),
    redirectUris: z
        .array(z.httpUrl({ normalize: true }))
        .min(1)
        .optional(),
    clientUri: z.httpUrl({ normalize: true }).nullable().optional(),
    logoUri: z.httpUrl({ normalize: true }).nullable().optional(),
    backchannelLogoutUri: z.httpUrl({ normalize: true }).nullable().optional(),
    postLogoutRedirectUris: z
        .array(z.httpUrl({ normalize: true }))
        .nullable()
        .optional(),
    scopes: z.array(z.enum(VALID_SCOPES)).optional(),
    pkceRequired: z.boolean().optional(),
    clientAuthenticationMethod: z.enum(CLIENT_AUTH_METHODS).optional(),
    enabled: z.boolean().optional(),
    logoutTerminatesPangolinSession: z.boolean().optional()
});

const publicClientColumns = {
    clientId: oauthClients.clientId,
    clientName: oauthClients.clientName,
    clientUri: oauthClients.clientUri,
    logoUri: oauthClients.logoUri,
    backchannelLogoutUri: oauthClients.backchannelLogoutUri,
    postLogoutRedirectUris: oauthClients.postLogoutRedirectUris,
    redirectUris: oauthClients.redirectUris,
    scopes: oauthClients.scopes,
    pkceRequired: oauthClients.pkceRequired,
    clientAuthenticationMethod: oauthClients.clientAuthenticationMethod,
    enabled: oauthClients.enabled,
    logoutTerminatesPangolinSession:
        oauthClients.logoutTerminatesPangolinSession,
    orgId: oauthClients.orgId,
    createdAt: oauthClients.createdAt,
    updatedAt: oauthClients.updatedAt,
    lastChars: oauthClients.lastChars
};

function normalizeScopes(
    scopes: string[] | Set<string>,
    _validScopes: Set<string> = validScopes
): Set<string> {
    const set = new Set([...scopes, "openid"]);
    return _validScopes.intersection(set);
}

function getBackchannelLogoutValidationError(
    backchannelLogoutUri: string | null | undefined
): string | null {
    if (!backchannelLogoutUri) {
        return null;
    }

    return validateBackchannelLogoutUri(backchannelLogoutUri);
}

export async function createOAuthClient(
    req: Request,
    res: Response,
    next: NextFunction
): Promise<Response | void> {
    try {
        const parsedParams = paramsSchema.safeParse(req.params);
        if (!parsedParams.success) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    fromError(parsedParams.error).toString()
                )
            );
        }

        const parsedBody = createBodySchema.safeParse(req.body);
        if (!parsedBody.success) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    fromError(parsedBody.error).toString()
                )
            );
        }

        const { orgId } = parsedParams.data;
        const body = parsedBody.data;
        const backchannelLogoutError = getBackchannelLogoutValidationError(
            body.backchannelLogoutUri
        );

        if (backchannelLogoutError) {
            return next(
                createHttpError(HttpCode.BAD_REQUEST, backchannelLogoutError)
            );
        }

        const clientId = generateIdFromEntropySize(25);
        const clientSecret = generateIdFromEntropySize(32);
        const key = config.getRawConfig().server.secret!;
        const scopes = normalizeScopes(body.scopes);

        await db.insert(oauthClients).values({
            clientId,
            clientSecret: encrypt(clientSecret, key),
            lastChars: clientSecret.slice(-4),
            clientName: body.clientName,
            clientUri: body.clientUri,
            logoUri: body.logoUri,
            backchannelLogoutUri: body.backchannelLogoutUri,
            postLogoutRedirectUris: body.postLogoutRedirectUris,
            redirectUris: body.redirectUris,
            scopes: buildScopeString(scopes),
            pkceRequired: body.pkceRequired,
            clientAuthenticationMethod:
                body.clientAuthenticationMethod ?? "client_secret_jwt",
            enabled: body.enabled,
            logoutTerminatesPangolinSession:
                body.logoutTerminatesPangolinSession,
            orgId,
            createdAt: Date.now(),
            updatedAt: Date.now()
        });

        return response(res, {
            data: {
                clientId,
                clientSecret
            },
            success: true,
            error: false,
            message: "OAuth client created",
            status: HttpCode.CREATED
        });
    } catch (error) {
        logger.error(error);
        return next(
            createHttpError(
                HttpCode.INTERNAL_SERVER_ERROR,
                "Failed to create OAuth client"
            )
        );
    }
}

export async function listOAuthClients(
    req: Request,
    res: Response,
    next: NextFunction
): Promise<Response | void> {
    try {
        const parsedParams = paramsSchema.safeParse(req.params);
        if (!parsedParams.success) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    fromError(parsedParams.error).toString()
                )
            );
        }

        const clients = await db
            .select(publicClientColumns)
            .from(oauthClients)
            .where(eq(oauthClients.orgId, parsedParams.data.orgId));

        return response(res, {
            data: {
                clients
            },
            success: true,
            error: false,
            message: "OAuth clients retrieved",
            status: HttpCode.OK
        });
    } catch (error) {
        logger.error(error);
        return next(
            createHttpError(
                HttpCode.INTERNAL_SERVER_ERROR,
                "Failed to list OAuth clients"
            )
        );
    }
}

export async function getOAuthClient(
    req: Request,
    res: Response,
    next: NextFunction
): Promise<Response | void> {
    try {
        const parsedParams = clientParamsSchema.safeParse(req.params);
        if (!parsedParams.success) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    fromError(parsedParams.error).toString()
                )
            );
        }

        const [client] = await db
            .select(publicClientColumns)
            .from(oauthClients)
            .where(
                and(
                    eq(oauthClients.orgId, parsedParams.data.orgId),
                    eq(oauthClients.clientId, parsedParams.data.clientId)
                )
            )
            .limit(1);

        if (!client) {
            return next(
                createHttpError(HttpCode.NOT_FOUND, "OAuth client not found")
            );
        }

        return response(res, {
            data: {
                client
            },
            success: true,
            error: false,
            message: "OAuth client retrieved",
            status: HttpCode.OK
        });
    } catch (error) {
        logger.error(error);
        return next(
            createHttpError(
                HttpCode.INTERNAL_SERVER_ERROR,
                "Failed to get OAuth client"
            )
        );
    }
}

export async function updateOAuthClient(
    req: Request,
    res: Response,
    next: NextFunction
): Promise<Response | void> {
    try {
        const parsedParams = clientParamsSchema.safeParse(req.params);
        if (!parsedParams.success) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    fromError(parsedParams.error).toString()
                )
            );
        }

        const parsedBody = updateBodySchema.safeParse(req.body);
        if (!parsedBody.success) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    fromError(parsedBody.error).toString()
                )
            );
        }

        const [existingClient] = await db
            .select()
            .from(oauthClients)
            .where(
                and(
                    eq(oauthClients.orgId, parsedParams.data.orgId),
                    eq(oauthClients.clientId, parsedParams.data.clientId)
                )
            )
            .limit(1);

        if (!existingClient) {
            return next(
                createHttpError(HttpCode.NOT_FOUND, "OAuth client not found")
            );
        }

        const body = parsedBody.data;
        const backchannelLogoutError = getBackchannelLogoutValidationError(
            body.backchannelLogoutUri
        );

        if (backchannelLogoutError) {
            return next(
                createHttpError(HttpCode.BAD_REQUEST, backchannelLogoutError)
            );
        }

        const previousScopes = normalizeScopes(
            parseScopeStringSet(existingClient.scopes)
        );
        const updatedScopes = body.scopes
            ? normalizeScopes(body.scopes)
            : previousScopes;
        const removedScopes = previousScopes.difference(updatedScopes);

        await db.transaction(async (trx) => {
            await trx
                .update(oauthClients)
                .set({
                    clientName: body.clientName,
                    clientUri: body.clientUri,
                    logoUri: body.logoUri,
                    redirectUris: body.redirectUris,
                    pkceRequired: body.pkceRequired,
                    clientAuthenticationMethod: body.clientAuthenticationMethod,
                    enabled: body.enabled,
                    logoutTerminatesPangolinSession:
                        body.logoutTerminatesPangolinSession,
                    backchannelLogoutUri: body.backchannelLogoutUri,
                    postLogoutRedirectUris: body.postLogoutRedirectUris,
                    updatedAt: Date.now(),

                    // Only update scopes if requested
                    ...(body.scopes
                        ? { scopes: buildScopeString(updatedScopes) }
                        : {})
                })
                .where(eq(oauthClients.clientId, existingClient.clientId));

            // Invalidate **all** tokens touched by these changes
            if (existingClient.enabled && body.enabled === false) {
                await invalidateTokensFromClient(trx, existingClient.clientId);
            } else if (removedScopes.size > 0) {
                await invalidateTokensWithReducedScopes(
                    trx,
                    existingClient.clientId,
                    removedScopes
                );
            }

            // Check and update consents, if scope was reduced
            await reduceUserConsentScope(
                trx,
                existingClient.clientId,
                updatedScopes
            );
        });

        return response(res, {
            data: null,
            success: true,
            error: false,
            message: "OAuth client updated",
            status: HttpCode.OK
        });
    } catch (error) {
        logger.error(error);
        return next(
            createHttpError(
                HttpCode.INTERNAL_SERVER_ERROR,
                "Failed to update OAuth client"
            )
        );
    }
}

export async function deleteOAuthClient(
    req: Request,
    res: Response,
    next: NextFunction
): Promise<Response | void> {
    try {
        const parsedParams = clientParamsSchema.safeParse(req.params);
        if (!parsedParams.success) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    fromError(parsedParams.error).toString()
                )
            );
        }

        const [existingClient] = await db
            .select()
            .from(oauthClients)
            .where(
                and(
                    eq(oauthClients.orgId, parsedParams.data.orgId),
                    eq(oauthClients.clientId, parsedParams.data.clientId)
                )
            )
            .limit(1);

        if (!existingClient) {
            return next(
                createHttpError(HttpCode.NOT_FOUND, "OAuth client not found")
            );
        }

        await db.transaction(async (trx) => {
            await invalidateTokensFromClient(trx, existingClient.clientId);
            await trx
                .delete(oauthRefreshTokens)
                .where(
                    eq(oauthRefreshTokens.clientId, existingClient.clientId)
                );
            await trx
                .delete(oauthConsents)
                .where(eq(oauthConsents.clientId, existingClient.clientId));
            await trx
                .delete(oauthClients)
                .where(eq(oauthClients.clientId, existingClient.clientId));
        });

        return response(res, {
            data: null,
            success: true,
            error: false,
            message: "OAuth client deleted",
            status: HttpCode.OK
        });
    } catch (error) {
        logger.error(error);
        return next(
            createHttpError(
                HttpCode.INTERNAL_SERVER_ERROR,
                "Failed to delete OAuth client"
            )
        );
    }
}

export async function rotateOAuthClientSecret(
    req: Request,
    res: Response,
    next: NextFunction
): Promise<Response | void> {
    try {
        const parsedParams = clientParamsSchema.safeParse(req.params);
        if (!parsedParams.success) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    fromError(parsedParams.error).toString()
                )
            );
        }

        const [existingClient] = await db
            .select()
            .from(oauthClients)
            .where(
                and(
                    eq(oauthClients.orgId, parsedParams.data.orgId),
                    eq(oauthClients.clientId, parsedParams.data.clientId)
                )
            )
            .limit(1);

        if (!existingClient) {
            return next(
                createHttpError(HttpCode.NOT_FOUND, "OAuth client not found")
            );
        }

        const nextClientSecret = generateIdFromEntropySize(32);
        const key = config.getRawConfig().server.secret!;
        const now = Date.now();

        await db.transaction(async (trx) => {
            await trx
                .update(oauthClients)
                .set({
                    clientSecret: encrypt(nextClientSecret, key),
                    lastChars: nextClientSecret.slice(-4),
                    updatedAt: now
                })
                .where(eq(oauthClients.clientId, existingClient.clientId));

            await trx
                .delete(oauthAuthorizationCodes)
                .where(
                    eq(
                        oauthAuthorizationCodes.clientId,
                        existingClient.clientId
                    )
                );
            await trx
                .delete(oauthAccessTokens)
                .where(eq(oauthAccessTokens.clientId, existingClient.clientId));
            await trx
                .update(oauthRefreshTokens)
                .set({ revokedAt: now })
                .where(
                    and(
                        eq(
                            oauthRefreshTokens.clientId,
                            existingClient.clientId
                        ),
                        isNull(oauthRefreshTokens.revokedAt)
                    )
                );
        });

        return response(res, {
            data: {
                clientId: existingClient.clientId,
                clientSecret: nextClientSecret
            },
            success: true,
            error: false,
            message: "OAuth client secret rotated",
            status: HttpCode.OK
        });
    } catch (error) {
        logger.error(error);
        return next(
            createHttpError(
                HttpCode.INTERNAL_SERVER_ERROR,
                "Failed to rotate OAuth client secret"
            )
        );
    }
}

async function invalidateTokensWithReducedScopes(
    trx: Transaction | typeof db,
    clientId: string,
    removedScopes: Set<string>
): Promise<void> {
    // Scope reduction: invalidate tokens that still carry a removed scope.
    const findInvalidToken = (
        tokens: { tokenId: string; scope: string }[]
    ): string[] =>
        tokens
            .filter(
                (token) =>
                    !parseScopeStringSet(token.scope).isDisjointFrom(
                        removedScopes
                    )
            )
            .map((token) => token.tokenId);

    // Handle access tokens
    const accessTokens = await trx
        .select({
            tokenId: oauthAccessTokens.accessTokenId,
            scope: oauthAccessTokens.scope
        })
        .from(oauthAccessTokens)
        .where(eq(oauthAccessTokens.clientId, clientId));

    const staleAccessTokenIds = findInvalidToken(accessTokens);
    if (staleAccessTokenIds.length) {
        await trx
            .delete(oauthAccessTokens)
            .where(
                inArray(oauthAccessTokens.accessTokenId, staleAccessTokenIds)
            );
    }

    // Handle refresh tokens
    const refreshTokens = await trx
        .select({
            tokenId: oauthRefreshTokens.refreshTokenId,
            scope: oauthRefreshTokens.scope
        })
        .from(oauthRefreshTokens)
        .where(
            and(
                eq(oauthRefreshTokens.clientId, clientId),
                isNull(oauthRefreshTokens.revokedAt)
            )
        );

    const staleRefreshTokenIds = findInvalidToken(refreshTokens);
    if (staleRefreshTokenIds.length) {
        await trx
            .update(oauthRefreshTokens)
            .set({ revokedAt: Date.now() })
            .where(
                inArray(oauthRefreshTokens.refreshTokenId, staleRefreshTokenIds)
            );
    }

    // Handle interactions
    const interactions = await trx
        .select({
            tokenId: oauthInteractions.interactionId,
            scope: oauthInteractions.scope
        })
        .from(oauthInteractions)
        .where(eq(oauthInteractions.clientId, clientId));

    const staleInteractions = findInvalidToken(interactions);
    await trx
        .delete(oauthInteractions)
        .where(inArray(oauthInteractions.interactionId, staleInteractions));

    // Handle authorization codes
    const authCodes = await trx
        .select({
            tokenId: oauthAuthorizationCodes.codeId,
            scope: oauthAuthorizationCodes.scope
        })
        .from(oauthAuthorizationCodes)
        .where(eq(oauthAuthorizationCodes.clientId, clientId));

    const staleAuthCodes = findInvalidToken(authCodes);
    await trx
        .delete(oauthAuthorizationCodes)
        .where(inArray(oauthAuthorizationCodes.codeId, staleAuthCodes));
}

async function reduceUserConsentScope(
    trx: Transaction,
    clientId: string,
    updatedScopes: Set<string>
): Promise<void> {
    const consents = await trx
        .select({
            consentId: oauthConsents.consentId,
            scope: oauthConsents.scope
        })
        .from(oauthConsents)
        .where(eq(oauthConsents.clientId, clientId));

    for (const consent of consents) {
        const consentScopes = parseScopeStringSet(consent.scope);
        const normalizedScopes = normalizeScopes(consentScopes, updatedScopes);

        if (!normalizedScopes.symmetricDifference(consentScopes).size) continue;

        await trx
            .update(oauthConsents)
            .set({
                scope: buildScopeString(normalizedScopes),
                updatedAt: Date.now()
            })
            .where(eq(oauthConsents.consentId, consent.consentId));
    }
}

async function invalidateTokensFromClient(
    trx: Transaction,
    clientId: string
): Promise<void> {
    await trx
        .delete(oauthInteractions)
        .where(eq(oauthInteractions.clientId, clientId));
    await trx
        .delete(oauthAuthorizationCodes)
        .where(eq(oauthAuthorizationCodes.clientId, clientId));
    await trx
        .delete(oauthAccessTokens)
        .where(eq(oauthAccessTokens.clientId, clientId));
    await trx
        .update(oauthRefreshTokens)
        .set({ revokedAt: Date.now() })
        .where(
            and(
                eq(oauthRefreshTokens.clientId, clientId),
                isNull(oauthRefreshTokens.revokedAt)
            )
        );
}
