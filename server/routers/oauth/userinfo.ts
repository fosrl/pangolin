import type { NextFunction, Request, Response } from "express";
import createHttpError from "http-errors";
import { eq } from "drizzle-orm";
import { db, oauthAccessTokens, oauthClients } from "@server/db";
import HttpCode from "@server/types/HttpCode";
import { hashToken } from "@server/lib/oauth/tokens";
import logger from "@server/logger";
import { buildUserinfoClaims } from "@server/lib/oauth/claims";
import { userBelongsToClientOrg } from "@server/lib/oauth/clientMembership";
import { sendOAuthInvalidTokenError } from "@server/middlewares";

export async function handleUserinfoRequest(
    req: Request,
    res: Response,
    next: NextFunction
): Promise<Response | void> {
    try {
        const token = req.oauthBearerToken!;
        const [accessToken] = await db
            .select({
                userId: oauthAccessTokens.userId,
                clientId: oauthAccessTokens.clientId,
                scope: oauthAccessTokens.scope,
                expiresAt: oauthAccessTokens.expiresAt,
                clientEnabled: oauthClients.enabled
            })
            .from(oauthAccessTokens)
            .innerJoin(
                oauthClients,
                eq(oauthAccessTokens.clientId, oauthClients.clientId)
            )
            .where(eq(oauthAccessTokens.tokenHash, hashToken(token)))
            .limit(1);

        if (
            !accessToken ||
            Date.now() > accessToken.expiresAt ||
            !accessToken.clientEnabled
        ) {
            return sendOAuthInvalidTokenError(res);
        }

        if (
            !(await userBelongsToClientOrg(
                accessToken.userId,
                accessToken.clientId
            ))
        ) {
            return sendOAuthInvalidTokenError(res);
        }

        const claims = await buildUserinfoClaims(
            accessToken.userId,
            accessToken.clientId,
            accessToken.scope
        );

        res.setHeader("Cache-Control", "no-store");
        res.setHeader("Pragma", "no-cache");
        res.status(HttpCode.OK).json(claims);
    } catch (error) {
        logger.error(error);
        return next(
            createHttpError(
                HttpCode.INTERNAL_SERVER_ERROR,
                "Failed to process userinfo request"
            )
        );
    }
}
