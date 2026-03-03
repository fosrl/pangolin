import type { NextFunction, Request, Response } from "express";
import createHttpError from "http-errors";
import { eq } from "drizzle-orm";
import { db, oauthAccessTokens } from "@server/db";
import HttpCode from "@server/types/HttpCode";
import { hashToken } from "@server/lib/oauth/tokens";
import { buildUserinfoClaims } from "@server/lib/oauth/claims";

function extractBearerToken(req: Request): string | null {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
        return null;
    }

    return authHeader.slice("Bearer ".length).trim();
}

export async function handleUserinfoRequest(
    req: Request,
    res: Response,
    next: NextFunction
): Promise<Response | void> {
    try {
        const token = extractBearerToken(req);

        if (!token) {
            res.setHeader("WWW-Authenticate", "Bearer");
            return next(
                createHttpError(HttpCode.UNAUTHORIZED, "Missing bearer token")
            );
        }

        const [accessToken] = await db
            .select()
            .from(oauthAccessTokens)
            .where(eq(oauthAccessTokens.tokenHash, hashToken(token)))
            .limit(1);

        if (!accessToken || Date.now() > accessToken.expiresAt) {
            res.setHeader(
                "WWW-Authenticate",
                'Bearer error="invalid_token"'
            );
            return next(
                createHttpError(
                    HttpCode.UNAUTHORIZED,
                    "Invalid or expired token"
                )
            );
        }

        const claims = await buildUserinfoClaims(
            accessToken.userId,
            accessToken.clientId,
            accessToken.scope
        );

        res.setHeader("Content-Type", "application/json");
        res.status(HttpCode.OK).json(claims);
    } catch {
        return next(
            createHttpError(
                HttpCode.INTERNAL_SERVER_ERROR,
                "Failed to process userinfo request"
            )
        );
    }
}

