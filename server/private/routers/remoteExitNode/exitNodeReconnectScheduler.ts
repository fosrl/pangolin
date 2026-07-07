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

import axios from "axios";
import { db, exitNodes, newts, sites } from "@server/db";
import { eq } from "drizzle-orm";
import logger from "@server/logger";
import redisManager from "#private/lib/redis";
import { sendToClient } from "#private/routers/ws";

const INITIAL_DELAY_MS = 15 * 1000; // 15 seconds before first check
const CHECK_INTERVAL_MS = 10 * 1000; // Check every 10 seconds
const MAX_DURATION_MS = 5 * 60 * 1000; // Give up after 5 minutes
const REDIS_PENDING_SET = "exit-node-reconnect-pending";
const REDIS_HASH_PREFIX = "exit-node-reconnect:";

interface PendingReconnect {
    startTime: number;
    reachableAt: string;
}

// In-memory tracking for this node
const pendingReconnects = new Map<number, PendingReconnect>();

let schedulerInterval: NodeJS.Timeout | null = null;

/**
 * Schedules a reconnect check for newts connected to the given exit node.
 * Called when an exit node transitions from offline to online.
 */
export async function scheduleExitNodeReconnect(
    exitNodeId: number,
    reachableAt: string
): Promise<void> {
    logger.info(
        `Scheduling newt reconnect for exit node ${exitNodeId} (reachableAt: ${reachableAt})`
    );

    const entry: PendingReconnect = {
        startTime: Date.now(),
        reachableAt
    };

    pendingReconnects.set(exitNodeId, entry);

    // Store in Redis if available for cross-node coordination
    if (redisManager.isRedisEnabled()) {
        await redisManager.sadd(REDIS_PENDING_SET, exitNodeId.toString());
        await redisManager.hset(
            `${REDIS_HASH_PREFIX}${exitNodeId}`,
            "startTime",
            entry.startTime.toString()
        );
        await redisManager.hset(
            `${REDIS_HASH_PREFIX}${exitNodeId}`,
            "reachableAt",
            reachableAt
        );
    }
}

/**
 * Starts the background interval that checks pending exit node reconnects.
 */
export function startExitNodeReconnectScheduler(): void {
    if (schedulerInterval) {
        return;
    }

    schedulerInterval = setInterval(async () => {
        try {
            await processPendingReconnects();
        } catch (error) {
            logger.error("Error in exit node reconnect scheduler", { error });
        }
    }, CHECK_INTERVAL_MS);

    logger.debug("Started exit node reconnect scheduler");
}

async function processPendingReconnects(): Promise<void> {
    // Merge in-memory and Redis-tracked pending reconnects
    const toProcess = new Map(pendingReconnects);

    if (redisManager.isRedisEnabled()) {
        const redisIds = await redisManager.smembers(REDIS_PENDING_SET);
        for (const idStr of redisIds) {
            const id = parseInt(idStr, 10);
            if (!toProcess.has(id)) {
                const startTimeStr = await redisManager.hget(
                    `${REDIS_HASH_PREFIX}${id}`,
                    "startTime"
                );
                const reachableAt = await redisManager.hget(
                    `${REDIS_HASH_PREFIX}${id}`,
                    "reachableAt"
                );
                if (startTimeStr && reachableAt) {
                    toProcess.set(id, {
                        startTime: parseInt(startTimeStr, 10),
                        reachableAt
                    });
                }
            }
        }
    }

    const now = Date.now();

    for (const [exitNodeId, entry] of toProcess) {
        const elapsed = now - entry.startTime;

        // Give up after max duration
        if (elapsed >= MAX_DURATION_MS) {
            logger.warn(
                `Exit node reconnect check timed out for exit node ${exitNodeId} after 5 minutes`
            );
            await removePending(exitNodeId);
            continue;
        }

        // Respect initial delay
        if (elapsed < INITIAL_DELAY_MS) {
            continue;
        }

        // Check if the exit node HTTP endpoint is reachable
        const pingUrl = `${entry.reachableAt}/ping`;
        try {
            await axios.get(pingUrl, { timeout: 5000 });
        } catch {
            logger.debug(
                `Exit node ${exitNodeId} not yet reachable at ${pingUrl}`
            );
            continue;
        }

        // Node is reachable — send reconnect to all connected newts
        logger.info(
            `Exit node ${exitNodeId} is reachable. Sending newt/wg/reconnect to connected newts.`
        );

        await sendReconnectToNewts(exitNodeId);
        await removePending(exitNodeId);
    }
}

async function sendReconnectToNewts(exitNodeId: number): Promise<void> {
    try {
        const connectedNewts = await db
            .select({ newtId: newts.newtId })
            .from(newts)
            .innerJoin(sites, eq(newts.siteId, sites.siteId))
            .where(eq(sites.exitNodeId, exitNodeId));

        if (connectedNewts.length === 0) {
            logger.debug(
                `No newts found for exit node ${exitNodeId}, nothing to reconnect`
            );
            return;
        }

        logger.info(
            `Sending newt/wg/reconnect to ${connectedNewts.length} newt(s) for exit node ${exitNodeId}`
        );

        const reconnectMessage = {
            type: "newt/wg/reconnect",
            data: {}
        };

        await Promise.allSettled(
            connectedNewts.map(({ newtId }) =>
                sendToClient(newtId, reconnectMessage)
            )
        );
    } catch (error) {
        logger.error(
            `Failed to send reconnect messages for exit node ${exitNodeId}`,
            { error }
        );
    }
}

async function removePending(exitNodeId: number): Promise<void> {
    pendingReconnects.delete(exitNodeId);

    if (redisManager.isRedisEnabled()) {
        await redisManager.srem(REDIS_PENDING_SET, exitNodeId.toString());
        await redisManager.del(`${REDIS_HASH_PREFIX}${exitNodeId}`);
    }
}
