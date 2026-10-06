import { db, sites } from "@server/db";
import { MessageHandler } from "@server/routers/ws";
import { clients, Olm } from "@server/db";
import { eq, inArray } from "drizzle-orm";
import { updatePeersBatch } from "../newt/peers";
import logger from "@server/logger";
import { parseSiteChainBatch, resolveNewtIdsBySite } from "./batchUtils";

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

    const { siteIds, chainIds, isBatch } = parseSiteChainBatch(message.data);

    if (siteIds.length === 0) {
        logger.warn("Local message has no siteId(s)");
        return;
    }

    // Get the sites
    const siteRows = await db
        .select()
        .from(sites)
        .where(inArray(sites.siteId, siteIds));
    const sitesById = new Map(siteRows.map((s) => [s.siteId, s]));

    const valid: { siteId: number; chainId?: string }[] = [];

    for (let i = 0; i < siteIds.length; i++) {
        const siteId = siteIds[i];

        const site = sitesById.get(siteId);
        if (!site || !site.exitNodeId) {
            logger.warn(`Site ${siteId} not found or has no exit node`);
            continue;
        }

        valid.push({ siteId, chainId: chainIds[i] });
    }

    if (valid.length === 0) {
        return;
    }

    // Only ack sites we can actually tell their newt to accept local
    const newtIdBySiteId = await resolveNewtIdsBySite(valid.map((v) => v.siteId));
    const pushable = valid.filter((v) => {
        if (!newtIdBySiteId.has(v.siteId)) {
            logger.warn(`Newt not found for site ${v.siteId}`);
            return false;
        }
        return true;
    });

    if (pushable.length === 0) {
        return;
    }

    // update the peer on each newt to accept local
    await updatePeersBatch(
        pushable.map((v) => ({
            siteId: v.siteId,
            publicKey: client.pubKey!,
            newtId: newtIdBySiteId.get(v.siteId)!,
            peer: { endpoint: "" } // this removes the endpoint so the newt knows to accept local
        }))
    );

    // Just ack the message, we don't keep sending it
    if (isBatch) {
        return {
            message: {
                type: "olm/wg/peer/local",
                data: {
                    siteIds: pushable.map((v) => v.siteId),
                    chainIds: pushable.map((v) => v.chainId)
                }
            },
            broadcast: false,
            excludeSender: false
        };
    }

    const single = pushable[0];
    return {
        message: {
            type: "olm/wg/peer/local",
            data: { siteId: single.siteId, chainId: single.chainId }
        },
        broadcast: false,
        excludeSender: false
    };
};
