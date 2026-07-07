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
import { MessageHandler } from "@server/routers/ws";
import { RemoteExitNode } from "@server/db";
import { eq } from "drizzle-orm";
import logger from "@server/logger";
import { scheduleExitNodeReconnect } from "./exitNodeReconnectScheduler";

/**
 * Handles ping messages from clients and responds with pong
 */
export const handleRemoteExitNodePingMessage: MessageHandler = async (
    context
) => {
    const { message, client: c, sendToClient } = context;
    const remoteExitNode = c as RemoteExitNode;

    if (!remoteExitNode) {
        logger.debug("RemoteExitNode not found");
        return;
    }

    if (!remoteExitNode.exitNodeId) {
        logger.debug("RemoteExitNode has no exit node ID!"); // this can happen if the exit node is created but not adopted yet
        return;
    }

    try {
        // Fetch the current state before updating so we can detect the offline→online transition
        const [currentExitNode] = await db
            .select({ online: exitNodes.online, reachableAt: exitNodes.reachableAt })
            .from(exitNodes)
            .where(eq(exitNodes.exitNodeId, remoteExitNode.exitNodeId))
            .limit(1);

        // Update the exit node's last ping timestamp
        await db
            .update(exitNodes)
            .set({
                lastPing: Math.floor(Date.now() / 1000),
                online: true
            })
            .where(eq(exitNodes.exitNodeId, remoteExitNode.exitNodeId));

        // If the exit node was offline and is now coming online, schedule newt reconnects
        if (currentExitNode && !currentExitNode.online && currentExitNode.reachableAt) {
            scheduleExitNodeReconnect(
                remoteExitNode.exitNodeId,
                currentExitNode.reachableAt
            ).catch((error) => {
                logger.error("Failed to schedule exit node reconnect", { error });
            });
        }
    } catch (error) {
        logger.error("Error handling ping message", { error });
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
