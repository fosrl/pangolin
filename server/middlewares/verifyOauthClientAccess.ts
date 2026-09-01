import type { NextFunction, Request, Response } from "express";
import { authenticateClient } from "@server/lib/oauth/clientAuth";
import HttpCode from "@server/types/HttpCode";
import logger from "@server/logger";

export type JsonErrorType = { error: string; error_description?: string };

export async function verifyOauthClient(
    req: Request,
    res: Response,
    next: NextFunction
): Promise<Response | void> {
    try {
        req.oauthClient = await authenticateClient(req);
        return next();
    } catch (error) {
        logger.warn(error);
    }

    return sendOAuthClientError(
        res,
        HttpCode.UNAUTHORIZED,
        {
            error: "invalid_client",
            error_description: "Invalid client credentials"
        },
        !!req.headers.authorization
    );
}

export function sendOAuthClientError(
    res: Response,
    status: HttpCode,
    oauthError: JsonErrorType,
    addAuthHeader: boolean = false
): Response {
    if (addAuthHeader) {
        res.setHeader(
            "WWW-Authenticate",
            `Basic realm="oauth" ${Object.entries(oauthError)
                .map((e) => e.join('="'))
                .join('" ')}"`
        );
    }

    return res.status(status).json(oauthError);
}

export class JsonHttpError extends Error {
    constructor(
        public code: HttpCode,
        public jsonError: JsonErrorType
    ) {
        super(jsonError.error_description || "OAuth Validation Error");
        this.name = "OAuthValidationError";
    }
}
