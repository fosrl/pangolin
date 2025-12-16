import { generateSessionToken } from "@server/auth/sessions/app";
import {
    clients,
    db,
    ExitNode,
    exitNodes,
    sites,
    clientSitesAssociationsCache
} from "@server/db";
import { olms } from "@server/db";
import HttpCode from "@server/types/HttpCode";
import response from "@server/lib/response";
import { and, eq, inArray } from "drizzle-orm";
import { NextFunction, Request, Response } from "express";
import createHttpError from "http-errors";
import { z } from "zod";
import { fromError } from "zod-validation-error";
import {
    createOlmSession,
    validateOlmSessionToken
} from "@server/auth/sessions/olm";
import { verifyPassword } from "@server/auth/password";
import logger from "@server/logger";
import config from "@server/lib/config";
import { APP_VERSION } from "@server/lib/consts";

export const olmGetTokenBodySchema = z.object({
    olmId: z.string(),
    secret: z.string(),
    token: z.string().optional(),
    orgId: z.string().optional()
});

export type OlmGetTokenBody = z.infer<typeof olmGetTokenBodySchema>;

export async function getOlmToken(
    req: Request,
    res: Response,
    next: NextFunction
): Promise<any> {
    const parsedBody = olmGetTokenBodySchema.safeParse(req.body);

    if (!parsedBody.success) {
        return next(
            createHttpError(
                HttpCode.BAD_REQUEST,
                fromError(parsedBody.error).toString()
            )
        );
    }

    const { olmId, secret, token, orgId } = parsedBody.data;

    try {
        if (token) {
            const { session, olm } = await validateOlmSessionToken(token);
            if (session) {
                if (config.getRawConfig().app.log_failed_attempts) {
                    logger.info(
                        `Olm session already valid. Olm ID: ${olmId}. IP: ${req.ip}.`
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

        const [existingOlm] = await db
            .select()
            .from(olms)
            .where(eq(olms.olmId, olmId));

        if (!existingOlm) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    "No olm found with that olmId"
                )
            );
        }

        const validSecret = await verifyPassword(
            secret,
            existingOlm.secretHash
        );

        if (!validSecret) {
            if (config.getRawConfig().app.log_failed_attempts) {
                logger.info(
                    `Olm id or secret is incorrect. Olm: ID ${olmId}. IP: ${req.ip}.`
                );
            }
            return next(
                createHttpError(HttpCode.BAD_REQUEST, "Secret is incorrect")
            );
        }

        logger.debug("Creating new olm session token");

        const resToken = generateSessionToken();
        await createOlmSession(resToken, existingOlm.olmId);

        let clientIdToUse;
        if (orgId) {
            // we did provide the org
            const [client] = await db
                .select()
                .from(clients)
                .where(and(eq(clients.orgId, orgId), eq(clients.olmId, olmId))) // we want to lock on to the client with this olmId otherwise it can get assigned to a random one
                .limit(1);

            if (!client) {
                return next(
                    createHttpError(
                        HttpCode.BAD_REQUEST,
                        "No client found for provided orgId"
                    )
                );
            }

            if (existingOlm.clientId !== client.clientId) {
                // we only need to do this if the client is changing

                logger.debug(
                    `Switching olm client ${existingOlm.olmId} to org ${orgId} for user ${existingOlm.userId}`
                );

                await db
                    .update(olms)
                    .set({
                        clientId: client.clientId
                    })
                    .where(eq(olms.olmId, existingOlm.olmId));
            }

            clientIdToUse = client.clientId;
        } else {
            if (!existingOlm.clientId) {
                return next(
                    createHttpError(
                        HttpCode.BAD_REQUEST,
                        "Olm is not associated with a client, orgId is required"
                    )
                );
            }

            const [client] = await db
                .select()
                .from(clients)
                .where(eq(clients.clientId, existingOlm.clientId))
                .limit(1);

            if (!client) {
                return next(
                    createHttpError(
                        HttpCode.BAD_REQUEST,
                        "Olm's associated client not found, orgId is required"
                    )
                );
            }

            clientIdToUse = client.clientId;
        }

        // Get all exit nodes from sites where the client has peers
        const clientSites = await db
            .select()
            .from(clientSitesAssociationsCache)
            .innerJoin(
                sites,
                eq(sites.siteId, clientSitesAssociationsCache.siteId)
            )
            .where(eq(clientSitesAssociationsCache.clientId, clientIdToUse!));

        // Extract unique exit node IDs
        const exitNodeIds = Array.from(
            new Set(
                clientSites
                    .map(({ sites: site }) => site.exitNodeId)
                    .filter((id): id is number => id !== null)
            )
        );

        let allExitNodes: ExitNode[] = [];
        if (exitNodeIds.length > 0) {
            allExitNodes = await db
                .select()
                .from(exitNodes)
                .where(inArray(exitNodes.exitNodeId, exitNodeIds));
        }

        const exitNodesHpData = allExitNodes.map((exitNode: ExitNode) => {
            return {
                publicKey: exitNode.publicKey,
                relayPort: config.getRawConfig().gerbil.clients_start_port,
                endpoint: exitNode.endpoint
            };
        });

        logger.debug("Token created successfully");

        return response<{
            token: string;
            exitNodes: { publicKey: string; endpoint: string }[];
            serverVersion: string;
        }>(res, {
            data: {
                token: resToken,
                exitNodes: exitNodesHpData,
                serverVersion: APP_VERSION
            },
            success: true,
            error: false,
            message: "Token created successfully",
            status: HttpCode.OK
        });
    } catch (error) {
        logger.error(error);
        return next(
            createHttpError(
                HttpCode.INTERNAL_SERVER_ERROR,
                "Failed to authenticate olm"
            )
        );
    }
}
