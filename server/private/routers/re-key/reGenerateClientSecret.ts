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

import { Request, Response, NextFunction } from "express";
import { z } from "zod";
import { db, Olm, olms } from "@server/db";
import { clients } from "@server/db";
import response from "@server/lib/response";
import HttpCode from "@server/types/HttpCode";
import createHttpError from "http-errors";
import logger from "@server/logger";
import { eq, and } from "drizzle-orm";
import { fromError } from "zod-validation-error";
import { OpenAPITags, registry } from "@server/openApi";
import { hashPassword } from "@server/auth/password";
import { disconnectClient, sendToClient } from "#private/routers/ws";
import { OlmErrorCodes, sendOlmError } from "@server/routers/olm/error";
import { sendTerminateClient } from "@server/routers/client/terminate";

const reGenerateSecretParamsSchema = z.strictObject({
    clientId: z.coerce.number().int().positive()
});

const reGenerateSecretBodySchema = z.strictObject({
    // olmId: z.string().min(1).optional(),
    secret: z.string().min(1),
    disconnect: z.boolean().optional().default(true)
});

export type ReGenerateSecretBody = z.infer<typeof reGenerateSecretBodySchema>;

export async function reGenerateClientSecret(
    req: Request,
    res: Response,
    next: NextFunction
): Promise<any> {
    try {
        const parsedBody = reGenerateSecretBodySchema.safeParse(req.body);
        if (!parsedBody.success) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    fromError(parsedBody.error).toString()
                )
            );
        }

        const { secret, disconnect } = parsedBody.data;

        const parsedParams = reGenerateSecretParamsSchema.safeParse(req.params);
        if (!parsedParams.success) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    fromError(parsedParams.error).toString()
                )
            );
        }

        const { clientId } = parsedParams.data;

        const secretHash = await hashPassword(secret);

        // Fetch the client to make sure it exists and the user has access to it
        const [client] = await db
            .select()
            .from(clients)
            .where(eq(clients.clientId, clientId))
            .limit(1);

        if (!client) {
            return next(
                createHttpError(
                    HttpCode.NOT_FOUND,
                    `Client with ID ${clientId} not found`
                )
            );
        }

        const existingOlms = await db
            .select()
            .from(olms)
            .where(eq(olms.clientId, clientId));

        if (existingOlms.length === 0) {
            return next(
                createHttpError(
                    HttpCode.NOT_FOUND,
                    `No OLM found for client ID ${clientId}`
                )
            );
        }

        if (existingOlms.length > 1) {
            return next(
                createHttpError(
                    HttpCode.INTERNAL_SERVER_ERROR,
                    `Multiple OLM entries found for client ID ${clientId}`
                )
            );
        }

        await db
            .update(olms)
            .set({
                secretHash
            })
            .where(eq(olms.olmId, existingOlms[0].olmId));

        // Only disconnect if explicitly requested
        if (disconnect) {
            // Don't await this to prevent blocking the response
            sendTerminateClient(
                clientId,
                OlmErrorCodes.TERMINATED_REKEYED,
                existingOlms[0].olmId
            ).catch((error) => {
                logger.error(
                    "Failed to send termination message to olm:",
                    error
                );
            });

            disconnectClient(existingOlms[0].olmId).catch((error) => {
                logger.error("Failed to disconnect olm after re-key:", error);
            });
        }

        return response(res, {
            data: {
                olmId: existingOlms[0].olmId
            },
            success: true,
            error: false,
            message: "Credentials regenerated successfully",
            status: HttpCode.OK
        });
    } catch (error) {
        logger.error(error);
        return next(
            createHttpError(HttpCode.INTERNAL_SERVER_ERROR, "An error occurred")
        );
    }
}
