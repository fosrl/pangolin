import { sendToClient } from "#dynamic/routers/ws";
import { db, olms, Transaction } from "@server/db";
import { Alias, SubnetProxyTarget } from "@server/lib/ip";
import logger from "@server/logger";
import { eq } from "drizzle-orm";

const BATCH_SIZE = 50;
const BATCH_DELAY_MS = 50;

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function chunkArray<T>(array: T[], size: number): T[][] {
    const chunks: T[][] = [];
    for (let i = 0; i < array.length; i += size) {
        chunks.push(array.slice(i, i + size));
    }
    return chunks;
}

export async function addTargets(newtId: string, targets: SubnetProxyTarget[]) {
    const batches = chunkArray(targets, BATCH_SIZE);
    for (let i = 0; i < batches.length; i++) {
        if (i > 0) {
            await sleep(BATCH_DELAY_MS);
        }
        await sendToClient(newtId, {
            type: `newt/wg/targets/add`,
            data: batches[i]
        });
    }
}

export async function removeTargets(
    newtId: string,
    targets: SubnetProxyTarget[]
) {
    const batches = chunkArray(targets, BATCH_SIZE);
    for (let i = 0; i < batches.length; i++) {
        if (i > 0) {
            await sleep(BATCH_DELAY_MS);
        }
        await sendToClient(newtId, {
            type: `newt/wg/targets/remove`,
            data: batches[i]
        });
    }
}

export async function updateTargets(
    newtId: string,
    targets: {
        oldTargets: SubnetProxyTarget[];
        newTargets: SubnetProxyTarget[];
    }
) {
    const oldBatches = chunkArray(targets.oldTargets, BATCH_SIZE);
    const newBatches = chunkArray(targets.newTargets, BATCH_SIZE);
    const maxBatches = Math.max(oldBatches.length, newBatches.length);

    for (let i = 0; i < maxBatches; i++) {
        if (i > 0) {
            await sleep(BATCH_DELAY_MS);
        }
        await sendToClient(newtId, {
            type: `newt/wg/targets/update`,
            data: {
                oldTargets: oldBatches[i] || [],
                newTargets: newBatches[i] || []
            }
        }).catch((error) => {
            logger.warn(`Error sending message:`, error);
        });
    }
}

export async function addPeerData(
    clientId: number,
    siteId: number,
    remoteSubnets: string[],
    aliases: Alias[],
    olmId?: string
) {
    if (!olmId) {
        const [olm] = await db
            .select()
            .from(olms)
            .where(eq(olms.clientId, clientId))
            .limit(1);
        if (!olm) {
            return; // ignore this because an olm might not be associated with the client anymore
        }
        olmId = olm.olmId;
    }

    await sendToClient(olmId, {
        type: `olm/wg/peer/data/add`,
        data: {
            siteId: siteId,
            remoteSubnets: remoteSubnets,
            aliases: aliases
        }
    }).catch((error) => {
        logger.warn(`Error sending message:`, error);
    });
}

export async function removePeerData(
    clientId: number,
    siteId: number,
    remoteSubnets: string[],
    aliases: Alias[],
    olmId?: string
) {
    if (!olmId) {
        const [olm] = await db
            .select()
            .from(olms)
            .where(eq(olms.clientId, clientId))
            .limit(1);
        if (!olm) {
            return;
        }
        olmId = olm.olmId;
    }

    await sendToClient(olmId, {
        type: `olm/wg/peer/data/remove`,
        data: {
            siteId: siteId,
            remoteSubnets: remoteSubnets,
            aliases: aliases
        }
    }).catch((error) => {
        logger.warn(`Error sending message:`, error);
    });
}

export async function updatePeerData(
    clientId: number,
    siteId: number,
    remoteSubnets:
        | {
              oldRemoteSubnets: string[];
              newRemoteSubnets: string[];
          }
        | undefined,
    aliases:
        | {
              oldAliases: Alias[];
              newAliases: Alias[];
          }
        | undefined,
    olmId?: string
) {
    if (!olmId) {
        const [olm] = await db
            .select()
            .from(olms)
            .where(eq(olms.clientId, clientId))
            .limit(1);
        if (!olm) {
            return;
        }
        olmId = olm.olmId;
    }

    await sendToClient(olmId, {
        type: `olm/wg/peer/data/update`,
        data: {
            siteId: siteId,
            ...remoteSubnets,
            ...aliases
        }
    }).catch((error) => {
        logger.warn(`Error sending message:`, error);
    });
}
