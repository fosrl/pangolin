import type { NextFunction, Request, Response } from "express";
import createHttpError from "http-errors";
import { and, eq } from "drizzle-orm";
import { fromError } from "zod-validation-error";
import { z } from "zod";
import {
    db,
    oauthAuthorizationCodes,
    oauthClients,
    oauthConsents,
    oauthInteractions
} from "@server/db";
import HttpCode from "@server/types/HttpCode";
import logger from "@server/logger";
import response from "@server/lib/response";
import {
    hasScope,
    isScopeSubset,
    validateScopes,
    parseScopeString
} from "@server/lib/oauth/scopes";
import {
    AUTH_CODE_LIFETIME_MS,
    INTERACTION_LIFETIME_MS
} from "@server/lib/oauth/lifetimes";
import { generateAuthorizationCode, hashToken } from "@server/lib/oauth/tokens";
import { generateIdFromEntropySize } from "@server/auth/sessions/app";
import { Transaction } from "@server/db";

const initiateSchema = z.strictObject({
    response_type: z.string(),
    client_id: z.string().min(1),
    redirect_uri: z.string().min(1),
    scope: z.string().min(1),
    state: z.string().min(1),
    code_challenge: z.string().optional(),
    code_challenge_method: z.string().optional(),
    nonce: z.string().optional()
});

const consentSchema = z.strictObject({
    interactionId: z.string().min(1),
    approved: z.boolean()
});

type InitiateResponseData =
    | {
          redirectTo: string;
      }
    | {
          interactionId: string;
          clientName: string;
          clientUri: string | null;
          logoUri: string | null;
          requestedScopes: string[];
          user: {
              name: string | null;
              email: string | null;
              username: string;
          };
      };


function appendOAuthParams(
    redirectUri: string,
    params: Record<string, string>
): string {
    try {
        const url = new URL(redirectUri);
        for (const [key, value] of Object.entries(params)) {
            url.searchParams.set(key, value);
        }
        return url.toString();
    } catch {
        const query = new URLSearchParams(params).toString();
        const separator = redirectUri.includes("?") ? "&" : "?";
        return `${redirectUri}${separator}${query}`;
    }
}

async function issueAuthorizationCode(
    args: {
        clientId: string;
        userId: string;
        scope: string;
        redirectUri: string;
        codeChallenge?: string | null;
        codeChallengeMethod?: string | null;
        nonce?: string | null;
    },
    trx: Transaction | typeof db = db
): Promise<string> {
    const code = generateAuthorizationCode();
    const now = Date.now();

    await trx.insert(oauthAuthorizationCodes).values({
        codeId: generateIdFromEntropySize(12),
        codeHash: hashToken(code),
        clientId: args.clientId,
        userId: args.userId,
        scope: args.scope,
        redirectUri: args.redirectUri,
        codeChallenge: args.codeChallenge,
        codeChallengeMethod: args.codeChallengeMethod,
        nonce: args.nonce,
        expiresAt: now + AUTH_CODE_LIFETIME_MS,
        createdAt: now
    });

    return code;
}

export async function initiateAuthorization(
    req: Request,
    res: Response,
    next: NextFunction
): Promise<Response | void> {
    try {
        const parsed = initiateSchema.safeParse(req.body);
        if (!parsed.success) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    fromError(parsed.error).toString()
                )
            );
        }

        const userId = req.user?.userId;
        if (!userId) {
            return next(
                createHttpError(HttpCode.UNAUTHORIZED, "User not authenticated")
            );
        }

        const body = parsed.data;

        if (body.response_type !== "code") {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    "Unsupported response_type"
                )
            );
        }

        const [client] = await db
            .select()
            .from(oauthClients)
            .where(eq(oauthClients.clientId, body.client_id))
            .limit(1);

        if (!client || !client.enabled) {
            return next(
                createHttpError(HttpCode.BAD_REQUEST, "Invalid OAuth client")
            );
        }

        if (!client.redirectUris.includes(body.redirect_uri)) {
            return next(
                createHttpError(HttpCode.BAD_REQUEST, "Invalid redirect_uri")
            );
        }

        if (client.pkceRequired && !body.code_challenge) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    "PKCE code_challenge is required"
                )
            );
        }

        if (body.code_challenge && body.code_challenge_method !== "S256") {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    "Only S256 code_challenge_method is supported"
                )
            );
        }

        const grantedScope = validateScopes(body.scope, client.scopes);
        if (!grantedScope) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    "No valid scopes requested"
                )
            );
        }
        if (!hasScope(grantedScope, "openid")) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    "openid scope is required"
                )
            );
        }

        const [existingConsent] = await db
            .select()
            .from(oauthConsents)
            .where(
                and(
                    eq(oauthConsents.userId, userId),
                    eq(oauthConsents.clientId, client.clientId)
                )
            )
            .limit(1);

        if (
            existingConsent &&
            isScopeSubset(grantedScope, existingConsent.scope)
        ) {
            const code = await issueAuthorizationCode({
                clientId: client.clientId,
                userId,
                scope: grantedScope,
                redirectUri: body.redirect_uri,
                codeChallenge: body.code_challenge,
                codeChallengeMethod: body.code_challenge_method,
                nonce: body.nonce
            });

            const redirectTo = appendOAuthParams(body.redirect_uri, {
                code,
                state: body.state
            });

            return response<InitiateResponseData>(res, {
                data: {
                    redirectTo
                },
                success: true,
                error: false,
                message: "Authorization code generated",
                status: HttpCode.OK
            });
        }

        const interactionId = generateIdFromEntropySize(12);

        await db.insert(oauthInteractions).values({
            interactionId,
            clientId: client.clientId,
            userId,
            scope: grantedScope,
            state: body.state,
            nonce: body.nonce,
            redirectUri: body.redirect_uri,
            codeChallenge: body.code_challenge,
            codeChallengeMethod: body.code_challenge_method,
            responseType: body.response_type,
            expiresAt: Date.now() + INTERACTION_LIFETIME_MS,
            createdAt: Date.now()
        });

        return response<InitiateResponseData>(res, {
            data: {
                interactionId,
                clientName: client.clientName,
                clientUri: client.clientUri,
                logoUri: client.logoUri,
                requestedScopes: parseScopeString(grantedScope),
                user: {
                    name: req.user?.name ?? null,
                    email: req.user?.email ?? null,
                    username: req.user!.username
                }
            },
            success: true,
            error: false,
            message: "Consent required",
            status: HttpCode.OK
        });
    } catch (error) {
        logger.error(error);
        return next(
            createHttpError(
                HttpCode.INTERNAL_SERVER_ERROR,
                "Failed to initiate authorization"
            )
        );
    }
}

export async function handleAuthorizationConsent(
    req: Request,
    res: Response,
    next: NextFunction
): Promise<Response | void> {
    try {
        const parsed = consentSchema.safeParse(req.body);
        if (!parsed.success) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    fromError(parsed.error).toString()
                )
            );
        }

        const userId = req.user?.userId;
        if (!userId) {
            return next(
                createHttpError(HttpCode.UNAUTHORIZED, "User not authenticated")
            );
        }

        const { interactionId, approved } = parsed.data;

        const [interaction] = await db
            .select()
            .from(oauthInteractions)
            .where(eq(oauthInteractions.interactionId, interactionId))
            .limit(1);

        if (!interaction) {
            return next(
                createHttpError(HttpCode.NOT_FOUND, "Interaction not found")
            );
        }

        if (interaction.userId !== userId) {
            return next(
                createHttpError(HttpCode.FORBIDDEN, "Invalid interaction owner")
            );
        }

        if (Date.now() > interaction.expiresAt) {
            await db
                .delete(oauthInteractions)
                .where(
                    eq(
                        oauthInteractions.interactionId,
                        interaction.interactionId
                    )
                );
            return next(
                createHttpError(HttpCode.BAD_REQUEST, "Interaction expired")
            );
        }

        if (!approved) {
            await db
                .delete(oauthInteractions)
                .where(
                    eq(
                        oauthInteractions.interactionId,
                        interaction.interactionId
                    )
                );

            const redirectTo = appendOAuthParams(interaction.redirectUri, {
                error: "access_denied",
                state: interaction.state
            });

            return response<{ redirectTo: string }>(res, {
                data: {
                    redirectTo
                },
                success: true,
                error: false,
                message: "Authorization denied",
                status: HttpCode.OK
            });
        }

        const now = Date.now();

        const code = generateAuthorizationCode();

        await db.transaction(async (trx) => {
            const [existingConsent] = await trx
                .select()
                .from(oauthConsents)
                .where(
                    and(
                        eq(oauthConsents.userId, interaction.userId),
                        eq(oauthConsents.clientId, interaction.clientId)
                    )
                )
                .limit(1);

            if (existingConsent) {
                const mergedScopes = new Set([
                    ...parseScopeString(existingConsent.scope),
                    ...parseScopeString(interaction.scope)
                ]);

                await trx
                    .update(oauthConsents)
                    .set({
                        scope: Array.from(mergedScopes).join(" "),
                        updatedAt: now
                    })
                    .where(
                        eq(oauthConsents.consentId, existingConsent.consentId)
                    );
            } else {
                await trx.insert(oauthConsents).values({
                    consentId: generateIdFromEntropySize(12),
                    userId: interaction.userId,
                    clientId: interaction.clientId,
                    scope: interaction.scope,
                    createdAt: now,
                    updatedAt: now
                });
            }

            await trx.insert(oauthAuthorizationCodes).values({
                codeId: generateIdFromEntropySize(12),
                codeHash: hashToken(code),
                clientId: interaction.clientId,
                userId: interaction.userId,
                scope: interaction.scope,
                redirectUri: interaction.redirectUri,
                codeChallenge: interaction.codeChallenge,
                codeChallengeMethod: interaction.codeChallengeMethod,
                nonce: interaction.nonce,
                expiresAt: now + AUTH_CODE_LIFETIME_MS,
                createdAt: now
            });

            await trx
                .delete(oauthInteractions)
                .where(
                    eq(
                        oauthInteractions.interactionId,
                        interaction.interactionId
                    )
                );
        });

        const redirectTo = appendOAuthParams(interaction.redirectUri, {
            code,
            state: interaction.state
        });

        return response<{ redirectTo: string }>(res, {
            data: {
                redirectTo
            },
            success: true,
            error: false,
            message: "Authorization granted",
            status: HttpCode.OK
        });
    } catch (error) {
        logger.error(error);
        return next(
            createHttpError(
                HttpCode.INTERNAL_SERVER_ERROR,
                "Failed to process consent"
            )
        );
    }
}
