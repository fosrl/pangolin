import { disconnectClient, getClientConfigVersion } from "#dynamic/routers/ws";
import { db } from "@server/db";
import { clients } from "@server/db";
import { eq, lt, isNull, and, or } from "drizzle-orm";
import logger from "@server/logger";
import { sendTerminateClient } from "../client/terminate";
import { OlmErrorCodes } from "./error";
import { getOfflineThresholds } from "#dynamic/lib/offlineThresholds";

// Track if the offline checker interval is running
let offlineCheckerInterval: NodeJS.Timeout | null = null;

/**
 * Starts the background interval that checks for clients that haven't pinged recently
 * and marks them as offline
 */
export const startOlmOfflineChecker = (): void => {
    if (offlineCheckerInterval) {
        return; // Already running
    }

    offlineCheckerInterval = setInterval(async () => {
        try {
            const offlineBefore = Math.floor(
                (Date.now() - getOfflineThresholds().olmMs) / 1000
            );

            // TODO: WE NEED TO MAKE SURE THIS WORKS WITH DISTRIBUTED NODES ALL DOING THE SAME THING

            // Find clients that haven't pinged within the offline threshold and mark them as offline
            const offlineClients = await db
                .update(clients)
                .set({ online: false })
                .where(
                    and(
                        eq(clients.online, true),
                        or(
                            lt(clients.lastPing, offlineBefore),
                            isNull(clients.lastPing)
                        )
                    )
                )
                .returning();

            for (const offlineClient of offlineClients) {
                logger.info(
                    `Kicking offline olm client ${offlineClient.clientId} due to inactivity`
                );

                if (!offlineClient.olmId) {
                    logger.warn(
                        `Offline client ${offlineClient.clientId} has no olmId, cannot disconnect`
                    );
                    continue;
                }

                // Send a disconnect message to the client if connected
                try {
                    await sendTerminateClient(
                        offlineClient.clientId,
                        OlmErrorCodes.TERMINATED_INACTIVITY,
                        offlineClient.olmId
                    ); // terminate first
                    // wait a moment to ensure the message is sent
                    await new Promise((resolve) => setTimeout(resolve, 1000));
                    await disconnectClient(offlineClient.olmId);
                } catch (error) {
                    logger.error(
                        `Error sending disconnect to offline olm ${offlineClient.clientId}`,
                        { error }
                    );
                }
            }
        } catch (error) {
            logger.error("Error in offline checker interval", { error });
        }
    }, getOfflineThresholds().checkIntervalMs);

    logger.debug("Started offline checker interval");
};

/**
 * Stops the background interval that checks for offline clients
 */
export const stopOlmOfflineChecker = (): void => {
    if (offlineCheckerInterval) {
        clearInterval(offlineCheckerInterval);
        offlineCheckerInterval = null;
        logger.info("Stopped offline checker interval");
    }
};
