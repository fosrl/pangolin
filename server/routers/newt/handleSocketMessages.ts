import { MessageHandler } from "@server/routers/ws";
import logger from "@server/logger";
import { Newt } from "@server/db";
import { applyNewtDockerBlueprint } from "@server/lib/blueprints/applyNewtDockerBlueprint";
import cache from "#dynamic/lib/cache";

export const handleDockerStatusMessage: MessageHandler = async (context) => {
    const { message, client, sendToClient } = context;
    const newt = client as Newt;

    logger.info("Handling Docker socket check response");

    if (!newt) {
        logger.warn("Newt not found");
        return;
    }

    logger.info(`Newt ID: ${newt.newtId}, Site ID: ${newt.siteId}`);
    const { available, socketPath } = message.data;

    logger.info(
        `Docker socket availability for Newt ${newt.newtId}: available=${available}, socketPath=${socketPath}`
    );

    if (available) {
        logger.info(`Newt ${newt.newtId} has Docker socket access`);
        await cache.set(`${newt.newtId}:socketPath`, socketPath, 0);
        await cache.set(`${newt.newtId}:isAvailable`, available, 0);
    } else {
        logger.warn(`Newt ${newt.newtId} does not have Docker socket access`);
    }

    return;
};

interface ChunkAccumulator {
    batchId: string;
    totalChunks: number;
    receivedChunks: number;
    containers: any[];
}

/**
 * Cache key for in-progress chunked container data, scoped by newt and batch.
 */
function getChunkCacheKey(newtId: string): string {
    return `${newtId}:dockerContainersChunks`;
}

/**
 * Process a complete container list (either received all at once or after reassembly).
 */
async function processContainerList(
    newtId: string,
    siteId: number | null,
    containers: any[]
) {
    logger.info(
        `Docker containers for Newt ${newtId}: ${containers.length}`
    );

    if (containers.length > 0) {
        await cache.set(`${newtId}:dockerContainers`, containers, 0);
    } else {
        logger.warn(`Newt ${newtId} does not have Docker containers`);
    }

    if (!siteId) {
        logger.warn("Newt has no site!");
        return;
    }

    await applyNewtDockerBlueprint(siteId, newtId, containers);
}

export const handleDockerContainersMessage: MessageHandler = async (
    context
) => {
    const { message, client, sendToClient } = context;
    const newt = client as Newt;

    logger.info("Handling Docker containers response");

    if (!newt) {
        logger.warn("Newt not found");
        return;
    }

    logger.info(`Newt ID: ${newt.newtId}, Site ID: ${newt.siteId}`);
    const { containers, chunkIndex, totalChunks, batchId } = message.data;

    // Non-chunked message (backward compatible with older newt versions)
    if (totalChunks === undefined || totalChunks <= 1) {
        await processContainerList(
            newt.newtId,
            newt.siteId,
            containers || []
        );
        return;
    }

    // Validate chunk metadata
    if (
        typeof chunkIndex !== "number" ||
        typeof totalChunks !== "number" ||
        chunkIndex < 0 ||
        chunkIndex >= totalChunks ||
        totalChunks > 100
    ) {
        logger.warn(
            `Invalid chunk metadata from Newt ${newt.newtId}: chunkIndex=${chunkIndex}, totalChunks=${totalChunks}`
        );
        return;
    }

    if (!batchId || typeof batchId !== "string") {
        logger.warn(
            `Missing batchId in chunked message from Newt ${newt.newtId}`
        );
        return;
    }

    logger.info(
        `Received chunk ${chunkIndex + 1}/${totalChunks} for Newt ${newt.newtId} batch=${batchId} (${containers?.length || 0} containers)`
    );

    const chunkKey = getChunkCacheKey(newt.newtId);
    const existing = await cache.get<ChunkAccumulator>(chunkKey);

    let accumulator: ChunkAccumulator;

    if (!existing || existing.batchId !== batchId) {
        // New batch or different batch — start fresh
        // This handles concurrent sends: the newer batch supersedes the old one
        if (existing && existing.batchId !== batchId) {
            logger.info(
                `New batch ${batchId} supersedes in-progress batch ${existing.batchId} for Newt ${newt.newtId}`
            );
        }
        accumulator = {
            batchId,
            totalChunks,
            receivedChunks: 0,
            containers: []
        };
    } else {
        accumulator = existing;
    }

    if (containers && Array.isArray(containers)) {
        accumulator.containers.push(...containers);
    }
    accumulator.receivedChunks++;

    if (accumulator.receivedChunks >= accumulator.totalChunks) {
        logger.info(
            `All ${totalChunks} chunks received for Newt ${newt.newtId} batch=${batchId}, total containers: ${accumulator.containers.length}`
        );
        await cache.del(chunkKey);
        await processContainerList(
            newt.newtId,
            newt.siteId,
            accumulator.containers
        );
    } else {
        // Store partial data with a TTL to prevent stale chunks from accumulating
        await cache.set(chunkKey, accumulator, 120);
    }
};
