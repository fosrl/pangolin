import { getFirstString } from "@server/lib/requestParams";
import jsonwebtoken, { JwtPayload } from "jsonwebtoken";
import { getActiveSigningPublicKeys } from "@server/lib/oauth/keys";
import { NextFunction, Request, Response } from "express";
import { getIssuerUrl } from "@server/lib/oauth/issuer";
import logger from "@server/logger";
import HttpCode from "@server/types/HttpCode";
import createHttpError from "http-errors";

export type OAuthSessionTokenIds = { clientId: string; userId: string };

export async function verifyOAuthUserTokenAccess(
    req: Request,
    res: Response,
    next: NextFunction
): Promise<Response | void> {
    const params = req.method === "POST" ? req.body : req.query;
    const idToken = await parseIdTokenHint(
        getFirstString(params?.id_token_hint)
    );

    if (!idToken) {
        return next(
            createHttpError(
                HttpCode.UNAUTHORIZED,
                "Invalid or missing id_token_hint"
            )
        );
    }

    const clientIdParam = getFirstString(params.client_id);
    if (clientIdParam && clientIdParam !== idToken.clientId) {
        logger.warn("Mismatched between token client id and client id hint.");
        return next(
            createHttpError(
                HttpCode.BAD_REQUEST,
                "client_id does not match id_token_hint"
            )
        );
    }

    req.oauthIdToken = idToken;
    return next();
}

async function parseIdTokenHint(
    idTokenHint: string | undefined
): Promise<OAuthSessionTokenIds | null> {
    if (!idTokenHint) {
        return null;
    }

    const signingKeys = await getActiveSigningPublicKeys();
    const decoded = signingKeys.reduceRight<JwtPayload | null>(
        (dec, signingKey) => {
            try {
                return (
                    dec ??
                    (jsonwebtoken.verify(idTokenHint, signingKey.publicKeyPem, {
                        algorithms: ["RS256"],
                        issuer: getIssuerUrl(),
                        ignoreExpiration: true
                    }) as JwtPayload)
                );
            } catch {
                return null;
            }
        },
        null
    );

    if (!decoded || !decoded.aud || !decoded.sub) {
        return null;
    }

    if (typeof decoded.aud !== "string") {
        return null;
    }

    const clientId = getFirstString(decoded.aud) as string;
    const userId = getFirstString(decoded.sub) as string;
    return { clientId, userId };
}
