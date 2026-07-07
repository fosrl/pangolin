import {
    generateSessionToken,
    validateSessionToken
} from "@server/auth/sessions/app";
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
import { and, count, eq, inArray } from "drizzle-orm";
import { NextFunction, Request, Response } from "express";
import createHttpError from "http-errors";
import { z } from "zod";
import { fromError } from "zod-validation-error";
import {
    createOlmSession,
    validateOlmSessionToken,
    EXPIRES
} from "@server/auth/sessions/olm";
import { getOrCreateCachedToken } from "#dynamic/lib/tokenCache";
import { listExitNodes } from "#dynamic/lib/exitNodes";
import { verifyPassword } from "@server/auth/password";
import logger from "@server/logger";
import config from "@server/lib/config";
import { APP_VERSION } from "@server/lib/consts";
import { build } from "@server/build";

export const olmGetTokenBodySchema = z.object({
    olmId: z.string(),
    secret: z.string().optional(),
    userToken: z.string().optional(),
    token: z.string().optional(), // this is the olm token
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

    const { olmId, secret, token, orgId, userToken } = parsedBody.data;

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

        if (userToken) {
            const { session: userSession, user } =
                await validateSessionToken(userToken);
            if (!userSession || !user) {
                return next(
                    createHttpError(HttpCode.BAD_REQUEST, "Invalid user token")
                );
            }
            if (user.userId !== existingOlm.userId) {
                return next(
                    createHttpError(
                        HttpCode.BAD_REQUEST,
                        "User token does not match olm"
                    )
                );
            }
        } else if (secret) {
            // this is for backward compatibility, we want to move towards userToken but some old clients may still be using secret so we will support both for now
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
        } else {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    "Either secret or userToken is required"
                )
            );
        }

        logger.debug("Creating new olm session token");

        // Return a cached token if one exists to prevent thundering herd on
        // simultaneous restarts; falls back to creating a fresh session when
        // Redis is unavailable or the cache has expired.
        const resToken = await getOrCreateCachedToken(
            `olm:token_cache:${existingOlm.olmId}`,
            config.getRawConfig().server.secret!,
            Math.floor(EXPIRES / 1000),
            async () => {
                const token = generateSessionToken();
                await createOlmSession(token, existingOlm.olmId);
                return token;
            }
        );

        let clientIdToUse;
        let orgIdToUse: string;
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
            orgIdToUse = orgId;
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
            orgIdToUse = client.orgId;
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

        if (clientSites.length > 250 && build == "saas") {
            // set all of the cache rows isJitMode to true
            await db
                .update(clientSitesAssociationsCache)
                .set({ isJitMode: true })
                .where(
                    and(
                        eq(
                            clientSitesAssociationsCache.clientId,
                            clientIdToUse!
                        ),
                        eq(clientSitesAssociationsCache.isJitMode, false)
                    )
                );
        }

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

        // Map exitNodeId to siteIds
        const exitNodeIdToSiteIds: Record<number, number[]> = {};
        for (const { sites: site } of clientSites) {
            if (site.exitNodeId !== null) {
                if (!exitNodeIdToSiteIds[site.exitNodeId]) {
                    exitNodeIdToSiteIds[site.exitNodeId] = [];
                }
                exitNodeIdToSiteIds[site.exitNodeId].push(site.siteId);
            }
        }

        let exitNodesHpData = allExitNodes.map((exitNode: ExitNode) => {
            return {
                publicKey: exitNode.publicKey,
                relayPort: config.getRawConfig().gerbil.clients_start_port,
                endpoint: exitNode.endpoint,
                siteIds: exitNodeIdToSiteIds[exitNode.exitNodeId] ?? []
            };
        });

        // If no exit nodes were found for the client's sites, fall back to
        // finding an available node in the same region (as newt does on ping).
        if (exitNodesHpData.length === 0) {
            logger.debug(
                `No exit nodes found for olm ${olmId} client sites; falling back to region node selection`
            );
            const fallbackNodes = await listExitNodes(orgIdToUse!, true);

            const weightedNodes = await Promise.all(
                fallbackNodes.map(async (node) => {
                    let weight = 1;
                    const maxConnections = node.maxConnections;
                    if (
                        maxConnections !== null &&
                        maxConnections !== undefined
                    ) {
                        const [currentConnections] = await db
                            .select({ count: count() })
                            .from(sites)
                            .where(
                                and(
                                    eq(sites.exitNodeId, node.exitNodeId),
                                    eq(sites.online, true)
                                )
                            );
                        if (currentConnections.count >= maxConnections) {
                            return null;
                        }
                        weight =
                            (maxConnections - currentConnections.count) /
                            maxConnections;
                    }
                    return { node, weight };
                })
            );

            const availableNodes = weightedNodes
                .filter(
                    (
                        n
                    ): n is {
                        node: (typeof fallbackNodes)[0];
                        weight: number;
                    } => n !== null
                )
                .sort((a, b) => b.weight - a.weight);

            if (availableNodes.length > 0) {
                const best = availableNodes[0].node;
                exitNodesHpData = [
                    {
                        publicKey: best.publicKey,
                        relayPort:
                            config.getRawConfig().gerbil.clients_start_port,
                        endpoint: best.endpoint,
                        siteIds: []
                        // it should still HP without the site ids but it will get stuck in the client
                        // if a site is removed or something because its not tied to a site which is okay for the session
                    }
                ];
            } else {
                logger.warn(
                    `No available fallback exit nodes found for olm ${olmId}`
                );
            }
        }

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
