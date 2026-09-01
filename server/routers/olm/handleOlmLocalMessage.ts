import { db, sites } from "@server/db";
import { MessageHandler } from "@server/routers/ws";
import { clients, Olm } from "@server/db";
import { and, eq } from "drizzle-orm";
import { updatePeer as newtUpdatePeer } from "../newt/peers";
import logger from "@server/logger";

export const handleOlmLocalMessage: MessageHandler = async (context) => {
    const { message, client: c, sendToClient } = context;
    const olm = c as Olm;

    logger.info("Handling local olm message!");

    if (!olm) {
        logger.warn("Olm not found");
        return;
    }

    if (!olm.clientId) {
        logger.warn("Olm has no client!");
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

    const { siteId, chainId } = message.data;

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

    // update the peer on the newt
    await newtUpdatePeer(siteId, client.pubKey, {
        endpoint: "" // this removes the endpoint so the newt knows to accept local
    });

    // Just ack the message, we don't keep sending it
    return {
        message: {
            type: "olm/wg/peer/local",
            data: {
                siteId: siteId,
                chainId
            }
        },
        broadcast: false,
        excludeSender: false
    };
};
