/*
 * This file is part of a proprietary work.
 *
 * Copyright (c) 2025-2026 Fossorial, Inc.
 * All rights reserved.
 *
 * This file is licensed under the Fossorial Commercial License.
 * You may not use this file except in compliance with the License.
 * Unauthorized use, copying, modification, or distribution is strictly prohibited.
 *
 * This file is not licensed under the AGPLv3.
 */

import { db, exitNodes } from "@server/db";
import { eq, lt, isNull, and, or } from "drizzle-orm";
import logger from "@server/logger";
import { getOfflineThresholds } from "#private/lib/offlineThresholds";

// Track if the offline checker interval is running
let offlineCheckerInterval: NodeJS.Timeout | null = null;

/**
 * Starts the background interval that checks for clients that haven't pinged recently
 * and marks them as offline
 */
export const startRemoteExitNodeOfflineChecker = (): void => {
    if (offlineCheckerInterval) {
        return; // Already running
    }

    offlineCheckerInterval = setInterval(async () => {
        try {
            const offlineBefore = Math.floor(
                (Date.now() - getOfflineThresholds().remoteExitNodeMs) / 1000
            );

            // Find clients that haven't pinged within the offline threshold and mark them as offline
            const offlineNodes = await db
                .update(exitNodes)
                .set({ online: false })
                .where(
                    and(
                        eq(exitNodes.online, true),
                        eq(exitNodes.type, "remoteExitNode"),
                        or(
                            lt(exitNodes.lastPing, offlineBefore),
                            isNull(exitNodes.lastPing)
                        )
                    )
                )
                .returning();

            if (offlineNodes.length > 0) {
                logger.info(
                    `checkRemoteExitNodeOffline: Marked ${offlineNodes.length} remoteExitNode client(s) offline due to inactivity`
                );

                for (const offlineClient of offlineNodes) {
                    logger.debug(
                        `checkRemoteExitNodeOffline: Client ${offlineClient.exitNodeId} marked offline (lastPing: ${offlineClient.lastPing})`
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
export const stopRemoteExitNodeOfflineChecker = (): void => {
    if (offlineCheckerInterval) {
        clearInterval(offlineCheckerInterval);
        offlineCheckerInterval = null;
        logger.info("Stopped offline checker interval");
    }
};
