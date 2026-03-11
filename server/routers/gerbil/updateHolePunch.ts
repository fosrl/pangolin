import { Request, Response, NextFunction } from "express";
import { z } from "zod";
import {
    clients,
    newts,
    olms,
    Site,
    sites,
    clientSitesAssociationsCache,
    exitNodes,
    ExitNode
} from "@server/db";
import { db } from "@server/db";
import { eq, and } from "drizzle-orm";
import HttpCode from "@server/types/HttpCode";
import createHttpError from "http-errors";
import logger from "@server/logger";
import { fromError } from "zod-validation-error";
import { validateNewtSessionToken } from "@server/auth/sessions/newt";
import { validateOlmSessionToken } from "@server/auth/sessions/olm";
import { checkExitNodeOrg } from "#dynamic/lib/exitNodes";
import { updatePeer as updateOlmPeer } from "../olm/peers";
import { updatePeer as updateNewtPeer } from "../newt/peers";
import { formatEndpoint } from "@server/lib/ip";

// Define Zod schema for request validation
const updateHolePunchSchema = z.object({
    olmId: z.string().optional(),
    newtId: z.string().optional(),
    token: z.string(),
    ip: z.string(),
    port: z.number(),
    timestamp: z.number(),
    publicKey: z.string(),
    reachableAt: z.string().optional(),
    exitNodePublicKey: z.string().optional()
});

// New response type with multi-peer destination support
interface PeerDestination {
    destinationIP: string;
    destinationPort: number;
}

export async function updateHolePunch(
    req: Request,
    res: Response,
    next: NextFunction
): Promise<any> {
    try {
        // Validate request parameters
        const parsedParams = updateHolePunchSchema.safeParse(req.body);
        if (!parsedParams.success) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    fromError(parsedParams.error).toString()
                )
            );
        }

        const {
            olmId,
            newtId,
            ip,
            port,
            timestamp,
            token,
            reachableAt,
            publicKey, // this is the client's current public key for this session
            exitNodePublicKey
        } = parsedParams.data;

        let exitNode: ExitNode | undefined;
        if (exitNodePublicKey) {
            // Get the exit node by public key
            [exitNode] = await db
                .select()
                .from(exitNodes)
                .where(eq(exitNodes.publicKey, exitNodePublicKey));
        } else {
            // FOR BACKWARDS COMPATIBILITY IF GERBIL IS STILL =<1.1.0
            [exitNode] = await db.select().from(exitNodes).limit(1);
        }

        if (!exitNode) {
            logger.warn(
                `Exit node not found for publicKey: ${exitNodePublicKey}`
            );
            return next(
                createHttpError(HttpCode.NOT_FOUND, "Exit node not found")
            );
        }

        const destinations = await updateAndGenerateEndpointDestinations(
            olmId,
            newtId,
            ip,
            port,
            timestamp,
            token,
            publicKey,
            exitNode
        );

        // logger.debug(
        //     `Returning ${destinations.length} peer destinations for olmId: ${olmId} or newtId: ${newtId}: ${JSON.stringify(destinations, null, 2)}`
        // );

        // Return the new multi-peer structure
        return res.status(HttpCode.OK).send({
            destinations: destinations
        });
    } catch (error) {
        logger.error(error);
        return next(
            createHttpError(
                HttpCode.INTERNAL_SERVER_ERROR,
                "An error occurred..."
            )
        );
    }
}

export async function updateAndGenerateEndpointDestinations(
    olmId: string | undefined,
    newtId: string | undefined,
    ip: string,
    port: number,
    timestamp: number,
    token: string,
    publicKey: string,
    exitNode: ExitNode,
    checkOrg = false
) {
    let currentSiteId: number | undefined;
    const destinations: PeerDestination[] = [];

    if (olmId) {
        // logger.debug(
        //     `Got hole punch with ip: ${ip}, port: ${port} for olmId: ${olmId}`
        // );

        const { session, olm: olmSession } =
            await validateOlmSessionToken(token);
        if (!session || !olmSession) {
            throw new Error("Unauthorized");
        }

        if (olmId !== olmSession.olmId) {
            logger.warn(`Olm ID mismatch: ${olmId} !== ${olmSession.olmId}`);
            throw new Error("Unauthorized");
        }

        const [olm] = await db.select().from(olms).where(eq(olms.olmId, olmId));

        if (!olm || !olm.clientId) {
            logger.warn(`Olm not found: ${olmId}`);
            throw new Error("Olm not found");
        }

        const [updatedClient] = await db
            .update(clients)
            .set({
                lastHolePunch: timestamp
            })
            .where(eq(clients.clientId, olm.clientId))
            .returning();

        if (
            (await checkExitNodeOrg(
                exitNode.exitNodeId,
                updatedClient.orgId
            )) &&
            checkOrg
        ) {
            // not allowed
            logger.warn(
                `Exit node ${exitNode.exitNodeId} is not allowed for org ${updatedClient.orgId}`
            );
            throw new Error("Exit node not allowed");
        }

        // Get sites that are on this specific exit node and connected to this client
        const sitesOnExitNode = await db
            .select({
                siteId: sites.siteId,
                subnet: sites.subnet,
                listenPort: sites.listenPort,
                publicKey: sites.publicKey,
                endpoint: clientSitesAssociationsCache.endpoint
            })
            .from(sites)
            .innerJoin(
                clientSitesAssociationsCache,
                eq(sites.siteId, clientSitesAssociationsCache.siteId)
            )
            .where(
                and(
                    eq(sites.exitNodeId, exitNode.exitNodeId),
                    eq(clientSitesAssociationsCache.clientId, olm.clientId)
                )
            );

        // Update clientSites for each site on this exit node
        for (const site of sitesOnExitNode) {
            // logger.debug(
            //     `Updating site ${site.siteId} on exit node ${exitNode.exitNodeId}`
            // );

            // Format the endpoint properly for both IPv4 and IPv6
            const formattedEndpoint = formatEndpoint(ip, port);

            // if the public key or endpoint has changed, update it otherwise continue
            if (
                site.endpoint === formattedEndpoint &&
                site.publicKey === publicKey
            ) {
                continue;
            }

            const [updatedClientSitesAssociationsCache] = await db
                .update(clientSitesAssociationsCache)
                .set({
                    endpoint: formattedEndpoint,
                    publicKey: publicKey
                })
                .where(
                    and(
                        eq(clientSitesAssociationsCache.clientId, olm.clientId),
                        eq(clientSitesAssociationsCache.siteId, site.siteId)
                    )
                )
                .returning();

            if (
                updatedClientSitesAssociationsCache.endpoint !==
                    site.endpoint && // this is the endpoint from the join table not the site
                updatedClient.pubKey === publicKey // only trigger if the client's public key matches the current public key which means it has registered so we dont prematurely send the update
            ) {
                logger.info(
                    `ClientSitesAssociationsCache for client ${olm.clientId} and site ${site.siteId} endpoint changed from ${site.endpoint} to ${updatedClientSitesAssociationsCache.endpoint}`
                );
                // Handle any additional logic for endpoint change
                handleClientEndpointChange(
                    olm.clientId,
                    updatedClientSitesAssociationsCache.endpoint!
                );
            }
        }

        // logger.debug(
        //     `Updated ${sitesOnExitNode.length} sites on exit node ${exitNode.exitNodeId}`
        // );
        if (!updatedClient) {
            logger.warn(`Client not found for olm: ${olmId}`);
            throw new Error("Client not found");
        }

        // Create a list of the destinations from the sites
        for (const site of sitesOnExitNode) {
            if (site.subnet && site.listenPort) {
                destinations.push({
                    destinationIP: site.subnet.split("/")[0],
                    destinationPort: site.listenPort || 1 // this satisfies gerbil for now but should be reevaluated
                });
            }
        }
    } else if (newtId) {
        // logger.debug(
        //     `Got hole punch with ip: ${ip}, port: ${port} for newtId: ${newtId}`
        // );

        const { session, newt: newtSession } =
            await validateNewtSessionToken(token);

        if (!session || !newtSession) {
            throw new Error("Unauthorized");
        }

        if (newtId !== newtSession.newtId) {
            logger.warn(
                `Newt ID mismatch: ${newtId} !== ${newtSession.newtId}`
            );
            throw new Error("Unauthorized");
        }

        const [newt] = await db
            .select()
            .from(newts)
            .where(eq(newts.newtId, newtId));

        if (!newt || !newt.siteId) {
            logger.warn(`Newt not found: ${newtId}`);
            throw new Error("Newt not found");
        }

        const [site] = await db
            .select()
            .from(sites)
            .where(eq(sites.siteId, newt.siteId))
            .limit(1);

        if (
            (await checkExitNodeOrg(exitNode.exitNodeId, site.orgId)) &&
            checkOrg
        ) {
            // not allowed
            logger.warn(
                `Exit node ${exitNode.exitNodeId} is not allowed for org ${site.orgId}`
            );
            throw new Error("Exit node not allowed");
        }

        currentSiteId = newt.siteId;

        // Format the endpoint properly for both IPv4 and IPv6
        const formattedSiteEndpoint = formatEndpoint(ip, port);

        // Update the current site with the new endpoint
        const [updatedSite] = await db
            .update(sites)
            .set({
                endpoint: formattedSiteEndpoint,
                lastHolePunch: timestamp
            })
            .where(eq(sites.siteId, newt.siteId))
            .returning();

        if (
            updatedSite.endpoint != site.endpoint &&
            updatedSite.publicKey == publicKey
        ) {
            // only trigger if the site's public key matches the current public key which means it has registered so we dont prematurely send the update
            logger.info(
                `Site ${newt.siteId} endpoint changed from ${site.endpoint} to ${updatedSite.endpoint}`
            );
            // Handle any additional logic for endpoint change
            handleSiteEndpointChange(newt.siteId, updatedSite.endpoint!);
        }

        // if (!updatedSite || !updatedSite.subnet) {
        //     logger.warn(`Site not found: ${newt.siteId}`);
        //     throw new Error("Site not found");
        // }

        // Find all clients that connect to this site
        // const sitesClientPairs = await db
        //     .select()
        //     .from(clientSites)
        //     .where(eq(clientSites.siteId, newt.siteId));

        // THE NEWT IS NOT SENDING RAW WG TO THE GERBIL SO IDK IF WE REALLY NEED THIS - REMOVING
        // Get client details for each client
        // for (const pair of sitesClientPairs) {
        //     const [client] = await db
        //         .select()
        //         .from(clients)
        //         .where(eq(clients.clientId, pair.clientId));

        //     if (client && client.endpoint) {
        //         const [host, portStr] = client.endpoint.split(':');
        //         if (host && portStr) {
        //             destinations.push({
        //                 destinationIP: host,
        //                 destinationPort: parseInt(portStr, 10)
        //             });
        //         }
        //     }
        // }

        // If this is a newt/site, also add other sites in the same org
        //     if (updatedSite.orgId) {
        //         const orgSites = await db
        //             .select()
        //             .from(sites)
        //             .where(eq(sites.orgId, updatedSite.orgId));

        //         for (const site of orgSites) {
        //             // Don't add the current site to the destinations
        //             if (site.siteId !== currentSiteId && site.subnet && site.endpoint && site.listenPort) {
        //                 const [host, portStr] = site.endpoint.split(':');
        //                 if (host && portStr) {
        //                     destinations.push({
        //                         destinationIP: host,
        //                         destinationPort: site.listenPort
        //                     });
        //                 }
        //             }
        //         }
        //     }
    }
    return destinations;
}

async function handleSiteEndpointChange(siteId: number, newEndpoint: string) {
    // Alert all clients connected to this site that the endpoint has changed (only if NOT relayed)
    try {
        // Get site details
        const [site] = await db
            .select()
            .from(sites)
            .where(eq(sites.siteId, siteId))
            .limit(1);

        if (!site || !site.publicKey) {
            logger.warn(`Site ${siteId} not found or has no public key`);
            return;
        }

        // Get all non-relayed clients connected to this site
        const connectedClients = await db
            .select({
                clientId: clients.clientId,
                olmId: olms.olmId,
                isRelayed: clientSitesAssociationsCache.isRelayed
            })
            .from(clientSitesAssociationsCache)
            .innerJoin(
                clients,
                eq(clientSitesAssociationsCache.clientId, clients.clientId)
            )
            .innerJoin(olms, eq(olms.clientId, clients.clientId))
            .where(
                and(
                    eq(clientSitesAssociationsCache.siteId, siteId),
                    eq(clientSitesAssociationsCache.isRelayed, false)
                )
            );

        // Update each non-relayed client with the new site endpoint
        for (const client of connectedClients) {
            try {
                await updateOlmPeer(
                    client.clientId,
                    {
                        siteId: siteId,
                        publicKey: site.publicKey,
                        endpoint: newEndpoint
                    },
                    client.olmId
                );
                logger.debug(
                    `Updated client ${client.clientId} with new site ${siteId} endpoint: ${newEndpoint}`
                );
            } catch (error) {
                logger.error(
                    `Failed to update client ${client.clientId} with new site endpoint: ${error}`
                );
            }
        }
    } catch (error) {
        logger.error(
            `Error handling site endpoint change for site ${siteId}: ${error}`
        );
    }
}

async function handleClientEndpointChange(
    clientId: number,
    newEndpoint: string
) {
    // Alert all sites connected to this client that the endpoint has changed (only if NOT relayed)
    try {
        // Get client details
        const [client] = await db
            .select()
            .from(clients)
            .where(eq(clients.clientId, clientId))
            .limit(1);

        if (!client || !client.pubKey) {
            logger.warn(`Client ${clientId} not found or has no public key`);
            return;
        }

        // Get all non-relayed sites connected to this client
        const connectedSites = await db
            .select({
                siteId: sites.siteId,
                newtId: newts.newtId,
                isRelayed: clientSitesAssociationsCache.isRelayed,
                subnet: clients.subnet
            })
            .from(clientSitesAssociationsCache)
            .innerJoin(
                sites,
                eq(clientSitesAssociationsCache.siteId, sites.siteId)
            )
            .innerJoin(newts, eq(newts.siteId, sites.siteId))
            .innerJoin(
                clients,
                eq(clientSitesAssociationsCache.clientId, clients.clientId)
            )
            .where(
                and(
                    eq(clientSitesAssociationsCache.clientId, clientId),
                    eq(clientSitesAssociationsCache.isRelayed, false)
                )
            );

        // Update each non-relayed site with the new client endpoint
        for (const siteData of connectedSites) {
            try {
                if (!siteData.subnet) {
                    logger.warn(
                        `Client ${clientId} has no subnet, skipping update for site ${siteData.siteId}`
                    );
                    continue;
                }

                await updateNewtPeer(
                    siteData.siteId,
                    client.pubKey,
                    {
                        endpoint: newEndpoint
                    },
                    siteData.newtId
                );
                logger.debug(
                    `Updated site ${siteData.siteId} with new client ${clientId} endpoint: ${newEndpoint}`
                );
            } catch (error) {
                logger.error(
                    `Failed to update site ${siteData.siteId} with new client endpoint: ${error}`
                );
            }
        }
    } catch (error) {
        logger.error(
            `Error handling client endpoint change for client ${clientId}: ${error}`
        );
    }
}
