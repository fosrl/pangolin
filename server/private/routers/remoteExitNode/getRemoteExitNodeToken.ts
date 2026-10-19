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

import { generateSessionToken } from "@server/auth/sessions/app";
import { db } from "@server/db";
import { remoteExitNodes } from "@server/db";
import HttpCode from "@server/types/HttpCode";
import response from "@server/lib/response";
import { eq } from "drizzle-orm";
import { NextFunction, Request, Response } from "express";
import createHttpError from "http-errors";
import { z } from "zod";
import { fromError } from "zod-validation-error";
import {
    createRemoteExitNodeSession,
    validateRemoteExitNodeSessionToken,
    EXPIRES
} from "#private/auth/sessions/remoteExitNode";
import { getOrCreateCachedToken } from "#private/lib/tokenCache";
import { verifyPassword } from "@server/auth/password";
import logger from "@server/logger";
import config from "@server/lib/config";

export const remoteExitNodeGetTokenBodySchema = z.object({
    remoteExitNodeId: z.string(),
    secret: z.string(),
    token: z.string().optional()
});

export async function getRemoteExitNodeToken(
    req: Request,
    res: Response,
    next: NextFunction
): Promise<any> {
    const parsedBody = remoteExitNodeGetTokenBodySchema.safeParse(req.body);

    if (!parsedBody.success) {
        return next(
            createHttpError(
                HttpCode.BAD_REQUEST,
                fromError(parsedBody.error).toString()
            )
        );
    }

    const { remoteExitNodeId, secret, token } = parsedBody.data;

    try {
        if (token) {
            const { session, remoteExitNode } =
                await validateRemoteExitNodeSessionToken(token);
            if (session) {
                if (config.getRawConfig().app.log_failed_attempts) {
                    logger.info(
                        `RemoteExitNode session already valid. RemoteExitNode ID: ${remoteExitNodeId}. IP: ${req.ip}.`
                    );
                }
                return response<null>(res, {
                    data: null,
                    success: true,
                    error: false,
                    message: "Token session already valid",
                    status: HttpCode.OK
                });
            }
        }

        const existingRemoteExitNodeRes = await db
            .select()
            .from(remoteExitNodes)
            .where(eq(remoteExitNodes.remoteExitNodeId, remoteExitNodeId));
        if (!existingRemoteExitNodeRes || !existingRemoteExitNodeRes.length) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    "No remoteExitNode found with that remoteExitNodeId"
                )
            );
        }

        const existingRemoteExitNode = existingRemoteExitNodeRes[0];

        const validSecret = await verifyPassword(
            secret,
            existingRemoteExitNode.secretHash
        );
        if (!validSecret) {
            if (config.getRawConfig().app.log_failed_attempts) {
                logger.info(
                    `RemoteExitNode id or secret is incorrect. RemoteExitNode: ID ${remoteExitNodeId}. IP: ${req.ip}.`
                );
            }
            return next(
                createHttpError(HttpCode.BAD_REQUEST, "Secret is incorrect")
            );
        }

        // Return a cached token if one exists to prevent thundering herd on
        // simultaneous restarts; falls back to creating a fresh session when
        // Redis is unavailable or the cache has expired.
        const resToken = await getOrCreateCachedToken(
            `remote_exit_node:token_cache:${existingRemoteExitNode.remoteExitNodeId}`,
            config.getRawConfig().server.secret!,
            Math.floor(EXPIRES / 1000),
            async () => {
                const token = generateSessionToken();
                await createRemoteExitNodeSession(
                    token,
                    existingRemoteExitNode.remoteExitNodeId
                );
                return token;
            }
        );

        return response<{ token: string }>(res, {
            data: {
                token: resToken
            },
            success: true,
            error: false,
            message: "Token created successfully",
            status: HttpCode.OK
        });
    } catch (e) {
        console.error(e);
        return next(
            createHttpError(
                HttpCode.INTERNAL_SERVER_ERROR,
                "Failed to authenticate remoteExitNode"
            )
        );
    }
}
