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
import { getUserDeviceName } from "@server/db/names";
import { buildSiteConfigurationForOlmClient } from "./buildConfiguration";
import { OlmErrorCodes, sendOlmError } from "./error";
import { handleFingerprintInsertion } from "./fingerprintingUtils";
import { build } from "@server/build";
import { canCompress } from "@server/lib/clientVersionChecks";
import config from "@server/lib/config";

export const handleOlmRegisterMessage: MessageHandler = async (context) => {
    logger.info("[handleOlmRegisterMessage] Handling register olm message");
    const { message, client: c, sendToClient } = context;
    const olm = c as Olm;

    const now = Math.floor(Date.now() / 1000);

    if (!olm) {
        logger.warn("[handleOlmRegisterMessage] Olm not found");
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
        postures,
        chainId
    } = message.data;

    if (!olm.clientId) {
        logger.warn("[handleOlmRegisterMessage] Olm client ID not found");
        sendOlmError(OlmErrorCodes.CLIENT_ID_NOT_FOUND, olm.olmId);
        return;
    }

    logger.debug(
        "[handleOlmRegisterMessage] Handling fingerprint insertion for olm register...",
        {
            olmId: olm.olmId,
            fingerprint,
            postures
        }
    );

    const isUserDevice = olm.userId !== null && olm.userId !== undefined;

    if (isUserDevice) {
        await handleFingerprintInsertion(olm, fingerprint, postures);
    }

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
        logger.warn("[handleOlmRegisterMessage] Client not found", {
            clientId: olm.clientId
        });
        sendOlmError(OlmErrorCodes.CLIENT_NOT_FOUND, olm.olmId);
        return;
    }

    if (client.blocked) {
        logger.debug(
            `[handleOlmRegisterMessage] Client ${client.clientId} is blocked. Ignoring register.`,
            { orgId: client.orgId }
        );
        sendOlmError(OlmErrorCodes.CLIENT_BLOCKED, olm.olmId);
        return;
    }

    if (client.approvalState == "pending") {
        logger.debug(
            `[handleOlmRegisterMessage] Client ${client.clientId} approval is pending. Ignoring register.`,
            { orgId: client.orgId }
        );
        sendOlmError(OlmErrorCodes.CLIENT_PENDING, olm.olmId);
        return;
    }

    const deviceModel = fingerprint?.deviceModel ?? null;
    const computedName = getUserDeviceName(deviceModel, client.name);
    if (computedName && computedName !== client.name) {
        await db
            .update(clients)
            .set({ name: computedName })
            .where(eq(clients.clientId, client.clientId));
    }
    if (computedName && computedName !== olm.name) {
        await db
            .update(olms)
            .set({ name: computedName })
            .where(eq(olms.olmId, olm.olmId));
    }

    const [org] = await db
        .select()
        .from(orgs)
        .where(eq(orgs.orgId, client.orgId))
        .limit(1);

    if (!org) {
        logger.warn("[handleOlmRegisterMessage] Org not found", {
            orgId: client.orgId
        });
        sendOlmError(OlmErrorCodes.ORG_NOT_FOUND, olm.olmId);
        return;
    }

    if (orgId) {
        if (!olm.userId) {
            logger.warn("[handleOlmRegisterMessage] Olm has no user ID", {
                orgId: client.orgId
            });
            sendOlmError(OlmErrorCodes.USER_ID_NOT_FOUND, olm.olmId);
            return;
        }

        const { session: userSession, user } =
            await validateSessionToken(userToken);
        if (!userSession || !user) {
            logger.warn(
                "[handleOlmRegisterMessage] Invalid user session for olm register",
                { orgId: client.orgId }
            );
            sendOlmError(OlmErrorCodes.INVALID_USER_SESSION, olm.olmId);
            return;
        }
        if (user.userId !== olm.userId) {
            logger.warn(
                "[handleOlmRegisterMessage] User ID mismatch for olm register",
                { orgId: client.orgId }
            );
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

        logger.debug("[handleOlmRegisterMessage] Policy check result", {
            orgId: client.orgId,
            policyCheck
        });

        if (policyCheck?.error) {
            logger.error(
                `[handleOlmRegisterMessage] Error checking access policies for olm user ${olm.userId} in org ${orgId}: ${policyCheck?.error}`,
                { orgId: client.orgId }
            );
            sendOlmError(OlmErrorCodes.ORG_ACCESS_POLICY_DENIED, olm.olmId);
            return;
        }

        if (policyCheck.policies?.passwordAge?.compliant === false) {
            logger.warn(
                `[handleOlmRegisterMessage] Olm user ${olm.userId} has non-compliant password age for org ${orgId}`,
                { orgId: client.orgId }
            );
            sendOlmError(
                OlmErrorCodes.ORG_ACCESS_POLICY_PASSWORD_EXPIRED,
                olm.olmId
            );
            return;
        } else if (
            policyCheck.policies?.maxSessionLength?.compliant === false
        ) {
            logger.warn(
                `[handleOlmRegisterMessage] Olm user ${olm.userId} has non-compliant session length for org ${orgId}`,
                { orgId: client.orgId }
            );
            sendOlmError(
                OlmErrorCodes.ORG_ACCESS_POLICY_SESSION_EXPIRED,
                olm.olmId
            );
            return;
        } else if (policyCheck.policies?.requiredTwoFactor === false) {
            logger.warn(
                `[handleOlmRegisterMessage] Olm user ${olm.userId} does not have 2FA enabled for org ${orgId}`,
                { orgId: client.orgId }
            );
            sendOlmError(
                OlmErrorCodes.ORG_ACCESS_POLICY_2FA_REQUIRED,
                olm.olmId
            );
            return;
        } else if (!policyCheck.allowed) {
            logger.warn(
                `[handleOlmRegisterMessage] Olm user ${olm.userId} does not pass access policies for org ${orgId}: ${policyCheck.error}`,
                { orgId: client.orgId }
            );
            sendOlmError(OlmErrorCodes.ORG_ACCESS_POLICY_DENIED, olm.olmId);
            return;
        }
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
    logger.debug(
        `[handleOlmRegisterMessage] Found ${sitesCount} sites for client ${client.clientId}`,
        { orgId: client.orgId }
    );

    let jitMode = false;
    if (sitesCount > 250 && build == "saas") {
        // THIS IS THE MAX ON THE BUSINESS TIER
        // we have too many sites
        // If we have too many sites we need to drop into fully JIT mode by not sending any of the sites
        logger.info(
            `[handleOlmRegisterMessage] Too many sites (${sitesCount}), dropping into JIT mode`,
            { orgId: client.orgId }
        );
        jitMode = true;
    }

    logger.debug(
        `[handleOlmRegisterMessage] Olm client ID: ${client.clientId}, Public Key: ${publicKey}, Relay: ${relay}`,
        { orgId: client.orgId }
    );

    if (!publicKey) {
        logger.warn("[handleOlmRegisterMessage] Public key not provided", {
            orgId: client.orgId
        });
        return;
    }

    if (client.pubKey !== publicKey || client.archived) {
        logger.info(
            "[handleOlmRegisterMessage] Public key mismatch. Updating public key and clearing session info...",
            { orgId: client.orgId }
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
                isRelayed: relay == true,
                isJitMode: jitMode
            })
            .where(eq(clientSitesAssociationsCache.clientId, client.clientId));
    }

    // this prevents us from accepting a register from an olm that has not hole punched yet.
    // the olm will pump the register so we can keep checking
    if (now - (client.lastHolePunch || 0) > 5 && sitesCount > 0) {
        logger.warn(
            `[handleOlmRegisterMessage] Client last hole punch is too old and we have sites to send; skipping this register. The client is failing to hole punch and identify its network address with the server. Can the client reach the server on UDP port ${config.getRawConfig().gerbil.clients_start_port}?`,
            { orgId: client.orgId }
        );
        sendOlmError(OlmErrorCodes.STALE_HOLE_PUNCH, olm.olmId);
        return;
    }

    // NOTE: its important that the client here is the old client and the public key is the new key
    const siteConfigurations = await buildSiteConfigurationForOlmClient(
        client,
        publicKey,
        relay,
        jitMode
    );

    // Return connect message with all site configurations
    return {
        message: {
            type: "olm/wg/connect",
            data: {
                sites: siteConfigurations,
                tunnelIP: client.subnet,
                utilitySubnet: org.utilitySubnet,
                chainId: chainId
            }
        },
        options: {
            compress: canCompress(olm.version, "olm")
        },
        broadcast: false,
        excludeSender: false
    };
};
