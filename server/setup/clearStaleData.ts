import { build } from "@server/build";
import { db, deviceWebAuthCodes, sessionTransferToken } from "@server/db";
import {
    emailVerificationCodes,
    newtSessions,
    oauthAccessTokens,
    oauthAuthorizationCodes,
    oauthInteractions,
    oauthRefreshTokens,
    passwordResetTokens,
    resourceAccessToken,
    resourceOtp,
    resourceSessions,
    sessions,
    userInvites
} from "@server/db";
import logger from "@server/logger";
import { lt } from "drizzle-orm";

export async function cleanExpiredOAuthData(now: number) {
    try {
        await db
            .delete(oauthInteractions)
            .where(lt(oauthInteractions.expiresAt, now));
    } catch (e) {
        logger.warn("Error clearing expired oauthInteractions:", e);
    }

    try {
        await db
            .delete(oauthAuthorizationCodes)
            .where(lt(oauthAuthorizationCodes.expiresAt, now));
    } catch (e) {
        logger.warn("Error clearing expired oauthAuthorizationCodes:", e);
    }

    try {
        await db
            .delete(oauthAccessTokens)
            .where(lt(oauthAccessTokens.expiresAt, now));
    } catch (e) {
        logger.warn("Error clearing expired oauthAccessTokens:", e);
    }

    try {
        await db
            .delete(oauthRefreshTokens)
            .where(lt(oauthRefreshTokens.expiresAt, now));
    } catch (e) {
        logger.warn("Error clearing expired oauthRefreshTokens:", e);
    }
}

export async function clearStaleData() {
    const now = Date.now();

    try {
        await db
            .delete(sessions)
            .where(lt(sessions.expiresAt, now));
    } catch (e) {
        logger.warn("Error clearing expired sessions:", e);
    }

    try {
        await db
            .delete(newtSessions)
            .where(lt(newtSessions.expiresAt, now));
    } catch (e) {
        logger.warn("Error clearing expired newtSessions:", e);
    }

    try {
        await db
            .delete(emailVerificationCodes)
            .where(lt(emailVerificationCodes.expiresAt, now));
    } catch (e) {
        logger.warn("Error clearing expired emailVerificationCodes:", e);
    }

    try {
        await db
            .delete(passwordResetTokens)
            .where(lt(passwordResetTokens.expiresAt, now));
    } catch (e) {
        logger.warn("Error clearing expired passwordResetTokens:", e);
    }

    try {
        await db
            .delete(userInvites)
            .where(lt(userInvites.expiresAt, now));
    } catch (e) {
        logger.warn("Error clearing expired userInvites:", e);
    }

    try {
        await db
            .delete(resourceAccessToken)
            .where(lt(resourceAccessToken.expiresAt, now));
    } catch (e) {
        logger.warn("Error clearing expired resourceAccessToken:", e);
    }

    try {
        await db
            .delete(resourceSessions)
            .where(lt(resourceSessions.expiresAt, now));
    } catch (e) {
        logger.warn("Error clearing expired resourceSessions:", e);
    }

    try {
        await db
            .delete(resourceOtp)
            .where(lt(resourceOtp.expiresAt, now));
    } catch (e) {
        logger.warn("Error clearing expired resourceOtp:", e);
    }

    if (build !== "oss") {
        try {
            await db
                .delete(sessionTransferToken)
                .where(
                    lt(sessionTransferToken.expiresAt, now)
                );
        } catch (e) {
            logger.warn("Error clearing expired sessionTransferToken:", e);
        }
    }

    try {
        await db
            .delete(deviceWebAuthCodes)
            .where(lt(deviceWebAuthCodes.expiresAt, now));
    } catch (e) {
        logger.warn("Error clearing expired deviceWebAuthCodes:", e);
    }

    await cleanExpiredOAuthData(now);
}
