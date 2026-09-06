import {
    clientSiteResourcesAssociationsCache,
    clientSitesAssociationsCache,
    db,
    exitNodes,
    Site,
    siteNetworks,
    siteResources,
    sites
} from "@server/db";
import { MessageHandler } from "@server/routers/ws";
import { clients, Olm } from "@server/db";
import { and, eq, or } from "drizzle-orm";
import logger from "@server/logger";
import { initPeerAddHandshake } from "./peers";

export const handleOlmServerInitAddPeerHandshake: MessageHandler = async (
    context
) => {
    logger.info("Handle Olm Server Init Add Peer Handshake Message");
    const { message, client: c, sendToClient } = context;
    const olm = c as Olm;

    if (!olm) {
        logger.warn("Olm not found");
        return;
    }

    if (!olm.clientId) {
        logger.warn("Olm has no client!"); // TODO: Maybe we create the site here?
        return;
    }

    const clientId = olm.clientId;

    const [client] = await db
        .select()
        .from(clients)
        .where(eq(clients.clientId, clientId))
        .limit(1);

    if (!client) {
        logger.warn("Client not found");
        return;
    }

    const { siteId, resourceId, chainId } = message.data;

    const sendCancel = async () => {
        await sendToClient(
            olm.olmId,
            {
                type: "olm/wg/peer/chain/cancel",
                data: { chainId }
            },
            { incrementConfigVersion: false }
        ).catch((error) => {
            logger.warn(`Error sending message:`, error);
        });
    };

    let sitesToProcess: Site[] = [];

    if (siteId) {
        const [siteRes] = await db
            .select()
            .from(sites)
            .where(eq(sites.siteId, siteId))
            .limit(1);
        if (siteRes) {
            sitesToProcess = [siteRes];
        }
    } else if (resourceId) {
        const resources = await db
            .select()
            .from(siteResources)
            .where(
                and(
                    or(
                        eq(siteResources.niceId, resourceId),
                        eq(siteResources.alias, resourceId)
                    ),
                    eq(siteResources.orgId, client.orgId)
                )
            );

        if (!resources || resources.length === 0) {
            logger.error(
                `handleOlmServerInitAddPeerHandshake: Resource not found`
            );
            await sendCancel();
            return;
        }

        if (resources.length > 1) {
            // error but this should not happen because the nice id cant contain a dot and the alias has to have a dot and both have to be unique within the org so there should never be multiple matches
            logger.error(
                `handleOlmServerInitAddPeerHandshake: Multiple resources found matching the criteria`
            );
            await sendCancel();
            return;
        }

        const resource = resources[0];

        const currentResourceAssociationCaches = await db
            .select()
            .from(clientSiteResourcesAssociationsCache)
            .where(
                and(
                    eq(
                        clientSiteResourcesAssociationsCache.siteResourceId,
                        resource.siteResourceId
                    ),
                    eq(
                        clientSiteResourcesAssociationsCache.clientId,
                        client.clientId
                    )
                )
            );

        if (currentResourceAssociationCaches.length === 0) {
            logger.error(
                `handleOlmServerInitAddPeerHandshake: Client ${client.clientId} does not have access to resource ${resource.siteResourceId}`
            );
            await sendCancel();
            return;
        }

        if (!resource.networkId) {
            logger.error(
                `handleOlmServerInitAddPeerHandshake: Resource ${resource.siteResourceId} has no network`
            );
            await sendCancel();
            return;
        }

        // Get all sites associated with this resource's network via siteNetworks
        const siteRows = await db
            .select({ siteId: siteNetworks.siteId })
            .from(siteNetworks)
            .where(eq(siteNetworks.networkId, resource.networkId));

        if (!siteRows || siteRows.length === 0) {
            logger.error(
                `handleOlmServerInitAddPeerHandshake: No sites found for resource ${resource.siteResourceId}`
            );
            await sendCancel();
            return;
        }

        // Fetch full site objects for all network members
        const foundSites = await Promise.all(
            siteRows.map(async ({ siteId: sid }) => {
                const [s] = await db
                    .select()
                    .from(sites)
                    .where(eq(sites.siteId, sid))
                    .limit(1);
                return s ?? null;
            })
        );

        sitesToProcess = foundSites.filter((s): s is Site => s !== null);
    }

    if (sitesToProcess.length === 0) {
        logger.error(
            `handleOlmServerInitAddPeerHandshake: No sites to process`
        );
        await sendCancel();
        return;
    }

    let handshakeInitiated = false;

    for (const site of sitesToProcess) {
        // Check if the client can access this site using the cache
        const currentSiteAssociationCaches = await db
            .select()
            .from(clientSitesAssociationsCache)
            .where(
                and(
                    eq(clientSitesAssociationsCache.clientId, client.clientId),
                    eq(clientSitesAssociationsCache.siteId, site.siteId)
                )
            );

        if (currentSiteAssociationCaches.length === 0) {
            logger.warn(
                `handleOlmServerInitAddPeerHandshake: Client ${client.clientId} does not have access to site ${site.siteId}, skipping`
            );
            continue;
        }

        if (!site.exitNodeId) {
            logger.error(
                `handleOlmServerInitAddPeerHandshake: Site ${site.siteId} has no exit node, skipping`
            );
            continue;
        }

        const [exitNode] = await db
            .select()
            .from(exitNodes)
            .where(eq(exitNodes.exitNodeId, site.exitNodeId));

        if (!exitNode) {
            logger.error(
                `handleOlmServerInitAddPeerHandshake: Exit node not found for site ${site.siteId}, skipping`
            );
            continue;
        }

        // Trigger the peer add handshake - if the peer was already added this will be a no-op
        await initPeerAddHandshake(
            client.clientId,
            {
                siteId: site.siteId,
                exitNode: {
                    publicKey: exitNode.publicKey,
                    endpoint: exitNode.endpoint
                }
            },
            olm.olmId,
            chainId
        );

        handshakeInitiated = true;
    }

    if (!handshakeInitiated) {
        logger.error(
            `handleOlmServerInitAddPeerHandshake: No accessible sites with valid exit nodes found, cancelling chain`
        );
        await sendCancel();
    }

    return;
};
