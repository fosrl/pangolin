import * as reqParam from "@server/lib/requestParams";
import logger from "@server/logger";
import HttpCode from "@server/types/HttpCode";
import { NextFunction, Request, Response } from "express";
import { sendJsonHttpError } from "./verifyOAuthClient";
import { getToken } from "@server/lib/oauth/tokens";

export async function verifyOAuthBearerTokenAccess(
    req: Request,
    res: Response,
    next: NextFunction
): Promise<Response | void> {
    const bearer = reqParam.extractBearerToken(req);
    const form = reqParam.getBodyValue(req, "access_token");
    const param = reqParam.getFirstString(req.params?.access_token);

    if ((bearer && form) || (bearer && param) || (form && param)) {
        logger.warn("The client provided multiple authentication methods.");
        return sendJsonHttpError(res, HttpCode.BAD_REQUEST, {
            error: "invalid_request",
            error_description: "Multiple authentication methods provided"
        });
    }

    const accessToken = bearer ?? form ?? param;
    if (!accessToken) {
        return sendOAuthInvalidTokenError(res);
    }

    const token = await getToken(accessToken);
    if (!token || !token.clientEnabled || token.expiresAt <= Date.now()) {
        return sendOAuthInvalidTokenError(res);
    }

    req.oauthBearerToken = token;
    return next();
}

export function sendOAuthInvalidTokenError(res: Response): Response {
    return res
        .status(HttpCode.UNAUTHORIZED)
        .setHeader("WWW-Authenticate", 'Bearer realm="userinfo"')
        .send();
}
