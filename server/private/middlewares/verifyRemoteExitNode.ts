/*
 * This file is part of a proprietary work.
 *
 * Copyright (c) 2025-2026 Fossorial, Inc.
 * All rights reserved.
 *
 * This file is licensed under the Fossorial Commercial License.
 * You may not use this file except in compliance with the License.
 * Unauthorized use, copying, modification, or distribution is strictly prohibited.
 *
 * This file is not licensed under the AGPLv3.
 */

import { NextFunction, Response } from "express";
import ErrorResponse from "@server/types/ErrorResponse";
import config from "@server/lib/config";
import { unauthorized } from "@server/auth/unauthorizedResponse";
import logger from "@server/logger";
import { validateRemoteExitNodeSessionToken } from "#private/auth/sessions/remoteExitNode";

export const verifySessionRemoteExitNodeMiddleware = async (
    req: any,
    res: Response<ErrorResponse>,
    next: NextFunction
) => {
    // get the token from the auth header
    const token = req.headers["authorization"]?.split(" ")[1] || "";

    const { session, remoteExitNode } =
        await validateRemoteExitNodeSessionToken(token);

    if (!session || !remoteExitNode) {
        if (config.getRawConfig().app.log_failed_attempts) {
            logger.info(`Remote exit node session not found. IP: ${req.ip}.`);
        }
        return next(unauthorized());
    }

    // Nodes made by quick-start have no exit node until an admin links them
    if (!remoteExitNode.exitNodeId) {
        if (config.getRawConfig().app.log_failed_attempts) {
            logger.info(
                `Remote exit node ${remoteExitNode.remoteExitNodeId} is not linked to an exit node. IP: ${req.ip}.`
            );
        }
        return next(unauthorized());
    }

    // const existingUser = await db
    //     .select()
    //     .from(users)
    //     .where(eq(users.userId, user.userId));

    // if (!existingUser || !existingUser[0]) {
    //     if (config.getRawConfig().app.log_failed_attempts) {
    //         logger.info(`User session not found. IP: ${req.ip}.`);
    //     }
    //     return next(
    //         createHttpError(HttpCode.BAD_REQUEST, "User does not exist")
    //     );
    // }

    req.session = session;
    req.remoteExitNode = remoteExitNode;

    next();
};
