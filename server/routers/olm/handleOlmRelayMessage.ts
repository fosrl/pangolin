import { db, exitNodes, sites } from "@server/db";
import { MessageHandler } from "@server/routers/ws";
import { clients, clientSitesAssociationsCache, Olm } from "@server/db";
import { and, eq, inArray } from "drizzle-orm";
import { updatePeersBatch } from "../newt/peers";
import logger from "@server/logger";
import config from "@server/lib/config";
import { parseSiteChainBatch, resolveNewtIdsBySite } from "./batchUtils";

export const handleOlmRelayMessage: MessageHandler = async (context) => {
    const { message, client: c, sendToClient } = context;
    const olm = c as Olm;

    logger.info("Handling relay olm message!");

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
        logger.warn("Relay message has no siteId(s)");
        return;
    }

    // Get the sites
    const siteRows = await db
        .select()
        .from(sites)
        .where(inArray(sites.siteId, siteIds));
    const sitesById = new Map(siteRows.map((s) => [s.siteId, s]));

    const exitNodeIds = [
        ...new Set(
            siteRows
                .map((s) => s.exitNodeId)
                .filter((id): id is number => id != null)
        )
    ];

    // Get the sites' exit nodes
    const exitNodeRows = exitNodeIds.length
        ? await db
              .select()
              .from(exitNodes)
              .where(inArray(exitNodes.exitNodeId, exitNodeIds))
        : [];
    const exitNodesById = new Map(exitNodeRows.map((e) => [e.exitNodeId, e]));

    const valid: {
        siteId: number;
        chainId?: string;
        relayEndpoint: string;
    }[] = [];

    for (let i = 0; i < siteIds.length; i++) {
        const siteId = siteIds[i];

        const site = sitesById.get(siteId);
        if (!site || !site.exitNodeId) {
            logger.warn(`Site ${siteId} not found or has no exit node`);
            continue;
        }

        const exitNode = exitNodesById.get(site.exitNodeId);
        if (!exitNode) {
            logger.warn(`Exit node not found for site ${siteId}`);
            continue;
        }

        valid.push({
            siteId,
            chainId: chainIds[i],
            relayEndpoint: exitNode.endpoint
        });
    }

    if (valid.length === 0) {
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
                inArray(
                    clientSitesAssociationsCache.siteId,
                    valid.map((v) => v.siteId)
                )
            )
        );

    // Only ack sites we can actually tell their newt to relay for
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

    // update the peer on each newt so it knows to relay
    await updatePeersBatch(
        pushable.map((v) => ({
            siteId: v.siteId,
            publicKey: client.pubKey!,
            newtId: newtIdBySiteId.get(v.siteId)!,
            peer: { endpoint: "" } // this removes the endpoint so the newt knows to relay
        }))
    );

    const relayPort = config.getRawConfig().gerbil.clients_start_port;

    if (isBatch) {
        return {
            message: {
                type: "olm/wg/peer/relay",
                data: {
                    siteIds: pushable.map((v) => v.siteId),
                    relayEndpoints: pushable.map((v) => v.relayEndpoint),
                    relayPort,
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
            type: "olm/wg/peer/relay",
            data: {
                siteId: single.siteId,
                relayEndpoint: single.relayEndpoint,
                relayPort,
                chainId: single.chainId
            }
        },
        broadcast: false,
        excludeSender: false
    };
};
