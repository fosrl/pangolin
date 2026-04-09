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

/**
 * Get the cache key for storing in-progress chunked container data.
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
    const { containers, chunkIndex, totalChunks } = message.data;

    // Non-chunked message (backward compatible with older newt versions)
    if (totalChunks === undefined || totalChunks <= 1) {
        await processContainerList(
            newt.newtId,
            newt.siteId,
            containers || []
        );
        return;
    }

    // Chunked message — accumulate chunks in cache then process when complete
    logger.info(
        `Received chunk ${chunkIndex + 1}/${totalChunks} for Newt ${newt.newtId} (${containers?.length || 0} containers in this chunk)`
    );

    const chunkKey = getChunkCacheKey(newt.newtId);
    const existing =
        (await cache.get<{ receivedChunks: number; containers: any[] }>(
            chunkKey
        )) || { receivedChunks: 0, containers: [] };

    if (chunkIndex === 0) {
        // First chunk — reset accumulator
        existing.receivedChunks = 0;
        existing.containers = [];
    }

    if (containers && containers.length > 0) {
        existing.containers.push(...containers);
    }
    existing.receivedChunks++;

    if (existing.receivedChunks >= totalChunks) {
        // All chunks received — process the complete list
        logger.info(
            `All ${totalChunks} chunks received for Newt ${newt.newtId}, total containers: ${existing.containers.length}`
        );
        await cache.del(chunkKey);
        await processContainerList(
            newt.newtId,
            newt.siteId,
            existing.containers
        );
    } else {
        // Store partial data with a TTL so stale chunks don't accumulate forever
        await cache.set(chunkKey, existing, 120);
    }
};
