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
import { db, Newt, newts, sites } from "@server/db";
import { eq } from "drizzle-orm";
import response from "@server/lib/response";
import HttpCode from "@server/types/HttpCode";
import createHttpError from "http-errors";
import logger from "@server/logger";
import { fromError } from "zod-validation-error";
import { OpenAPITags, registry } from "@server/openApi";
import { hashPassword } from "@server/auth/password";
import { addPeer, deletePeer } from "@server/routers/gerbil/peers";
import { getAllowedIps } from "@server/routers/target/helpers";
import { disconnectClient, sendToClient } from "#private/routers/ws";

const updateSiteParamsSchema = z.strictObject({
    siteId: z.coerce.number().int().positive()
});

const updateSiteBodySchema = z.strictObject({
    type: z.enum(["newt", "wireguard"]),
    secret: z.string().min(1).max(255).optional(),
    pubKey: z.string().optional(),
    disconnect: z.boolean().optional().default(true)
});

export async function reGenerateSiteSecret(
    req: Request,
    res: Response,
    next: NextFunction
): Promise<any> {
    try {
        const parsedParams = updateSiteParamsSchema.safeParse(req.params);
        if (!parsedParams.success) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    fromError(parsedParams.error).toString()
                )
            );
        }

        const parsedBody = updateSiteBodySchema.safeParse(req.body);
        if (!parsedBody.success) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    fromError(parsedBody.error).toString()
                )
            );
        }

        const { siteId } = parsedParams.data;
        const { type, pubKey, secret, disconnect } = parsedBody.data;

        let existingNewt: Newt | null = null;
        if (type === "newt") {
            if (!secret) {
                return next(
                    createHttpError(
                        HttpCode.BAD_REQUEST,
                        "newtSecret is required for newt sites"
                    )
                );
            }

            const secretHash = await hashPassword(secret);

            // get the newt to verify it exists
            const existingNewts = await db
                .select()
                .from(newts)
                .where(eq(newts.siteId, siteId));

            if (existingNewts.length === 0) {
                return next(
                    createHttpError(
                        HttpCode.NOT_FOUND,
                        `No Newt found for site ID ${siteId}`
                    )
                );
            }

            if (existingNewts.length > 1) {
                return next(
                    createHttpError(
                        HttpCode.INTERNAL_SERVER_ERROR,
                        `Multiple Newts found for site ID ${siteId}`
                    )
                );
            }

            existingNewt = existingNewts[0];

            // update the secret on the existing newt
            await db
                .update(newts)
                .set({
                    secretHash
                })
                .where(eq(newts.newtId, existingNewts[0].newtId));

            // Only disconnect if explicitly requested
            if (disconnect) {
                const payload = {
                    type: `newt/wg/terminate`,
                    data: {}
                };
                // Don't await this to prevent blocking the response
                sendToClient(existingNewts[0].newtId, payload).catch(
                    (error) => {
                        logger.error(
                            "Failed to send termination message to newt:",
                            error
                        );
                    }
                );

                disconnectClient(existingNewts[0].newtId).catch((error) => {
                    logger.error(
                        "Failed to disconnect newt after re-key:",
                        error
                    );
                });
            }

            logger.info(`Regenerated Newt credentials for site ${siteId}`);
        } else if (type === "wireguard") {
            if (!pubKey) {
                return next(
                    createHttpError(
                        HttpCode.BAD_REQUEST,
                        "Public key is required for wireguard sites"
                    )
                );
            }

            try {
                const [site] = await db
                    .select()
                    .from(sites)
                    .where(eq(sites.siteId, siteId))
                    .limit(1);

                if (!site) {
                    return next(
                        createHttpError(
                            HttpCode.NOT_FOUND,
                            `Site with ID ${siteId} not found`
                        )
                    );
                }

                await db
                    .update(sites)
                    .set({ pubKey })
                    .where(eq(sites.siteId, siteId));

                if (!site) {
                    return next(
                        createHttpError(
                            HttpCode.NOT_FOUND,
                            `Site with ID ${siteId} not found`
                        )
                    );
                }

                if (site.exitNodeId && site.subnet) {
                    await deletePeer(site.exitNodeId, site.pubKey!); // the old pubkey
                    await addPeer(site.exitNodeId, {
                        publicKey: pubKey,
                        allowedIps: await getAllowedIps(site.siteId)
                    });
                }

                logger.info(
                    `Regenerated WireGuard credentials for site ${siteId}`
                );
            } catch (err) {
                logger.error(
                    `Transaction failed while regenerating WireGuard secret for site ${siteId}`,
                    err
                );
                return next(
                    createHttpError(
                        HttpCode.INTERNAL_SERVER_ERROR,
                        "Failed to regenerate WireGuard credentials. Rolled back transaction."
                    )
                );
            }
        }

        return response(res, {
            data: {
                newtId: existingNewt ? existingNewt.newtId : undefined
            },
            success: true,
            error: false,
            message: "Credentials regenerated successfully",
            status: HttpCode.OK
        });
    } catch (error) {
        logger.error("Unexpected error in reGenerateSiteSecret", error);
        return next(
            createHttpError(
                HttpCode.INTERNAL_SERVER_ERROR,
                "An unexpected error occurred"
            )
        );
    }
}
