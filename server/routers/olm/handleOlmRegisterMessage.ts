import { db, orgs } from "@server/db";
import { MessageHandler } from "@server/routers/ws";
import {
    clients,
    clientSitesAssociationsCache,
    Olm,
    olms,
    sites
} from "@server/db";
import { count, eq } from "drizzle-orm";
import logger from "@server/logger";
import { checkOrgAccessPolicy } from "#dynamic/lib/checkOrgAccessPolicy";
import { validateSessionToken } from "@server/auth/sessions/app";
import { encodeHexLowerCase } from "@oslojs/encoding";
import { sha256 } from "@oslojs/crypto/sha2";
import { buildSiteConfigurationForOlmClient } from "./buildConfiguration";
import { OlmErrorCodes, sendOlmError } from "./error";
import { handleFingerprintInsertion } from "./fingerprintingUtils";

export const handleOlmRegisterMessage: MessageHandler = async (context) => {
    logger.info("Handling register olm message!");
    const { message, client: c, sendToClient } = context;
    const olm = c as Olm;

    const now = Math.floor(Date.now() / 1000);

    if (!olm) {
        logger.warn("Olm not found");
        return;
    }

    const {
        publicKey,
        relay,
        olmVersion,
        olmAgent,
        orgId,
        userToken,
        fingerprint,
        postures
    } = message.data;

    if (!olm.clientId) {
        logger.warn("Olm client ID not found");
        sendOlmError(OlmErrorCodes.CLIENT_ID_NOT_FOUND, olm.olmId);
        return;
    }

    await handleFingerprintInsertion(olm, fingerprint, postures);

    if (
        (olmVersion && olm.version !== olmVersion) ||
        (olmAgent && olm.agent !== olmAgent) ||
        olm.archived
    ) {
        await db
            .update(olms)
            .set({
                version: olmVersion,
                agent: olmAgent,
                archived: false
            })
            .where(eq(olms.olmId, olm.olmId));
    }

    const [client] = await db
        .select()
        .from(clients)
        .where(eq(clients.clientId, olm.clientId))
        .limit(1);

    if (!client) {
        logger.warn("Client ID not found");
        sendOlmError(OlmErrorCodes.CLIENT_NOT_FOUND, olm.olmId);
        return;
    }

    if (client.blocked) {
        logger.debug(
            `Client ${client.clientId} is blocked. Ignoring register.`
        );
        sendOlmError(OlmErrorCodes.CLIENT_BLOCKED, olm.olmId);
        return;
    }

    if (client.approvalState == "pending") {
        logger.debug(
            `Client ${client.clientId} approval is pending. Ignoring register.`
        );
        sendOlmError(OlmErrorCodes.CLIENT_PENDING, olm.olmId);
        return;
    }

    const [org] = await db
        .select()
        .from(orgs)
        .where(eq(orgs.orgId, client.orgId))
        .limit(1);

    if (!org) {
        logger.warn("Org not found");
        sendOlmError(OlmErrorCodes.ORG_NOT_FOUND, olm.olmId);
        return;
    }

    if (orgId) {
        if (!olm.userId) {
            logger.warn("Olm has no user ID");
            sendOlmError(OlmErrorCodes.USER_ID_NOT_FOUND, olm.olmId);
            return;
        }

        const { session: userSession, user } =
            await validateSessionToken(userToken);
        if (!userSession || !user) {
            logger.warn("Invalid user session for olm register");
            sendOlmError(OlmErrorCodes.INVALID_USER_SESSION, olm.olmId);
            return;
        }
        if (user.userId !== olm.userId) {
            logger.warn("User ID mismatch for olm register");
            sendOlmError(OlmErrorCodes.USER_ID_MISMATCH, olm.olmId);
            return;
        }

        const sessionId = encodeHexLowerCase(
            sha256(new TextEncoder().encode(userToken))
        );

        const policyCheck = await checkOrgAccessPolicy({
            orgId: orgId,
            userId: olm.userId,
            sessionId // this is the user token passed in the message
        });

        logger.debug("Policy check result:", policyCheck);

        if (policyCheck?.error) {
            logger.error(
                `Error checking access policies for olm user ${olm.userId} in org ${orgId}: ${policyCheck?.error}`
            );
            sendOlmError(OlmErrorCodes.ORG_ACCESS_POLICY_DENIED, olm.olmId);
            return;
        }

        if (!policyCheck.policies?.passwordAge?.compliant === false) {
            logger.warn(
                `Olm user ${olm.userId} has non-compliant password age for org ${orgId}`
            );
            sendOlmError(
                OlmErrorCodes.ORG_ACCESS_POLICY_PASSWORD_EXPIRED,
                olm.olmId
            );
            return;
        } else if (
            !policyCheck.policies?.maxSessionLength?.compliant === false
        ) {
            logger.warn(
                `Olm user ${olm.userId} has non-compliant session length for org ${orgId}`
            );
            sendOlmError(
                OlmErrorCodes.ORG_ACCESS_POLICY_SESSION_EXPIRED,
                olm.olmId
            );
            return;
        } else if (policyCheck.policies?.requiredTwoFactor === false) {
            logger.warn(
                `Olm user ${olm.userId} does not have 2FA enabled for org ${orgId}`
            );
            sendOlmError(
                OlmErrorCodes.ORG_ACCESS_POLICY_2FA_REQUIRED,
                olm.olmId
            );
            return;
        } else if (!policyCheck.allowed) {
            logger.warn(
                `Olm user ${olm.userId} does not pass access policies for org ${orgId}: ${policyCheck.error}`
            );
            sendOlmError(OlmErrorCodes.ORG_ACCESS_POLICY_DENIED, olm.olmId);
            return;
        }
    }

    logger.debug(
        `Olm client ID: ${client.clientId}, Public Key: ${publicKey}, Relay: ${relay}`
    );

    if (!publicKey) {
        logger.warn("Public key not provided");
        return;
    }

    if (client.pubKey !== publicKey || client.archived) {
        logger.info(
            "Public key mismatch. Updating public key and clearing session info..."
        );
        // Update the client's public key
        await db
            .update(clients)
            .set({
                pubKey: publicKey,
                archived: false
            })
            .where(eq(clients.clientId, client.clientId));

        // set isRelay to false for all of the client's sites to reset the connection metadata
        await db
            .update(clientSitesAssociationsCache)
            .set({
                isRelayed: relay == true
            })
            .where(eq(clientSitesAssociationsCache.clientId, client.clientId));
    }

    // Get all sites data
    const sitesCountResult = await db
        .select({ count: count() })
        .from(sites)
        .innerJoin(
            clientSitesAssociationsCache,
            eq(sites.siteId, clientSitesAssociationsCache.siteId)
        )
        .where(eq(clientSitesAssociationsCache.clientId, client.clientId));

    // Extract the count value from the result array
    const sitesCount =
        sitesCountResult.length > 0 ? sitesCountResult[0].count : 0;

    // Prepare an array to store site configurations
    logger.debug(`Found ${sitesCount} sites for client ${client.clientId}`);

    // this prevents us from accepting a register from an olm that has not hole punched yet.
    // the olm will pump the register so we can keep checking
    // TODO: I still think there is a better way to do this rather than locking it out here but ???
    if (now - (client.lastHolePunch || 0) > 5 && sitesCount > 0) {
        logger.warn(
            "Client last hole punch is too old and we have sites to send; skipping this register"
        );
        return;
    }

    // NOTE: its important that the client here is the old client and the public key is the new key
    const siteConfigurations = await buildSiteConfigurationForOlmClient(
        client,
        publicKey,
        relay
    );

    // REMOVED THIS SO IT CREATES THE INTERFACE AND JUST WAITS FOR THE SITES
    // if (siteConfigurations.length === 0) {
    //     logger.warn("No valid site configurations found");
    //     return;
    // }

    // Return connect message with all site configurations
    return {
        message: {
            type: "olm/wg/connect",
            data: {
                sites: siteConfigurations,
                tunnelIP: client.subnet,
                utilitySubnet: org.utilitySubnet
            }
        },
        broadcast: false,
        excludeSender: false
    };
};
