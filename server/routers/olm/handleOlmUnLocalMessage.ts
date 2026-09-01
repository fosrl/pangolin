import { db, exitNodes, sites } from "@server/db";
import { MessageHandler } from "@server/routers/ws";
import { clients, clientSitesAssociationsCache, Olm } from "@server/db";
import { and, eq } from "drizzle-orm";
import { updatePeer as newtUpdatePeer } from "../newt/peers";
import logger from "@server/logger";

export const handleOlmUnLocalMessage: MessageHandler = async (context) => {
    const { message, client: c, sendToClient } = context;
    const olm = c as Olm;

    logger.info("Handling unlocal olm message!");

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

    if (!site) {
        logger.warn("Site not found or has no exit node");
        return;
    }

    const [clientSiteAssociation] = await db
        .select()
        .from(clientSitesAssociationsCache)
        .where(
            and(
                eq(clientSitesAssociationsCache.clientId, olm.clientId),
                eq(clientSitesAssociationsCache.siteId, siteId)
            )
        );

    if (!clientSiteAssociation) {
        logger.warn("Client-Site association not found");
        return;
    }

    if (!clientSiteAssociation.endpoint) {
        logger.warn("Client-Site association has no endpoint, cannot unrelay");
        return;
    }

    // update the peer on the newt
    await newtUpdatePeer(siteId, client.pubKey, {
        endpoint: clientSiteAssociation.isRelayed
            ? ""
            : clientSiteAssociation.endpoint // this is the endpoint of the client to connect directly to the newt
    });

    return {
        message: {
            type: "olm/wg/peer/unlocal",
            data: {
                siteId: siteId,
                chainId
            }
        },
        broadcast: false,
        excludeSender: false
    };
};
