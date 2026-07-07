import { db, Site } from "@server/db";
import { newts, sites } from "@server/db";
import { eq } from "drizzle-orm";
import { sendToClient, sendToClientsBatch } from "#dynamic/routers/ws";
import logger from "@server/logger";

export async function addPeer(
    siteId: number,
    peer: {
        publicKey: string;
        allowedIps: string[];
        endpoint: string;
    },
    newtId?: string
) {
    let site: Site | null = null;
    if (!newtId) {
        [site] = await db
            .select()
            .from(sites)
            .where(eq(sites.siteId, siteId))
            .limit(1);
        if (!site) {
            throw new Error(`Site with ID ${siteId} not found`);
        }

        // get the newt on the site
        const [newt] = await db
            .select()
            .from(newts)
            .where(eq(newts.siteId, siteId))
            .limit(1);
        if (!newt) {
            throw new Error(`Site found for site ${siteId}`);
        }
        newtId = newt.newtId;
    }

    await sendToClient(
        newtId,
        {
            type: "newt/wg/peer/add",
            data: peer
        },
        { incrementConfigVersion: true }
    ).catch((error) => {
        logger.warn(`Error sending message:`, error);
    });

    logger.info(`Added peer ${peer.publicKey} to newt ${newtId}`);

    return site;
}

export async function deletePeer(
    siteId: number,
    publicKey: string,
    newtId?: string
) {
    let site: Site | null = null;
    if (!newtId) {
        [site] = await db
            .select()
            .from(sites)
            .where(eq(sites.siteId, siteId))
            .limit(1);
        if (!site) {
            throw new Error(`Site with ID ${siteId} not found`);
        }

        // get the newt on the site
        const [newt] = await db
            .select()
            .from(newts)
            .where(eq(newts.siteId, siteId))
            .limit(1);
        if (!newt) {
            throw new Error(`Newt not found for site ${siteId}`);
        }
        newtId = newt.newtId;
    }

    await sendToClient(
        newtId,
        {
            type: "newt/wg/peer/remove",
            data: {
                publicKey
            }
        },
        { incrementConfigVersion: true }
    ).catch((error) => {
        logger.warn(`Error sending message:`, error);
    });

    logger.info(`Deleted peer ${publicKey} from newt ${newtId}`);

    return site;
}

export async function deletePeersBatch(
    peers: {
        siteId: number;
        publicKey: string;
        newtId: string;
    }[]
) {
    if (peers.length === 0) {
        return;
    }

    await sendToClientsBatch(
        peers.map((peer) => ({
            clientId: peer.newtId,
            message: {
                type: "newt/wg/peer/remove",
                data: {
                    publicKey: peer.publicKey
                }
            },
            options: { incrementConfigVersion: true }
        }))
    ).catch((error) => {
        logger.warn(`Error sending batched newt peer removals:`, error);
    });

    logger.info(`Deleted ${peers.length} peer(s) from newts (batch)`);
}

export async function updatePeer(
    siteId: number,
    publicKey: string,
    peer: {
        allowedIps?: string[];
        endpoint?: string;
    },
    newtId?: string
) {
    let site: Site | null = null;
    if (!newtId) {
        [site] = await db
            .select()
            .from(sites)
            .where(eq(sites.siteId, siteId))
            .limit(1);
        if (!site) {
            throw new Error(`Site with ID ${siteId} not found`);
        }

        // get the newt on the site
        const [newt] = await db
            .select()
            .from(newts)
            .where(eq(newts.siteId, siteId))
            .limit(1);
        if (!newt) {
            throw new Error(`Newt not found for site ${siteId}`);
        }
        newtId = newt.newtId;
    }

    await sendToClient(
        newtId,
        {
            type: "newt/wg/peer/update",
            data: {
                publicKey,
                ...peer
            }
        },
        { incrementConfigVersion: true }
    ).catch((error) => {
        logger.warn(`Error sending message:`, error);
    });

    logger.info(`Updated peer ${publicKey} on newt ${newtId}`);

    return site;
}
