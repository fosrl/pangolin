/*
 * This file is part of a proprietary work.
 *
 * Copyright (c) 2025 Fossorial, Inc.
 * All rights reserved.
 *
 * This file is licensed under the Fossorial Commercial License.
 * You may not use this file except in compliance with the License.
 * Unauthorized use, copying, modification, or distribution is strictly prohibited.
 *
 * This file is not licensed under the AGPLv3.
 */

import logger from "@server/logger";
import redisManager from "#private/lib/redis";
import { build } from "@server/build";

// Rate limiting configuration
export const RATE_LIMIT_WINDOW = 60; // 1 minute in seconds
export const RATE_LIMIT_MAX_REQUESTS = 100;
export const RATE_LIMIT_PER_MESSAGE_TYPE = 20; // Per message type limit within the window

// Configuration for batched Redis sync
export const REDIS_SYNC_THRESHOLD = 15; // Sync to Redis every N messages
export const REDIS_SYNC_FORCE_INTERVAL = 30000; // Force sync every 30 seconds as backup

interface RateLimitTracker {
    count: number;
    windowStart: number;
    pendingCount: number;
    lastSyncedCount: number;
}

interface RateLimitResult {
    isLimited: boolean;
    reason?: string;
    totalHits?: number;
    resetTime?: Date;
}

export class RateLimitService {
    private localRateLimitTracker: Map<string, RateLimitTracker> = new Map();
    private localMessageTypeRateLimitTracker: Map<string, RateLimitTracker> = new Map();
    private cleanupInterval: NodeJS.Timeout | null = null;
    private forceSyncInterval: NodeJS.Timeout | null = null;

    constructor() {
        if (build == "oss") {
            return;
        }

        // Start cleanup and sync intervals
        this.cleanupInterval = setInterval(() => {
            this.cleanupLocalRateLimit().catch((error) => {
                logger.error("Error during rate limit cleanup:", error);
            });
        }, 60000); // Run cleanup every minute

        this.forceSyncInterval = setInterval(() => {
            this.forceSyncAllPendingData().catch((error) => {
                logger.error("Error during force sync:", error);
            });
        }, REDIS_SYNC_FORCE_INTERVAL);
    }

    // Redis keys
    private getRateLimitKey(clientId: string): string {
        return `ratelimit:${clientId}`;
    }

    private getMessageTypeRateLimitKey(clientId: string, messageType: string): string {
        return `ratelimit:${clientId}:${messageType}`;
    }

    // Helper function to clean up old timestamp fields from a Redis hash
    private async cleanupOldTimestamps(key: string, windowStart: number): Promise<void> {
        if (!redisManager.isRedisEnabled()) return;

        try {
            const client = redisManager.getClient();
            if (!client) return;

            // Get all fields in the hash
            const allData = await redisManager.hgetall(key);
            if (!allData || Object.keys(allData).length === 0) return;

            // Find fields that are older than the window
            const fieldsToDelete: string[] = [];
            for (const timestamp of Object.keys(allData)) {
                const time = parseInt(timestamp);
                if (time < windowStart) {
                    fieldsToDelete.push(timestamp);
                }
            }

            // Delete old fields in batches to avoid call stack size exceeded errors
            // The spread operator can cause issues with very large arrays
            if (fieldsToDelete.length > 0) {
                const batchSize = 1000; // Process 1000 fields at a time
                for (let i = 0; i < fieldsToDelete.length; i += batchSize) {
                    const batch = fieldsToDelete.slice(i, i + batchSize);
                    await client.hdel(key, ...batch);
                }
                logger.debug(`Cleaned up ${fieldsToDelete.length} old timestamp fields from ${key}`);
            }
        } catch (error) {
            logger.error(`Failed to cleanup old timestamps for key ${key}:`, error);
            // Don't throw - cleanup failures shouldn't block rate limiting
        }
    }

    // Helper function to sync local rate limit data to Redis
    private async syncRateLimitToRedis(
        clientId: string,
        tracker: RateLimitTracker
    ): Promise<void> {
        if (!redisManager.isRedisEnabled() || tracker.pendingCount === 0) return;

        try {
            const currentTime = Math.floor(Date.now() / 1000);
            const windowStart = currentTime - RATE_LIMIT_WINDOW;
            const globalKey = this.getRateLimitKey(clientId);

            // Clean up old timestamp fields before writing
            await this.cleanupOldTimestamps(globalKey, windowStart);

            // Get current value and add pending count
            const currentValue = await redisManager.hget(
                globalKey,
                currentTime.toString()
            );
            const newValue = (
                parseInt(currentValue || "0") + tracker.pendingCount
            ).toString();
            await redisManager.hset(globalKey, currentTime.toString(), newValue);

            // Set TTL using the client directly - this prevents the key from persisting forever
            if (redisManager.getClient()) {
                await redisManager
                    .getClient()
                    .expire(globalKey, RATE_LIMIT_WINDOW + 10);
            }

            // Update tracking
            tracker.lastSyncedCount = tracker.count;
            tracker.pendingCount = 0;

            logger.debug(`Synced global rate limit to Redis for client ${clientId}`);
        } catch (error) {
            logger.error("Failed to sync global rate limit to Redis:", error);
        }
    }

    private async syncMessageTypeRateLimitToRedis(
        clientId: string,
        messageType: string,
        tracker: RateLimitTracker
    ): Promise<void> {
        if (!redisManager.isRedisEnabled() || tracker.pendingCount === 0) return;

        try {
            const currentTime = Math.floor(Date.now() / 1000);
            const windowStart = currentTime - RATE_LIMIT_WINDOW;
            const messageTypeKey = this.getMessageTypeRateLimitKey(clientId, messageType);

            // Clean up old timestamp fields before writing
            await this.cleanupOldTimestamps(messageTypeKey, windowStart);

            // Get current value and add pending count
            const currentValue = await redisManager.hget(
                messageTypeKey,
                currentTime.toString()
            );
            const newValue = (
                parseInt(currentValue || "0") + tracker.pendingCount
            ).toString();
            await redisManager.hset(
                messageTypeKey,
                currentTime.toString(),
                newValue
            );

            // Set TTL using the client directly - this prevents the key from persisting forever
            if (redisManager.getClient()) {
                await redisManager
                    .getClient()
                    .expire(messageTypeKey, RATE_LIMIT_WINDOW + 10);
            }

            // Update tracking
            tracker.lastSyncedCount = tracker.count;
            tracker.pendingCount = 0;

            logger.debug(
                `Synced message type rate limit to Redis for client ${clientId}, type ${messageType}`
            );
        } catch (error) {
            logger.error("Failed to sync message type rate limit to Redis:", error);
        }
    }

    // Initialize local tracker from Redis data
    private async initializeLocalTracker(clientId: string): Promise<RateLimitTracker> {
        const currentTime = Math.floor(Date.now() / 1000);
        const windowStart = currentTime - RATE_LIMIT_WINDOW;

        if (!redisManager.isRedisEnabled()) {
            return {
                count: 0,
                windowStart: currentTime,
                pendingCount: 0,
                lastSyncedCount: 0
            };
        }

        try {
            const globalKey = this.getRateLimitKey(clientId);
            
            // Clean up old timestamp fields before reading
            await this.cleanupOldTimestamps(globalKey, windowStart);
            
            const globalRateLimitData = await redisManager.hgetall(globalKey);

            let count = 0;
            for (const [timestamp, countStr] of Object.entries(globalRateLimitData)) {
                const time = parseInt(timestamp);
                if (time >= windowStart) {
                    count += parseInt(countStr);
                }
            }

            return {
                count,
                windowStart: currentTime,
                pendingCount: 0,
                lastSyncedCount: count
            };
        } catch (error) {
            logger.error("Failed to initialize global tracker from Redis:", error);
            return {
                count: 0,
                windowStart: currentTime,
                pendingCount: 0,
                lastSyncedCount: 0
            };
        }
    }

    private async initializeMessageTypeTracker(
        clientId: string,
        messageType: string
    ): Promise<RateLimitTracker> {
        const currentTime = Math.floor(Date.now() / 1000);
        const windowStart = currentTime - RATE_LIMIT_WINDOW;

        if (!redisManager.isRedisEnabled()) {
            return {
                count: 0,
                windowStart: currentTime,
                pendingCount: 0,
                lastSyncedCount: 0
            };
        }

        try {
            const messageTypeKey = this.getMessageTypeRateLimitKey(clientId, messageType);
            
            // Clean up old timestamp fields before reading
            await this.cleanupOldTimestamps(messageTypeKey, windowStart);
            
            const messageTypeRateLimitData = await redisManager.hgetall(messageTypeKey);

            let count = 0;
            for (const [timestamp, countStr] of Object.entries(messageTypeRateLimitData)) {
                const time = parseInt(timestamp);
                if (time >= windowStart) {
                    count += parseInt(countStr);
                }
            }

            return {
                count,
                windowStart: currentTime,
                pendingCount: 0,
                lastSyncedCount: count
            };
        } catch (error) {
            logger.error("Failed to initialize message type tracker from Redis:", error);
            return {
                count: 0,
                windowStart: currentTime,
                pendingCount: 0,
                lastSyncedCount: 0
            };
        }
    }

    // Main rate limiting function
    async checkRateLimit(
        clientId: string,
        messageType?: string,
        maxRequests: number = RATE_LIMIT_MAX_REQUESTS,
        messageTypeLimit: number = RATE_LIMIT_PER_MESSAGE_TYPE,
        windowMs: number = RATE_LIMIT_WINDOW * 1000
    ): Promise<RateLimitResult> {
        const currentTime = Math.floor(Date.now() / 1000);
        const windowStart = currentTime - Math.floor(windowMs / 1000);

        // Check global rate limit
        let globalTracker = this.localRateLimitTracker.get(clientId);

        if (!globalTracker || globalTracker.windowStart < windowStart) {
            // New window or first request - initialize from Redis if available
            globalTracker = await this.initializeLocalTracker(clientId);
            globalTracker.windowStart = currentTime;
            this.localRateLimitTracker.set(clientId, globalTracker);
        }

        // Increment global counters
        globalTracker.count++;
        globalTracker.pendingCount++;
        this.localRateLimitTracker.set(clientId, globalTracker);

        // Check if global limit would be exceeded
        if (globalTracker.count >= maxRequests) {
            return {
                isLimited: true,
                reason: "global",
                totalHits: globalTracker.count,
                resetTime: new Date((globalTracker.windowStart + Math.floor(windowMs / 1000)) * 1000)
            };
        }

        // Sync to Redis if threshold reached
        if (globalTracker.pendingCount >= REDIS_SYNC_THRESHOLD) {
            this.syncRateLimitToRedis(clientId, globalTracker);
        }

        // Check message type specific rate limit if messageType is provided
        if (messageType) {
            const messageTypeKey = `${clientId}:${messageType}`;
            let messageTypeTracker = this.localMessageTypeRateLimitTracker.get(messageTypeKey);

            if (!messageTypeTracker || messageTypeTracker.windowStart < windowStart) {
                // New window or first request for this message type - initialize from Redis if available
                messageTypeTracker = await this.initializeMessageTypeTracker(clientId, messageType);
                messageTypeTracker.windowStart = currentTime;
                this.localMessageTypeRateLimitTracker.set(messageTypeKey, messageTypeTracker);
            }

            // Increment message type counters
            messageTypeTracker.count++;
            messageTypeTracker.pendingCount++;
            this.localMessageTypeRateLimitTracker.set(messageTypeKey, messageTypeTracker);

            // Check if message type limit would be exceeded
            if (messageTypeTracker.count >= messageTypeLimit) {
                return {
                    isLimited: true,
                    reason: `message_type:${messageType}`,
                    totalHits: messageTypeTracker.count,
                    resetTime: new Date((messageTypeTracker.windowStart + Math.floor(windowMs / 1000)) * 1000)
                };
            }

            // Sync to Redis if threshold reached
            if (messageTypeTracker.pendingCount >= REDIS_SYNC_THRESHOLD) {
                this.syncMessageTypeRateLimitToRedis(clientId, messageType, messageTypeTracker);
            }
        }

        return {
            isLimited: false,
            totalHits: globalTracker.count,
            resetTime: new Date((globalTracker.windowStart + Math.floor(windowMs / 1000)) * 1000)
        };
    }

    // Decrement function for skipSuccessfulRequests/skipFailedRequests functionality
    async decrementRateLimit(clientId: string, messageType?: string): Promise<void> {
        // Decrement global counter
        const globalTracker = this.localRateLimitTracker.get(clientId);
        if (globalTracker && globalTracker.count > 0) {
            globalTracker.count--;
            // We need to account for this in pending count to sync correctly
            globalTracker.pendingCount--;
        }

        // Decrement message type counter if provided
        if (messageType) {
            const messageTypeKey = `${clientId}:${messageType}`;
            const messageTypeTracker = this.localMessageTypeRateLimitTracker.get(messageTypeKey);
            if (messageTypeTracker && messageTypeTracker.count > 0) {
                messageTypeTracker.count--;
                messageTypeTracker.pendingCount--;
            }
        }
    }

    // Reset key function
    async resetKey(clientId: string): Promise<void> {
        // Remove from local tracking
        this.localRateLimitTracker.delete(clientId);
        
        // Remove all message type entries for this client
        for (const [key] of this.localMessageTypeRateLimitTracker) {
            if (key.startsWith(`${clientId}:`)) {
                this.localMessageTypeRateLimitTracker.delete(key);
            }
        }

        // Remove from Redis if enabled
        if (redisManager.isRedisEnabled()) {
            const globalKey = this.getRateLimitKey(clientId);
            await redisManager.del(globalKey);

            // Get all message type keys for this client and delete them
            const client = redisManager.getClient();
            if (client) {
                const messageTypeKeys = await client.keys(`ratelimit:${clientId}:*`);
                if (messageTypeKeys.length > 0) {
                    await Promise.all(messageTypeKeys.map(key => redisManager.del(key)));
                }
            }
        }
    }

    // Cleanup old local rate limit entries and force sync pending data
    private async cleanupLocalRateLimit(): Promise<void> {
        const currentTime = Math.floor(Date.now() / 1000);
        const windowStart = currentTime - RATE_LIMIT_WINDOW;

        // Clean up global rate limit tracking and sync pending data
        for (const [clientId, tracker] of this.localRateLimitTracker.entries()) {
            if (tracker.windowStart < windowStart) {
                // Sync any pending data before cleanup
                if (tracker.pendingCount > 0) {
                    await this.syncRateLimitToRedis(clientId, tracker);
                }
                this.localRateLimitTracker.delete(clientId);
            }
        }

        // Clean up message type rate limit tracking and sync pending data
        for (const [key, tracker] of this.localMessageTypeRateLimitTracker.entries()) {
            if (tracker.windowStart < windowStart) {
                // Sync any pending data before cleanup
                if (tracker.pendingCount > 0) {
                    const [clientId, messageType] = key.split(":", 2);
                    await this.syncMessageTypeRateLimitToRedis(clientId, messageType, tracker);
                }
                this.localMessageTypeRateLimitTracker.delete(key);
            }
        }
    }

    // Force sync all pending rate limit data to Redis
    async forceSyncAllPendingData(): Promise<void> {
        if (!redisManager.isRedisEnabled()) return;

        logger.debug("Force syncing all pending rate limit data to Redis...");

        // Sync all pending global rate limits
        for (const [clientId, tracker] of this.localRateLimitTracker.entries()) {
            if (tracker.pendingCount > 0) {
                await this.syncRateLimitToRedis(clientId, tracker);
            }
        }

        // Sync all pending message type rate limits
        for (const [key, tracker] of this.localMessageTypeRateLimitTracker.entries()) {
            if (tracker.pendingCount > 0) {
                const [clientId, messageType] = key.split(":", 2);
                await this.syncMessageTypeRateLimitToRedis(clientId, messageType, tracker);
            }
        }

        logger.debug("Completed force sync of pending rate limit data");
    }

    // Cleanup function for graceful shutdown
    async cleanup(): Promise<void> {
        if (build == "oss") {
            return;
        }

        // Clear intervals
        if (this.cleanupInterval) {
            clearInterval(this.cleanupInterval);
        }
        if (this.forceSyncInterval) {
            clearInterval(this.forceSyncInterval);
        }

        // Force sync all pending data
        await this.forceSyncAllPendingData();

        // Clear local data
        this.localRateLimitTracker.clear();
        this.localMessageTypeRateLimitTracker.clear();

        logger.info("Rate limit service cleanup completed");
    }
}

// Export singleton instance
export const rateLimitService = new RateLimitService();