import { db, exitNodes, sites } from "@server/db";
import { MessageHandler } from "@server/routers/ws";
import { clients, clientSitesAssociationsCache, Olm } from "@server/db";
import { and, eq } from "drizzle-orm";
import { updatePeer as newtUpdatePeer } from "../newt/peers";
import logger from "@server/logger";
import config from "@server/lib/config";

export const handleOlmRelayMessage: MessageHandler = async (context) => {
    const { message, client: c, sendToClient } = context;
    const olm = c as Olm;

    logger.info("Handling relay olm message!");

    if (!olm) {
        logger.warn("Olm not found");
        return;
    }

    if (!olm.clientId) {
        logger.warn("Olm has no site!"); // TODO: Maybe we create the site here?
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

    // make sure we hand endpoints for both the site and the client and the lastHolePunch is not too old
    if (!client.pubKey) {
        logger.warn("Client has no endpoint or listen port");
        return;
    }

    const { siteId } = message.data;

    // Get the site
    const [site] = await db
        .select()
        .from(sites)
        .where(eq(sites.siteId, siteId))
        .limit(1);

    if (!site || !site.exitNodeId) {
        logger.warn("Site not found or has no exit node");
        return;
    }

    // get the site's exit node
    const [exitNode] = await db
        .select()
        .from(exitNodes)
        .where(eq(exitNodes.exitNodeId, site.exitNodeId))
        .limit(1);

    if (!exitNode) {
        logger.warn("Exit node not found for site");
        return;
    }

    await db
        .update(clientSitesAssociationsCache)
        .set({
            isRelayed: true
        })
        .where(
            and(
                eq(clientSitesAssociationsCache.clientId, olm.clientId),
                eq(clientSitesAssociationsCache.siteId, siteId)
            )
        );

    // update the peer on the exit node
    await newtUpdatePeer(siteId, client.pubKey, {
        endpoint: "" // this removes the endpoint so the exit node knows to relay
    });

    return {
        message: {
            type: "olm/wg/peer/relay",
            data: {
                siteId: siteId,
                relayEndpoint: exitNode.endpoint,
                relayPort: config.getRawConfig().gerbil.clients_start_port
            }
        },
        broadcast: false,
        excludeSender: false
    };
};
