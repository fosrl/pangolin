import { disconnectClient, getClientConfigVersion } from "#dynamic/routers/ws";
import { db } from "@server/db";
import { MessageHandler } from "@server/routers/ws";
import { clients, Olm } from "@server/db";
import { eq } from "drizzle-orm";
import { recordClientPing } from "@server/routers/newt/pingAccumulator";
import logger from "@server/logger";
import { validateSessionToken } from "@server/auth/sessions/app";
import { checkOrgAccessPolicy } from "#dynamic/lib/checkOrgAccessPolicy";
import { encodeHexLowerCase } from "@oslojs/encoding";
import { sha256 } from "@oslojs/crypto/sha2";
import { sendOlmSyncMessage } from "./sync";
import { handleFingerprintInsertion } from "./fingerprintingUtils";
import { sendTerminateClient } from "../client/terminate";
import { OlmErrorCodes } from "./error";

type OlmErrorCode = (typeof OlmErrorCodes)[keyof typeof OlmErrorCodes];

/**
 * Tells the olm why it is being kicked, then closes its websocket so it
 * does not linger connected until the offline checker notices.
 */
async function terminateOlm(
    clientId: number,
    olmId: string,
    error: OlmErrorCode
) {
    try {
        await sendTerminateClient(clientId, error, olmId);
        // wait a moment to ensure the message is sent
        await new Promise((resolve) => setTimeout(resolve, 1000));
        await disconnectClient(olmId);
    } catch (err) {
        logger.error(`Error terminating olm ${olmId}`, { error: err });
    }
}

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

    const isUserDevice = olm.userId !== null && olm.userId !== undefined;

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
                await terminateOlm(
                    client.clientId,
                    olm.olmId,
                    OlmErrorCodes.INVALID_USER_SESSION
                );
                return;
            }
            if (user.userId !== olm.userId) {
                logger.warn("User ID mismatch for olm ping");
                await terminateOlm(
                    client.clientId,
                    olm.olmId,
                    OlmErrorCodes.USER_ID_MISMATCH
                );
                return;
            }
            if (user.userId !== client.userId) {
                logger.warn("Client user ID mismatch for olm ping");
                await terminateOlm(
                    client.clientId,
                    olm.olmId,
                    OlmErrorCodes.USER_ID_MISMATCH
                );
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
                let error: OlmErrorCode =
                    OlmErrorCodes.ORG_ACCESS_POLICY_DENIED;
                if (policyCheck.policies?.passwordAge?.compliant === false) {
                    error = OlmErrorCodes.ORG_ACCESS_POLICY_PASSWORD_EXPIRED;
                } else if (
                    policyCheck.policies?.maxSessionLength?.compliant === false
                ) {
                    error = OlmErrorCodes.ORG_ACCESS_POLICY_SESSION_EXPIRED;
                } else if (policyCheck.policies?.requiredTwoFactor === false) {
                    error = OlmErrorCodes.ORG_ACCESS_POLICY_2FA_REQUIRED;
                }
                await terminateOlm(client.clientId, olm.olmId, error);
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

        // Record the ping in memory; it will be flushed to the database
        // periodically by the ping accumulator (every ~10s) in a single
        // batched UPDATE instead of one query per ping. This prevents
        // connection pool exhaustion under load, especially with
        // cross-region latency to the database.
        recordClientPing(olm.clientId, olm.olmId, !!olm.archived);
    } catch (error) {
        logger.error("Error handling ping message", { error });
    }

    if (isUserDevice) {
        await handleFingerprintInsertion(olm, fingerprint, postures);
    }

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
