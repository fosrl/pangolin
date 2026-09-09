import type { NextFunction, Request, Response } from "express";
import createHttpError from "http-errors";
import HttpCode from "@server/types/HttpCode";
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
        const inOrg = await userBelongsToClientOrg(
            token.userId,
            token.clientId
        );

        if (!inOrg) {
            return sendOAuthInvalidTokenError(res);
        }

        const claims = await buildUserinfoClaims(
            token.userId,
            token.clientId,
            token.scope
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
