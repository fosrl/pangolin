import type { Request, Response } from "express";
import { and, eq } from "drizzle-orm";
import { db, oauthAccessTokens, oauthRefreshTokens } from "@server/db";
import HttpCode from "@server/types/HttpCode";
import { hashToken } from "@server/lib/oauth/tokens";
import { getBodyValue } from "@server/lib/requestParams";
import logger from "@server/logger";
import { sendJsonHttpError } from "@server/middlewares";

type OAuthTokenType = typeof oauthAccessTokens | typeof oauthRefreshTokens;

export async function revokeToken(
    req: Request,
    res: Response
): Promise<Response | void> {
    try {
        const client = req.oauthClient!;
        const token = getBodyValue(req, "token");
        const tokenTypeHint = getBodyValue(req, "token_type_hint");

        if (!token) {
            // RFC 7009 does not explicitly define that error class,
            // but it's implied by RFC 6749 §5.2
            return sendJsonHttpError(res, HttpCode.BAD_REQUEST, {
                error: "invalid_request",
                error_description: "token parameter missing"
            });
        }

        const grantId = await findGrantId(
            client.clientId,
            token,
            tokenTypeHint
        );

        if (grantId) {
            await revokeGrantById(client.clientId, grantId);
        }

        return res.status(HttpCode.OK).json({});
    } catch (error) {
        logger.error(error);
        return sendJsonHttpError(res, HttpCode.INTERNAL_SERVER_ERROR, {
            error: "server_error",
            error_description: "An internal server error occurred"
        });
    }
}

async function revokeGrantById(
    clientId: string,
    grantId: string
): Promise<void> {
    const grantWhere = (table: OAuthTokenType, grantId: string) =>
        and(eq(table.grantId, grantId), eq(table.clientId, clientId));

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

async function findGrantId(
    clientId: string,
    token: string,
    tokenTypeHint: string | null
): Promise<string | null> {
    const tokenHash = hashToken(token);

    // RFC 7009 §2.1: If the server is unable to locate the token using the given hint,
    // it MUST extend its search across all of its supported token types.
    if (tokenTypeHint === "refresh_token") {
        return (
            (await getGrantId(oauthRefreshTokens, tokenHash, clientId)) ??
            (await getGrantId(oauthAccessTokens, tokenHash, clientId))
        );
    }

    return (
        (await getGrantId(oauthAccessTokens, tokenHash, clientId)) ??
        (await getGrantId(oauthRefreshTokens, tokenHash, clientId))
    );
}

async function getGrantId(
    table: OAuthTokenType,
    tokenHash: string,
    clientId: string
): Promise<string | null> {
    const [refreshTokenRecord] = await db
        .select({ grantId: table.grantId })
        .from(table)
        .where(
            and(eq(table.tokenHash, tokenHash), eq(table.clientId, clientId))
        )
        .limit(1);
    return refreshTokenRecord?.grantId ?? null;
}
