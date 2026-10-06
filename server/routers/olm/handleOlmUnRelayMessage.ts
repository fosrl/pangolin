import { db, exitNodes, sites } from "@server/db";
import { MessageHandler } from "@server/routers/ws";
import { clients, clientSitesAssociationsCache, Olm } from "@server/db";
import { and, eq, inArray } from "drizzle-orm";
import { updatePeersBatch } from "../newt/peers";
import logger from "@server/logger";
import { parseSiteChainBatch, resolveNewtIdsBySite } from "./batchUtils";

export const handleOlmUnRelayMessage: MessageHandler = async (context) => {
    const { message, client: c, sendToClient } = context;
    const olm = c as Olm;

    logger.info("Handling unrelay olm message!");

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
        logger.warn("Unrelay message has no siteId(s)");
        return;
    }

    // Get the sites
    const siteRows = await db
        .select()
        .from(sites)
        .where(inArray(sites.siteId, siteIds));
    const sitesById = new Map(siteRows.map((s) => [s.siteId, s]));

    const assocRows = await db
        .update(clientSitesAssociationsCache)
        .set({
            isRelayed: false
        })
        .where(
            and(
                eq(clientSitesAssociationsCache.clientId, olm.clientId),
                inArray(clientSitesAssociationsCache.siteId, siteIds)
            )
        )
        .returning();
    const assocBySiteId = new Map(assocRows.map((a) => [a.siteId, a]));

    const valid: {
        siteId: number;
        chainId?: string;
        endpoint: string;
        clientEndpoint: string;
    }[] = [];

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
            endpoint: site.endpoint ?? "",
            clientEndpoint: clientSiteAssociation.endpoint
        });
    }

    if (valid.length === 0) {
        return;
    }

    // Only ack sites we can actually tell their newt to connect directly
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

    // update the peer on each newt to connect directly to the client
    await updatePeersBatch(
        pushable.map((v) => ({
            siteId: v.siteId,
            publicKey: client.pubKey!,
            newtId: newtIdBySiteId.get(v.siteId)!,
            peer: { endpoint: v.clientEndpoint } // this is the endpoint of the client to connect directly to the newt
        }))
    );

    if (isBatch) {
        return {
            message: {
                type: "olm/wg/peer/unrelay",
                data: {
                    siteIds: pushable.map((v) => v.siteId),
                    endpoints: pushable.map((v) => v.endpoint),
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
            type: "olm/wg/peer/unrelay",
            data: {
                siteId: single.siteId,
                endpoint: single.endpoint,
                chainId: single.chainId
            }
        },
        broadcast: false,
        excludeSender: false
    };
};
