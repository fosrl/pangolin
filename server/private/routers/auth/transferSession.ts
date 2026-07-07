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

import HttpCode from "@server/types/HttpCode";
import { NextFunction, Request, Response } from "express";
import createHttpError from "http-errors";
import { z } from "zod";
import { fromError } from "zod-validation-error";
import logger from "@server/logger";
import { db, safeRead, sessions, sessionTransferToken } from "@server/db";
import { eq } from "drizzle-orm";
import { response } from "@server/lib/response";
import { encodeHexLowerCase } from "@oslojs/encoding";
import { sha256 } from "@oslojs/crypto/sha2";
import { serializeSessionCookie } from "@server/auth/sessions/app";
import { decrypt } from "@server/lib/crypto";
import config from "@server/lib/config";
import { TransferSessionResponse } from "@server/routers/auth/types";

const bodySchema = z.object({
    token: z.string()
});

export type TransferSessionBodySchema = z.infer<typeof bodySchema>;

export async function transferSession(
    req: Request,
    res: Response,
    next: NextFunction
): Promise<any> {
    const parsedBody = bodySchema.safeParse(req.body);

    if (!parsedBody.success) {
        return next(
            createHttpError(
                HttpCode.BAD_REQUEST,
                fromError(parsedBody.error).toString()
            )
        );
    }

    try {
        const { token } = parsedBody.data;

        const tokenRaw = encodeHexLowerCase(
            sha256(new TextEncoder().encode(token))
        );

        const result = await safeRead((db) =>
            db
                .select()
                .from(sessionTransferToken)
                .where(eq(sessionTransferToken.token, tokenRaw))
                .innerJoin(
                    sessions,
                    eq(sessions.sessionId, sessionTransferToken.sessionId)
                )
                .limit(1)
        );

        const [existing] = result;

        if (!existing) {
            return next(
                createHttpError(HttpCode.BAD_REQUEST, "Invalid transfer token")
            );
        }

        const transferToken = existing.sessionTransferToken;
        const session = existing.session;

        if (!transferToken) {
            return next(
                createHttpError(HttpCode.BAD_REQUEST, "Invalid transfer token")
            );
        }

        await db
            .delete(sessionTransferToken)
            .where(eq(sessionTransferToken.token, tokenRaw));

        if (Date.now() > transferToken.expiresAt) {
            return next(
                createHttpError(HttpCode.BAD_REQUEST, "Transfer token expired")
            );
        }

        const rawSession = decrypt(
            transferToken.encryptedSession,
            config.getRawConfig().server.secret!
        );

        const isSecure = req.protocol === "https";
        const cookie = serializeSessionCookie(
            rawSession,
            isSecure,
            new Date(session.expiresAt)
        );
        res.appendHeader("Set-Cookie", cookie);

        return response<TransferSessionResponse>(res, {
            data: { valid: true, cookie },
            success: true,
            error: false,
            message: "Session exchanged successfully",
            status: HttpCode.OK
        });
    } catch (e) {
        console.error(e);
        return next(
            createHttpError(
                HttpCode.INTERNAL_SERVER_ERROR,
                "Failed to exchange session"
            )
        );
    }
}
