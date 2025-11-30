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

import { config } from "@server/lib/config";
import logger from "@server/logger";
import { redis } from "#private/lib/redis";

export class LockManager {
    /**
     * Acquire a distributed lock using Redis SET with NX and PX options
     * @param lockKey - Unique identifier for the lock
     * @param ttlMs - Time to live in milliseconds
     * @returns Promise<boolean> - true if lock acquired, false otherwise
     */
    async acquireLock(
        lockKey: string,
        ttlMs: number = 30000
    ): Promise<boolean> {
        if (!redis || !redis.status || redis.status !== "ready") {
            return true;
        }

        const lockValue = `${
            config.getRawConfig().gerbil.exit_node_name
        }:${Date.now()}`;
        const redisKey = `lock:${lockKey}`;

        try {
            // Use SET with NX (only set if not exists) and PX (expire in milliseconds)
            // This is atomic and handles both setting and expiration
            const result = await redis.set(
                redisKey,
                lockValue,
                "PX",
                ttlMs,
                "NX"
            );

            if (result === "OK") {
                logger.debug(
                    `Lock acquired: ${lockKey} by ${
                        config.getRawConfig().gerbil.exit_node_name
                    }`
                );
                return true;
            }

            // Check if the existing lock is from this worker (reentrant behavior)
            const existingValue = await redis.get(redisKey);
            if (
                existingValue &&
                existingValue.startsWith(
                    `${config.getRawConfig().gerbil.exit_node_name}:`
                )
            ) {
                // Extend the lock TTL since it's the same worker
                await redis.pexpire(redisKey, ttlMs);
                logger.debug(
                    `Lock extended: ${lockKey} by ${
                        config.getRawConfig().gerbil.exit_node_name
                    }`
                );
                return true;
            }

            return false;
        } catch (error) {
            logger.error(`Failed to acquire lock ${lockKey}:`, error);
            return false;
        }
    }

    /**
     * Release a lock using Lua script to ensure atomicity
     * @param lockKey - Unique identifier for the lock
     */
    async releaseLock(lockKey: string): Promise<void> {
        if (!redis || !redis.status || redis.status !== "ready") {
            return;
        }

        const redisKey = `lock:${lockKey}`;

        // Lua script to ensure we only delete the lock if it belongs to this worker
        const luaScript = `
      local key = KEYS[1]
      local worker_prefix = ARGV[1]
      local current_value = redis.call('GET', key)
      
      if current_value and string.find(current_value, worker_prefix, 1, true) == 1 then
        return redis.call('DEL', key)
      else
        return 0
      end
    `;

        try {
            const result = (await redis.eval(
                luaScript,
                1,
                redisKey,
                `${config.getRawConfig().gerbil.exit_node_name}:`
            )) as number;

            if (result === 1) {
                logger.debug(
                    `Lock released: ${lockKey} by ${
                        config.getRawConfig().gerbil.exit_node_name
                    }`
                );
            } else {
                logger.warn(
                    `Lock not released - not owned by worker: ${lockKey} by ${
                        config.getRawConfig().gerbil.exit_node_name
                    }`
                );
            }
        } catch (error) {
            logger.error(`Failed to release lock ${lockKey}:`, error);
        }
    }

    /**
     * Force release a lock regardless of owner (use with caution)
     * @param lockKey - Unique identifier for the lock
     */
    async forceReleaseLock(lockKey: string): Promise<void> {
        if (!redis || !redis.status || redis.status !== "ready") {
            return;
        }

        const redisKey = `lock:${lockKey}`;

        try {
            const result = await redis.del(redisKey);
            if (result === 1) {
                logger.debug(`Lock force released: ${lockKey}`);
            }
        } catch (error) {
            logger.error(`Failed to force release lock ${lockKey}:`, error);
        }
    }

    /**
     * Check if a lock exists and get its info
     * @param lockKey - Unique identifier for the lock
     * @returns Promise<{exists: boolean, ownedByMe: boolean, ttl: number}>
     */
    async getLockInfo(lockKey: string): Promise<{
        exists: boolean;
        ownedByMe: boolean;
        ttl: number;
        owner?: string;
    }> {
        if (!redis || !redis.status || redis.status !== "ready") {
            return { exists: false, ownedByMe: true, ttl: 0 };
        }

        const redisKey = `lock:${lockKey}`;

        try {
            const [value, ttl] = await Promise.all([
                redis.get(redisKey),
                redis.pttl(redisKey)
            ]);

            const exists = value !== null;
            const ownedByMe =
                exists &&
                value!.startsWith(`${config.getRawConfig().gerbil.exit_node_name}:`);
            const owner = exists ? value!.split(":")[0] : undefined;

            return {
                exists,
                ownedByMe,
                ttl: ttl > 0 ? ttl : 0,
                owner
            };
        } catch (error) {
            logger.error(`Failed to get lock info ${lockKey}:`, error);
            return { exists: false, ownedByMe: false, ttl: 0 };
        }
    }

    /**
     * Extend the TTL of an existing lock owned by this worker
     * @param lockKey - Unique identifier for the lock
     * @param ttlMs - New TTL in milliseconds
     * @returns Promise<boolean> - true if extended successfully
     */
    async extendLock(lockKey: string, ttlMs: number): Promise<boolean> {
        if (!redis || !redis.status || redis.status !== "ready") {
            return true;
        }

        const redisKey = `lock:${lockKey}`;

        // Lua script to extend TTL only if lock is owned by this worker
        const luaScript = `
      local key = KEYS[1]
      local worker_prefix = ARGV[1]
      local ttl = tonumber(ARGV[2])
      local current_value = redis.call('GET', key)
      
      if current_value and string.find(current_value, worker_prefix, 1, true) == 1 then
        return redis.call('PEXPIRE', key, ttl)
      else
        return 0
      end
    `;

        try {
            const result = (await redis.eval(
                luaScript,
                1,
                redisKey,
                `${config.getRawConfig().gerbil.exit_node_name}:`,
                ttlMs.toString()
            )) as number;

            if (result === 1) {
                logger.debug(
                    `Lock extended: ${lockKey} by ${
                        config.getRawConfig().gerbil.exit_node_name
                    } for ${ttlMs}ms`
                );
                return true;
            }
            return false;
        } catch (error) {
            logger.error(`Failed to extend lock ${lockKey}:`, error);
            return false;
        }
    }

    /**
     * Attempt to acquire lock with retries and exponential backoff
     * @param lockKey - Unique identifier for the lock
     * @param ttlMs - Time to live in milliseconds
     * @param maxRetries - Maximum number of retry attempts
     * @param baseDelayMs - Base delay between retries in milliseconds
     * @returns Promise<boolean> - true if lock acquired
     */
    async acquireLockWithRetry(
        lockKey: string,
        ttlMs: number = 30000,
        maxRetries: number = 5,
        baseDelayMs: number = 100
    ): Promise<boolean> {
        if (!redis || !redis.status || redis.status !== "ready") {
            return true;
        }

        for (let attempt = 0; attempt <= maxRetries; attempt++) {
            const acquired = await this.acquireLock(lockKey, ttlMs);

            if (acquired) {
                return true;
            }

            if (attempt < maxRetries) {
                // Exponential backoff with jitter
                const delay =
                    baseDelayMs * Math.pow(2, attempt) + Math.random() * 100;
                await new Promise((resolve) => setTimeout(resolve, delay));
            }
        }

        logger.warn(
            `Failed to acquire lock ${lockKey} after ${maxRetries + 1} attempts`
        );
        return false;
    }

    /**
     * Execute a function while holding a lock
     * @param lockKey - Unique identifier for the lock
     * @param fn - Function to execute while holding the lock
     * @param ttlMs - Lock TTL in milliseconds
     * @returns Promise<T> - Result of the executed function
     */
    async withLock<T>(
        lockKey: string,
        fn: () => Promise<T>,
        ttlMs: number = 30000
    ): Promise<T> {
        if (!redis || !redis.status || redis.status !== "ready") {
            return await fn();
        }

        const acquired = await this.acquireLock(lockKey, ttlMs);

        if (!acquired) {
            throw new Error(`Failed to acquire lock: ${lockKey}`);
        }

        try {
            return await fn();
        } finally {
            await this.releaseLock(lockKey);
        }
    }

    /**
     * Clean up expired locks - Redis handles this automatically, but this method
     * can be used to get statistics about locks
     * @returns Promise<{activeLocksCount: number, locksOwnedByMe: number}>
     */
    async getLockStatistics(): Promise<{
        activeLocksCount: number;
        locksOwnedByMe: number;
    }> {
        if (!redis || !redis.status || redis.status !== "ready") {
            return { activeLocksCount: 0, locksOwnedByMe: 0 };
        }

        try {
            const keys = await redis.keys("lock:*");
            let locksOwnedByMe = 0;

            if (keys.length > 0) {
                const values = await redis.mget(...keys);
                locksOwnedByMe = values.filter(
                    (value) =>
                        value &&
                        value.startsWith(
                            `${config.getRawConfig().gerbil.exit_node_name}:`
                        )
                ).length;
            }

            return {
                activeLocksCount: keys.length,
                locksOwnedByMe
            };
        } catch (error) {
            logger.error("Failed to get lock statistics:", error);
            return { activeLocksCount: 0, locksOwnedByMe: 0 };
        }
    }

    /**
     * Close the Redis connection
     */
    async disconnect(): Promise<void> {
        if (!redis || !redis.status || redis.status !== "ready") {
            return;
        }
        await redis.quit();
    }
}

export const lockManager = new LockManager();
