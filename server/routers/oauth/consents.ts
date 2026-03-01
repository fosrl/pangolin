import type { Request, Response, NextFunction } from "express";
import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { fromError } from "zod-validation-error";
import {
    db,
    oauthConsents,
    oauthClients,
    oauthRefreshTokens
} from "@server/db";
import HttpCode from "@server/types/HttpCode";
import response from "@server/lib/response";
import createHttpError from "http-errors";
import logger from "@server/logger";

const deleteConsentParamsSchema = z.strictObject({
    consentId: z.string().min(1)
});

export async function listUserConsents(
    req: Request,
    res: Response,
    next: NextFunction
): Promise<Response | void> {
    try {
        const userId = req.user?.userId;
        if (!userId) {
            return next(
                createHttpError(HttpCode.UNAUTHORIZED, "User not authenticated")
            );
        }

        const consents = await db
            .select({
                consentId: oauthConsents.consentId,
                clientId: oauthConsents.clientId,
                scope: oauthConsents.scope,
                createdAt: oauthConsents.createdAt,
                clientName: oauthClients.clientName,
                clientUri: oauthClients.clientUri,
                logoUri: oauthClients.logoUri
            })
            .from(oauthConsents)
            .innerJoin(
                oauthClients,
                eq(oauthConsents.clientId, oauthClients.clientId)
            )
            .where(eq(oauthConsents.userId, userId));

        return response(res, {
            data: consents,
            success: true,
            error: false,
            message: "Consents retrieved",
            status: HttpCode.OK
        });
    } catch (e) {
        logger.error(e);
        return next(
            createHttpError(
                HttpCode.INTERNAL_SERVER_ERROR,
                "Failed to list consents"
            )
        );
    }
}

export async function deleteUserConsent(
    req: Request,
    res: Response,
    next: NextFunction
): Promise<Response | void> {
    try {
        const userId = req.user?.userId;
        if (!userId) {
            return next(
                createHttpError(HttpCode.UNAUTHORIZED, "User not authenticated")
            );
        }

        const parsedParams = deleteConsentParamsSchema.safeParse(req.params);
        if (!parsedParams.success) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    fromError(parsedParams.error).toString()
                )
            );
        }

        const { consentId } = parsedParams.data;

        // Verify consent belongs to this user
        const [consent] = await db
            .select()
            .from(oauthConsents)
            .where(
                and(
                    eq(oauthConsents.consentId, consentId),
                    eq(oauthConsents.userId, userId)
                )
            )
            .limit(1);

        if (!consent) {
            return next(
                createHttpError(HttpCode.NOT_FOUND, "Consent not found")
            );
        }

        await db.transaction(async (trx) => {
            // Revoke all active refresh tokens for this user+client pair
            await trx
                .update(oauthRefreshTokens)
                .set({ revokedAt: Date.now() })
                .where(
                    and(
                        eq(oauthRefreshTokens.userId, userId),
                        eq(oauthRefreshTokens.clientId, consent.clientId),
                        isNull(oauthRefreshTokens.revokedAt)
                    )
                );

            // Delete the consent
            await trx
                .delete(oauthConsents)
                .where(eq(oauthConsents.consentId, consentId));
        });

        return response(res, {
            data: null,
            success: true,
            error: false,
            message: "Consent revoked",
            status: HttpCode.OK
        });
    } catch (e) {
        logger.error(e);
        return next(
            createHttpError(
                HttpCode.INTERNAL_SERVER_ERROR,
                "Failed to revoke consent"
            )
        );
    }
}
