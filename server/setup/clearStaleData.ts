import { build } from "@server/build";
import { db, deviceWebAuthCodes, sessionTransferToken } from "@server/db";
import {
    emailVerificationCodes,
    newtSessions,
    oauthAccessTokens,
    oauthAuthorizationCodes,
    oauthInteractions,
    passwordResetTokens,
    resourceAccessToken,
    resourceOtp,
    resourceSessions,
    sessions,
    userInvites
} from "@server/db";
import logger from "@server/logger";
import { lt } from "drizzle-orm";

export async function clearStaleData() {
    try {
        await db
            .delete(sessions)
            .where(lt(sessions.expiresAt, new Date().getTime()));
    } catch (e) {
        logger.warn("Error clearing expired sessions:", e);
    }

    try {
        await db
            .delete(newtSessions)
            .where(lt(newtSessions.expiresAt, new Date().getTime()));
    } catch (e) {
        logger.warn("Error clearing expired newtSessions:", e);
    }

    try {
        await db
            .delete(emailVerificationCodes)
            .where(lt(emailVerificationCodes.expiresAt, new Date().getTime()));
    } catch (e) {
        logger.warn("Error clearing expired emailVerificationCodes:", e);
    }

    try {
        await db
            .delete(passwordResetTokens)
            .where(lt(passwordResetTokens.expiresAt, new Date().getTime()));
    } catch (e) {
        logger.warn("Error clearing expired passwordResetTokens:", e);
    }

    try {
        await db
            .delete(userInvites)
            .where(lt(userInvites.expiresAt, new Date().getTime()));
    } catch (e) {
        logger.warn("Error clearing expired userInvites:", e);
    }

    try {
        await db
            .delete(resourceAccessToken)
            .where(lt(resourceAccessToken.expiresAt, new Date().getTime()));
    } catch (e) {
        logger.warn("Error clearing expired resourceAccessToken:", e);
    }

    try {
        await db
            .delete(resourceSessions)
            .where(lt(resourceSessions.expiresAt, new Date().getTime()));
    } catch (e) {
        logger.warn("Error clearing expired resourceSessions:", e);
    }

    try {
        await db
            .delete(resourceOtp)
            .where(lt(resourceOtp.expiresAt, new Date().getTime()));
    } catch (e) {
        logger.warn("Error clearing expired resourceOtp:", e);
    }

    if (build !== "oss") {
        try {
            await db
                .delete(sessionTransferToken)
                .where(
                    lt(sessionTransferToken.expiresAt, new Date().getTime())
                );
        } catch (e) {
            logger.warn("Error clearing expired sessionTransferToken:", e);
        }
    }

    try {
        await db
            .delete(deviceWebAuthCodes)
            .where(lt(deviceWebAuthCodes.expiresAt, new Date().getTime()));
    } catch (e) {
        logger.warn("Error clearing expired deviceWebAuthCodes:", e);
    }

    try {
        await db
            .delete(oauthInteractions)
            .where(lt(oauthInteractions.expiresAt, new Date().getTime()));
    } catch (e) {
        logger.warn("Error clearing expired oauthInteractions:", e);
    }

    try {
        await db
            .delete(oauthAuthorizationCodes)
            .where(lt(oauthAuthorizationCodes.expiresAt, new Date().getTime()));
    } catch (e) {
        logger.warn("Error clearing expired oauthAuthorizationCodes:", e);
    }

    try {
        await db
            .delete(oauthAccessTokens)
            .where(lt(oauthAccessTokens.expiresAt, new Date().getTime()));
    } catch (e) {
        logger.warn("Error clearing expired oauthAccessTokens:", e);
    }
}
