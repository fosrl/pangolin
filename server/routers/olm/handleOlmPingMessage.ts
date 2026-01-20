import { disconnectClient, getClientConfigVersion } from "#dynamic/routers/ws";
import { db } from "@server/db";
import { MessageHandler } from "@server/routers/ws";
import { clients, olms, Olm } from "@server/db";
import { eq, lt, isNull, and, or } from "drizzle-orm";
import logger from "@server/logger";
import { validateSessionToken } from "@server/auth/sessions/app";
import { checkOrgAccessPolicy } from "#dynamic/lib/checkOrgAccessPolicy";
import { sendTerminateClient } from "../client/terminate";
import { encodeHexLowerCase } from "@oslojs/encoding";
import { sha256 } from "@oslojs/crypto/sha2";
import { sendOlmSyncMessage } from "./sync";
import { OlmErrorCodes } from "./error";
import { handleFingerprintInsertion } from "./fingerprintingUtils";

// Track if the offline checker interval is running
let offlineCheckerInterval: NodeJS.Timeout | null = null;
const OFFLINE_CHECK_INTERVAL = 30 * 1000; // Check every 30 seconds
const OFFLINE_THRESHOLD_MS = 2 * 60 * 1000; // 2 minutes

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
            const twoMinutesAgo = Math.floor(
                (Date.now() - OFFLINE_THRESHOLD_MS) / 1000
            );

            // TODO: WE NEED TO MAKE SURE THIS WORKS WITH DISTRIBUTED NODES ALL DOING THE SAME THING

            // Find clients that haven't pinged in the last 2 minutes and mark them as offline
            const offlineClients = await db
                .update(clients)
                .set({ online: false })
                .where(
                    and(
                        eq(clients.online, true),
                        or(
                            lt(clients.lastPing, twoMinutesAgo),
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
    }, OFFLINE_CHECK_INTERVAL);

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

/**
 * Handles ping messages from clients and responds with pong
 */
export const handleOlmPingMessage: MessageHandler = async (context) => {
    const { message, client: c, sendToClient } = context;
    const olm = c as Olm;

    const { userToken, fingerprint, postures } = message.data;

    if (!olm) {
        logger.warn("Olm not found");
        return;
    }

    if (!olm.clientId) {
        logger.warn("Olm has no client ID!");
        return;
    }

    try {
        // get the client
        const [client] = await db
            .select()
            .from(clients)
            .where(eq(clients.clientId, olm.clientId))
            .limit(1);

        if (!client) {
            logger.warn("Client not found for olm ping");
            return;
        }

        if (client.blocked) {
            // NOTE: by returning we dont update the lastPing, so the offline checker will eventually disconnect them
            logger.debug(
                `Blocked client ${client.clientId} attempted olm ping`
            );
            return;
        }

        if (olm.userId) {
            // we need to check a user token to make sure its still valid
            const { session: userSession, user } =
                await validateSessionToken(userToken);
            if (!userSession || !user) {
                logger.warn("Invalid user session for olm ping");
                return; // by returning here we just ignore the ping and the setInterval will force it to disconnect
            }
            if (user.userId !== olm.userId) {
                logger.warn("User ID mismatch for olm ping");
                return;
            }
            if (user.userId !== client.userId) {
                logger.warn("Client user ID mismatch for olm ping");
                return;
            }

            const sessionId = encodeHexLowerCase(
                sha256(new TextEncoder().encode(userToken))
            );

            const policyCheck = await checkOrgAccessPolicy({
                orgId: client.orgId,
                userId: olm.userId,
                sessionId // this is the user token passed in the message
            });

            if (!policyCheck.allowed) {
                logger.warn(
                    `Olm user ${olm.userId} does not pass access policies for org ${client.orgId}: ${policyCheck.error}`
                );
                return;
            }
        }

        // get the version
        logger.debug(
            `handleOlmPingMessage: About to get config version for olmId: ${olm.olmId}`
        );
        const configVersion = await getClientConfigVersion(olm.olmId);
        logger.debug(
            `handleOlmPingMessage: Got config version: ${configVersion} (type: ${typeof configVersion})`
        );

        if (configVersion == null || configVersion === undefined) {
            logger.debug(
                `handleOlmPingMessage: could not get config version from server for olmId: ${olm.olmId}`
            );
        }

        if (
            message.configVersion != null &&
            configVersion != null &&
            configVersion != message.configVersion
        ) {
            logger.debug(
                `handleOlmPingMessage: Olm ping with outdated config version: ${message.configVersion} (current: ${configVersion})`
            );
            await sendOlmSyncMessage(olm, client);
        }

        // Update the client's last ping timestamp
        await db
            .update(clients)
            .set({
                lastPing: Math.floor(Date.now() / 1000),
                online: true,
                archived: false
            })
            .where(eq(clients.clientId, olm.clientId));

        if (olm.archived) {
            await db
                .update(olms)
                .set({ archived: false })
                .where(eq(olms.olmId, olm.olmId));
        }
    } catch (error) {
        logger.error("Error handling ping message", { error });
    }

    await handleFingerprintInsertion(olm, fingerprint, postures);

    return {
        message: {
            type: "pong",
            data: {
                timestamp: new Date().toISOString()
            }
        },
        broadcast: false,
        excludeSender: false
    };
};
