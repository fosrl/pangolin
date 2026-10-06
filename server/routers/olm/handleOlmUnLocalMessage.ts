import { db, sites } from "@server/db";
import { MessageHandler } from "@server/routers/ws";
import { clients, clientSitesAssociationsCache, Olm } from "@server/db";
import { and, eq, inArray } from "drizzle-orm";
import { updatePeersBatch } from "../newt/peers";
import logger from "@server/logger";
import { parseSiteChainBatch, resolveNewtIdsBySite } from "./batchUtils";

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

    const { siteIds, chainIds, isBatch } = parseSiteChainBatch(message.data);

    if (siteIds.length === 0) {
        logger.warn("Unlocal message has no siteId(s)");
        return;
    }

    // Get the sites
    const siteRows = await db
        .select()
        .from(sites)
        .where(inArray(sites.siteId, siteIds));
    const sitesById = new Map(siteRows.map((s) => [s.siteId, s]));

    const assocRows = await db
        .select()
        .from(clientSitesAssociationsCache)
        .where(
            and(
                eq(clientSitesAssociationsCache.clientId, olm.clientId),
                inArray(clientSitesAssociationsCache.siteId, siteIds)
            )
        );
    const assocBySiteId = new Map(assocRows.map((a) => [a.siteId, a]));

    const valid: { siteId: number; chainId?: string; endpoint: string }[] = [];

    for (let i = 0; i < siteIds.length; i++) {
        const siteId = siteIds[i];

        const site = sitesById.get(siteId);
        if (!site) {
            logger.warn(`Site ${siteId} not found or has no exit node`);
            continue;
        }

        const clientSiteAssociation = assocBySiteId.get(siteId);
        if (!clientSiteAssociation) {
            logger.warn(`Client-Site association not found for site ${siteId}`);
            continue;
        }

        if (!clientSiteAssociation.endpoint) {
            logger.warn(
                `Client-Site association has no endpoint, cannot unrelay site ${siteId}`
            );
            continue;
        }

        valid.push({
            siteId,
            chainId: chainIds[i],
            endpoint: clientSiteAssociation.isRelayed
                ? ""
                : clientSiteAssociation.endpoint // this is the endpoint of the client to connect directly to the newt
        });
    }

    if (valid.length === 0) {
        return;
    }

    // Only ack sites we can actually push to their newt
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

    // update the peer on each newt
    await updatePeersBatch(
        pushable.map((v) => ({
            siteId: v.siteId,
            publicKey: client.pubKey!,
            newtId: newtIdBySiteId.get(v.siteId)!,
            peer: { endpoint: v.endpoint }
        }))
    );

    if (isBatch) {
        return {
            message: {
                type: "olm/wg/peer/unlocal",
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
            type: "olm/wg/peer/unlocal",
            data: { siteId: single.siteId, chainId: single.chainId }
        },
        broadcast: false,
        excludeSender: false
    };
};
