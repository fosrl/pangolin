import {
    clientSiteResourcesAssociationsCache,
    db,
    networks,
    siteNetworks,
    siteResources
} from "@server/db";
import { MessageHandler } from "@server/routers/ws";
import { clients, clientSitesAssociationsCache, Olm, sites } from "@server/db";
import { and, eq, inArray, isNotNull, isNull } from "drizzle-orm";
import logger from "@server/logger";
import { generateAliasConfig } from "@server/lib/ip";
import { generateRemoteSubnets } from "@server/lib/ip";
import { addPeer as newtAddPeer } from "@server/routers/newt/peers";

export const handleOlmServerPeerAddMessage: MessageHandler = async (
    context
) => {
    logger.info("Handling register olm message!");
    const { message, client: c, sendToClient } = context;
    const olm = c as Olm;

    const now = Math.floor(Date.now() / 1000);

    if (!olm) {
        logger.warn("Olm not found");
        return;
    }

    const { siteId, chainId } = message.data;

    // get the site
    const [site] = await db
        .select()
        .from(sites)
        .where(eq(sites.siteId, siteId))
        .limit(1);

    if (!site) {
        logger.error(
            `handleOlmServerPeerAddMessage: Site with ID ${siteId} not found`
        );
        return;
    }

    if (!site.endpoint) {
        logger.error(
            `handleOlmServerPeerAddMessage: Site with ID ${siteId} has no endpoint`
        );
        return;
    }

    // get the client

    if (!olm.clientId) {
        logger.error(
            `handleOlmServerPeerAddMessage: Olm with ID ${olm.olmId} has no clientId`
        );
        return;
    }

    const [client] = await db
        .select()
        .from(clients)
        .where(and(eq(clients.clientId, olm.clientId)))
        .limit(1);

    if (!client) {
        logger.error(
            `handleOlmServerPeerAddMessage: Client with ID ${olm.clientId} not found`
        );
        return;
    }

    if (!client.pubKey) {
        logger.error(
            `handleOlmServerPeerAddMessage: Client with ID ${client.clientId} has no public key`
        );
        return;
    }

    let endpoint: string | null = null;

    // TODO: should we pick only the one from the site its talking to instead of any good current session?
    const currentSessionSiteAssociationCaches = await db
        .select()
        .from(clientSitesAssociationsCache)
        .where(
            and(
                eq(clientSitesAssociationsCache.clientId, client.clientId),
                isNotNull(clientSitesAssociationsCache.endpoint),
                eq(clientSitesAssociationsCache.publicKey, client.pubKey) // limit it to the current session its connected with otherwise the endpoint could be stale
            )
        );

    // pick an endpoint
    for (const assoc of currentSessionSiteAssociationCaches) {
        if (assoc.endpoint) {
            endpoint = assoc.endpoint;
            break;
        }
    }

    if (!endpoint) {
        logger.error(
            `handleOlmServerPeerAddMessage: No endpoint found for client ${client.clientId}`
        );
        return;
    }

    // NOTE: here we are always starting direct to the peer and will relay later

    await newtAddPeer(siteId, {
        publicKey: client.pubKey,
        allowedIps: [`${client.subnet.split("/")[0]}/32`], // we want to only allow from that client
        endpoint: endpoint // this is the client's endpoint with reference to the site's exit node
    });

    const allSiteResources = await db // only get the site resources that this client has access to
        .select()
        .from(siteResources)
        .innerJoin(
            clientSiteResourcesAssociationsCache,
            eq(
                siteResources.siteResourceId,
                clientSiteResourcesAssociationsCache.siteResourceId
            )
        )
        .innerJoin(networks, eq(siteResources.networkId, networks.networkId))
        .innerJoin(
            siteNetworks,
            and(
                eq(networks.networkId, siteNetworks.networkId),
                eq(siteNetworks.siteId, site.siteId)
            )
        )
        .where(
            eq(clientSiteResourcesAssociationsCache.clientId, client.clientId)
        );

    // Return connect message with all site configurations
    return {
        message: {
            type: "olm/wg/peer/add",
            data: {
                siteId: site.siteId,
                name: site.name,
                endpoint: site.endpoint,
                localEndpoints: site.localEndpoints
                    ? JSON.parse(site.localEndpoints)
                    : undefined,
                publicKey: site.publicKey,
                serverIP: site.address,
                serverPort: site.listenPort,
                remoteSubnets: generateRemoteSubnets(
                    allSiteResources.map(({ siteResources }) => siteResources)
                ),
                aliases: generateAliasConfig(
                    allSiteResources.map(({ siteResources }) => siteResources)
                ),
                chainId: chainId
            }
        },
        broadcast: false,
        excludeSender: false
    };
};
