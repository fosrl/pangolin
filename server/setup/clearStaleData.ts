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
import { isNotNull, lt, or } from "drizzle-orm";

async function runCleanup(
    name: string,
    cleanup: () => Promise<void>
): Promise<void> {
    try {
        await cleanup();
    } catch (error) {
        logger.warn(`Error clearing expired ${name}:`, error);
    }
}

export async function cleanExpiredOAuthData(now: number) {
    await runCleanup("oauthInteractions", async () => {
        await db
            .delete(oauthInteractions)
            .where(lt(oauthInteractions.expiresAt, now));
    });
    await runCleanup("oauthAuthorizationCodes", async () => {
        await db
            .delete(oauthAuthorizationCodes)
            .where(lt(oauthAuthorizationCodes.expiresAt, now));
    });
    await runCleanup("oauthAccessTokens", async () => {
        await db
            .delete(oauthAccessTokens)
            .where(lt(oauthAccessTokens.expiresAt, now));
    });
    await runCleanup("oauthRefreshTokens", async () => {
        await db
            .delete(oauthRefreshTokens)
            .where(
                or(
                    lt(oauthRefreshTokens.expiresAt, now),
                    isNotNull(oauthRefreshTokens.revokedAt)
                )
            );
    });
}

export async function clearStaleData() {
    const now = Date.now();

    await runCleanup("sessions", async () => {
        await db.delete(sessions).where(lt(sessions.expiresAt, now));
    });
    await runCleanup("newtSessions", async () => {
        await db.delete(newtSessions).where(lt(newtSessions.expiresAt, now));
    });
    await runCleanup("emailVerificationCodes", async () => {
        await db
            .delete(emailVerificationCodes)
            .where(lt(emailVerificationCodes.expiresAt, now));
    });
    await runCleanup("passwordResetTokens", async () => {
        await db
            .delete(passwordResetTokens)
            .where(lt(passwordResetTokens.expiresAt, now));
    });
    await runCleanup("userInvites", async () => {
        await db.delete(userInvites).where(lt(userInvites.expiresAt, now));
    });
    await runCleanup("resourceAccessToken", async () => {
        await db
            .delete(resourceAccessToken)
            .where(lt(resourceAccessToken.expiresAt, now));
    });
    await runCleanup("resourceSessions", async () => {
        await db
            .delete(resourceSessions)
            .where(lt(resourceSessions.expiresAt, now));
    });
    await runCleanup("resourceOtp", async () => {
        await db.delete(resourceOtp).where(lt(resourceOtp.expiresAt, now));
    });

    if (build !== "oss") {
        await runCleanup("sessionTransferToken", async () => {
            await db
                .delete(sessionTransferToken)
                .where(lt(sessionTransferToken.expiresAt, now));
        });
    }

    await runCleanup("deviceWebAuthCodes", async () => {
        await db
            .delete(deviceWebAuthCodes)
            .where(lt(deviceWebAuthCodes.expiresAt, now));
    });

    await cleanExpiredOAuthData(now);
}
