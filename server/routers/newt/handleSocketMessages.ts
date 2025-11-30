import { MessageHandler } from "@server/routers/ws";
import logger from "@server/logger";
import { Newt } from "@server/db";
import { applyNewtDockerBlueprint } from "@server/lib/blueprints/applyNewtDockerBlueprint";
import cache from "@server/lib/cache";

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
        cache.set(`${newt.newtId}:socketPath`, socketPath, 0);
        cache.set(`${newt.newtId}:isAvailable`, available, 0);
    } else {
        logger.warn(`Newt ${newt.newtId} does not have Docker socket access`);
    }

    return;
};

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
    const { containers } = message.data;

    logger.info(
        `Docker containers for Newt ${newt.newtId}: ${containers ? containers.length : 0}`
    );

    if (containers && containers.length > 0) {
        cache.set(`${newt.newtId}:dockerContainers`, containers, 0);
    } else {
        logger.warn(`Newt ${newt.newtId} does not have Docker containers`);
    }

    if (!newt.siteId) {
        logger.warn("Newt has no site!");
        return;
    }

    await applyNewtDockerBlueprint(
        newt.siteId,
        newt.newtId,
        containers
    );
};
