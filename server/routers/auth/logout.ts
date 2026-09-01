import { Request, Response, NextFunction } from "express";
import createHttpError from "http-errors";
import HttpCode from "@server/types/HttpCode";
import response from "@server/lib/response";
import logger from "@server/logger";
import {
    createBlankSessionTokenCookie,
    invalidateSession
} from "@server/auth/sessions/app";
import { verifySession } from "@server/auth/sessions/verifySession";
import config from "@server/lib/config";

export async function logout(
    req: Request,
    res: Response,
    next: NextFunction
): Promise<any> {
    const { user, session } = await verifySession(req);
    const isSecure = req.protocol === "https";

    // Always clear the session cookie so logout is idempotent, even when
    // the session is already missing or invalid
    res.setHeader("Set-Cookie", createBlankSessionTokenCookie(isSecure));

    if (!user || !session) {
        if (config.getRawConfig().app.log_failed_attempts) {
            logger.info(
                `Log out with missing or invalid session. IP: ${req.ip}.`
            );
        }

        return response<null>(res, {
            data: null,
            success: true,
            error: false,
            message: "Logged out successfully",
            status: HttpCode.OK
        });
    }

    try {
        try {
            await invalidateSession(session.sessionId);
        } catch (error) {
            logger.error("Failed to invalidate session", error);
        }

        return response<null>(res, {
            data: null,
            success: true,
            error: false,
            message: "Logged out successfully",
            status: HttpCode.OK
        });
    } catch (error) {
        logger.error(error);
        return next(
            createHttpError(HttpCode.INTERNAL_SERVER_ERROR, "Failed to log out")
        );
    }
}
