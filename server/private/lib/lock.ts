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

import logger from "@server/logger";
import { redis } from "#private/lib/redis";
import { v4 as uuidv4 } from "uuid";

const instanceId = uuidv4();

type LocalLockRecord = {
    owner: string;
    expiresAt: number;
};

const localLocks = new Map<string, LocalLockRecord>();

export class LockManager {
    private clearExpiredLocalLock(lockKey: string): void {
        const current = localLocks.get(lockKey);
        if (current && current.expiresAt <= Date.now()) {
            localLocks.delete(lockKey);
        }
    }

    /**
     * Acquire a distributed lock using Redis SET with NX and PX options
     * @param lockKey - Unique identifier for the lock
     * @param ttlMs - Time to live in milliseconds
     * @returns Promise<string | null> - a token identifying this specific acquisition
     *          (truthy) on success, or null if the lock could not be acquired.
     */
    async acquireLock(
        lockKey: string,
        ttlMs: number = 30000,
        maxRetries: number = 3,
        retryDelayMs: number = 100
    ): Promise<string | null> {
        if (!redis || !redis.status || redis.status !== "ready") {
            for (let attempt = 0; attempt < maxRetries; attempt++) {
                this.clearExpiredLocalLock(lockKey);

                const existing = localLocks.get(lockKey);
                if (!existing) {
                    const token = `${instanceId}:${uuidv4()}`;
                    localLocks.set(lockKey, {
                        owner: token,
                        expiresAt: Date.now() + ttlMs
                    });
                    return token;
                }

                // Do not treat a same-process holder as automatically
                // reentrant -- see the note in the Redis branch below.
                if (attempt < maxRetries - 1) {
                    const delay = retryDelayMs * Math.pow(2, attempt);
                    await new Promise((resolve) => setTimeout(resolve, delay));
                }
            }

            return null;
        }

        const redisKey = `lock:${lockKey}`;

        for (let attempt = 0; attempt < maxRetries; attempt++) {
            try {
                // Every acquisition attempt gets its own unique token, even
                // within the same process. Two independent logical operations
                // (e.g. two different API requests handled by the same server)
                // racing for this key must never both believe they hold the
                // lock -- if we treated "existing value starts with my
                // instanceId" as reentrant success, a second unrelated caller
                // on this process could barge in while the first is still
                // mid-flight, and their writes under the lock would interleave
                // unguarded.
                const lockValue = `${instanceId}:${uuidv4()}`;

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
                    logger.debug(`Lock acquired: ${lockKey} by ${instanceId}`);
                    return lockValue;
                }

                // If this isn't our last attempt, wait before retrying with exponential backoff
                if (attempt < maxRetries - 1) {
                    const delay = retryDelayMs * Math.pow(2, attempt);
                    logger.debug(
                        `Lock ${lockKey} not available, retrying in ${delay}ms (attempt ${attempt + 1}/${maxRetries})`
                    );
                    await new Promise((resolve) => setTimeout(resolve, delay));
                }
            } catch (error) {
                logger.error(
                    `Failed to acquire lock ${lockKey} (attempt ${attempt + 1}/${maxRetries}):`,
                    error
                );
                // On error, still retry if we have attempts left
                if (attempt < maxRetries - 1) {
                    const delay = retryDelayMs * Math.pow(2, attempt);
                    await new Promise((resolve) => setTimeout(resolve, delay));
                }
            }
        }

        logger.debug(
            `Failed to acquire lock ${lockKey} after ${maxRetries} attempts`
        );
        return null;
    }

    /**
     * Release a lock previously acquired via acquireLock/acquireLockWithRetry,
     * using a Lua script to ensure we only delete it if it still matches the
     * exact token from that acquisition (not just "owned by this process") --
     * this ensures a caller whose TTL already expired can't delete a
     * different, currently-active holder's lock.
     * @param lockKey - Unique identifier for the lock
     * @param token - the exact token returned by the acquisition being released
     */
    async releaseLock(lockKey: string, token: string): Promise<void> {
        if (!redis || !redis.status || redis.status !== "ready") {
            this.clearExpiredLocalLock(lockKey);
            const existing = localLocks.get(lockKey);
            if (existing && existing.owner === token) {
                localLocks.delete(lockKey);
            }
            return;
        }

        const redisKey = `lock:${lockKey}`;

        const luaScript = `
      local key = KEYS[1]
      local expected_value = ARGV[1]
      local current_value = redis.call('GET', key)

      if current_value and current_value == expected_value then
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
                token
            )) as number;

            if (result === 1) {
                logger.debug(`Lock released: ${lockKey} by ${instanceId}`);
            } else {
                logger.warn(
                    `Lock not released - token did not match current holder: ${lockKey} (attempted by ${instanceId})`
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
            localLocks.delete(lockKey);
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
            this.clearExpiredLocalLock(lockKey);
            const existing = localLocks.get(lockKey);

            if (!existing) {
                return { exists: false, ownedByMe: false, ttl: 0 };
            }

            const ttl = Math.max(0, existing.expiresAt - Date.now());
            return {
                exists: true,
                ownedByMe: existing.owner.startsWith(`${instanceId}:`),
                ttl,
                owner: existing.owner.split(":")[0]
            };
        }

        const redisKey = `lock:${lockKey}`;

        try {
            const [value, ttl] = await Promise.all([
                redis.get(redisKey),
                redis.pttl(redisKey)
            ]);

            const exists = value !== null;
            const ownedByMe = exists && value!.startsWith(`${instanceId}:`);
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
     * Extend the TTL of an existing lock, provided the token matches the
     * acquisition currently holding it.
     * @param lockKey - Unique identifier for the lock
     * @param ttlMs - New TTL in milliseconds
     * @param token - the token returned by the acquisition being extended
     * @returns Promise<boolean> - true if extended successfully
     */
    async extendLock(
        lockKey: string,
        ttlMs: number,
        token: string
    ): Promise<boolean> {
        if (!redis || !redis.status || redis.status !== "ready") {
            this.clearExpiredLocalLock(lockKey);
            const existing = localLocks.get(lockKey);

            if (!existing || existing.owner !== token) {
                return false;
            }

            existing.expiresAt = Date.now() + ttlMs;
            localLocks.set(lockKey, existing);
            return true;
        }

        const redisKey = `lock:${lockKey}`;

        const luaScript = `
      local key = KEYS[1]
      local expected_value = ARGV[1]
      local ttl = tonumber(ARGV[2])
      local current_value = redis.call('GET', key)

      if current_value and current_value == expected_value then
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
                token,
                ttlMs.toString()
            )) as number;

            if (result === 1) {
                logger.debug(
                    `Lock extended: ${lockKey} by ${instanceId} for ${ttlMs}ms`
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
     * @returns Promise<string | null> - token if acquired, null otherwise
     */
    async acquireLockWithRetry(
        lockKey: string,
        ttlMs: number = 30000,
        maxRetries: number = 5,
        baseDelayMs: number = 100
    ): Promise<string | null> {
        for (let attempt = 0; attempt <= maxRetries; attempt++) {
            const acquired = await this.acquireLock(
                lockKey,
                ttlMs,
                1,
                baseDelayMs
            );

            if (acquired) {
                return acquired;
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
        return null;
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
        const token = await this.acquireLock(lockKey, ttlMs);

        if (!token) {
            throw new Error(`Failed to acquire lock: ${lockKey}`);
        }

        try {
            return await fn();
        } finally {
            await this.releaseLock(lockKey, token);
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
            const now = Date.now();
            for (const [key, value] of localLocks.entries()) {
                if (value.expiresAt <= now) {
                    localLocks.delete(key);
                }
            }

            let locksOwnedByMe = 0;
            for (const value of localLocks.values()) {
                if (value.owner.startsWith(`${instanceId}:`)) {
                    locksOwnedByMe++;
                }
            }

            return { activeLocksCount: localLocks.size, locksOwnedByMe };
        }

        try {
            const keys = await redis.keys("lock:*");
            let locksOwnedByMe = 0;

            if (keys.length > 0) {
                const values = await redis.mget(...keys);
                locksOwnedByMe = values.filter(
                    (value) => value && value.startsWith(`${instanceId}:`)
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
