import type { NextFunction, Request, Response } from "express";
import createHttpError from "http-errors";
import { and, eq, isNull } from "drizzle-orm";
import { fromError } from "zod-validation-error";
import { z } from "zod";
import { hashPassword } from "@server/auth/password";
import {
    db,
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
import { validScopes } from "@server/lib/oauth/scopes";
import { validateBackchannelLogoutUri } from "@server/lib/oauth/backchannelLogoutSecurity";

const paramsSchema = z.strictObject({
    orgId: z.string().min(1)
});

const clientParamsSchema = z.strictObject({
    orgId: z.string().min(1),
    clientId: z.string().min(1)
});

const createBodySchema = z.strictObject({
    clientName: z.string().min(1).max(255),
    redirectUris: z.array(z.string().url()).min(1),
    clientUri: z.string().url().optional(),
    logoUri: z.string().url().optional(),
    backchannelLogoutUri: z.string().url().optional(),
    postLogoutRedirectUris: z.array(z.string().url()).optional(),
    scopes: z
        .array(z.enum(validScopes))
        .optional()
        .default(["openid", "profile", "email"]),
    pkceRequired: z.boolean().optional().default(true),
    enabled: z.boolean().optional().default(true)
});

const updateBodySchema = z.strictObject({
    clientName: z.string().min(1).max(255).optional(),
    redirectUris: z.array(z.string().url()).min(1).optional(),
    clientUri: z.string().url().nullable().optional(),
    logoUri: z.string().url().nullable().optional(),
    backchannelLogoutUri: z.string().url().nullable().optional(),
    postLogoutRedirectUris: z.array(z.string().url()).nullable().optional(),
    scopes: z.array(z.enum(validScopes)).optional(),
    pkceRequired: z.boolean().optional(),
    enabled: z.boolean().optional()
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
    enabled: oauthClients.enabled,
    orgId: oauthClients.orgId,
    createdAt: oauthClients.createdAt,
    updatedAt: oauthClients.updatedAt,
    lastChars: oauthClients.lastChars
};

function normalizeScopes(scopes: string[]): string {
    const set = new Set(scopes);
    set.add("openid");

    return validScopes.filter((scope) => set.has(scope)).join(" ");
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

        await db.insert(oauthClients).values({
            clientId,
            clientSecretHash: await hashPassword(clientSecret),
            lastChars: clientSecret.slice(-4),
            clientName: body.clientName,
            clientUri: body.clientUri,
            logoUri: body.logoUri,
            backchannelLogoutUri: body.backchannelLogoutUri,
            postLogoutRedirectUris: body.postLogoutRedirectUris,
            redirectUris: body.redirectUris,
            scopes: normalizeScopes(body.scopes),
            pkceRequired: body.pkceRequired,
            enabled: body.enabled,
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
        const isDisablingClient =
            existingClient.enabled && body.enabled === false;

        if (backchannelLogoutError) {
            return next(
                createHttpError(HttpCode.BAD_REQUEST, backchannelLogoutError)
            );
        }

        await db.transaction(async (trx) => {
            await trx
                .update(oauthClients)
                .set({
                    clientName: body.clientName,
                    clientUri: body.clientUri,
                    logoUri: body.logoUri,
                    redirectUris: body.redirectUris,
                    scopes: body.scopes
                        ? normalizeScopes(body.scopes)
                        : undefined,
                    pkceRequired: body.pkceRequired,
                    enabled: body.enabled,
                    backchannelLogoutUri: body.backchannelLogoutUri,
                    postLogoutRedirectUris: body.postLogoutRedirectUris,
                    updatedAt: Date.now()
                })
                .where(eq(oauthClients.clientId, existingClient.clientId));

            if (isDisablingClient) {
                await trx
                    .delete(oauthAccessTokens)
                    .where(
                        eq(oauthAccessTokens.clientId, existingClient.clientId)
                    );
            }
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
            await trx
                .delete(oauthInteractions)
                .where(eq(oauthInteractions.clientId, existingClient.clientId));
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
        const now = Date.now();

        await db.transaction(async (trx) => {
            await trx
                .update(oauthClients)
                .set({
                    clientSecretHash: await hashPassword(nextClientSecret),
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
