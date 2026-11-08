import type { NextFunction, Request, Response } from "express";
import createHttpError from "http-errors";
import HttpCode from "@server/types/HttpCode";
import logger from "@server/logger";
import { getJWKS } from "@server/lib/oauth/keys";

export async function getJwks(
    _: Request,
    res: Response,
    next: NextFunction
): Promise<Response | void> {
    try {
        const keys = await getJWKS();

        res.setHeader("Cache-Control", "public, max-age=3600");
        res.status(HttpCode.OK).json({ keys });
    } catch (error) {
        logger.error(error);
        next(
            createHttpError(
                HttpCode.INTERNAL_SERVER_ERROR,
                "Failed to load signing keys"
            )
        );
    }
}
