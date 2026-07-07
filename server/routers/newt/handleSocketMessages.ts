import { MessageHandler } from "@server/routers/ws";
import logger from "@server/logger";
import { Newt } from "@server/db";
import { applyNewtDockerBlueprint } from "@server/lib/blueprints/applyNewtDockerBlueprint";
import cache from "#dynamic/lib/cache"; // not using regional here because we dont know where the site is

export const handleDockerStatusMessage: MessageHandler = async (context) => {
    const { message, client, sendToClient } = context;
    const newt = client as Newt;

    logger.debug("Handling Docker socket check response");

    if (!newt) {
        logger.warn("Newt not found");
        return;
    }

    logger.debug(`Newt ID: ${newt.newtId}, Site ID: ${newt.siteId}`);
    const { available, socketPath } = message.data;

    logger.debug(
        `Docker socket availability for Newt ${newt.newtId}: available=${available}, socketPath=${socketPath}`
    );

    if (available) {
        logger.debug(`Newt ${newt.newtId} has Docker socket access`);
        await cache.set(`${newt.newtId}:socketPath`, socketPath, 0);
        await cache.set(`${newt.newtId}:isAvailable`, available, 0);
    } else {
        logger.debug(`Newt ${newt.newtId} does not have Docker socket access`);
    }

    return;
};

export const handleDockerContainersMessage: MessageHandler = async (
    context
) => {
    const { message, client, sendToClient } = context;
    const newt = client as Newt;

    logger.debug("Handling Docker containers response");

    if (!newt) {
        logger.warn("Newt not found");
        return;
    }

    logger.debug(`Newt ID: ${newt.newtId}, Site ID: ${newt.siteId}`);
    const { containers } = message.data;

    logger.debug(
        `Docker containers for Newt ${newt.newtId}: ${containers ? containers.length : 0}`
    );

    if (containers && containers.length > 0) {
        await cache.set(`${newt.newtId}:dockerContainers`, containers, 0);
    } else {
        logger.debug(`Newt ${newt.newtId} does not have Docker containers`);
    }

    if (!newt.siteId) {
        logger.debug("Newt has no site!");
        return;
    }

    await applyNewtDockerBlueprint(newt.siteId, newt.newtId, containers);
};
