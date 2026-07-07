import { randomUUID } from "crypto";

const instanceId = `local-${Math.random().toString(36).slice(2)}-${Date.now()}`;

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
     * Acquire a local in-process lock using an optimistic Map-based check.
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
        for (let attempt = 0; attempt < maxRetries; attempt++) {
            this.clearExpiredLocalLock(lockKey);

            const existing = localLocks.get(lockKey);
            if (!existing) {
                const token = `${instanceId}:${randomUUID()}`;
                localLocks.set(lockKey, {
                    owner: token,
                    expiresAt: Date.now() + ttlMs
                });
                return token;
            }

            // The lock is currently held -- possibly by a different, unrelated
            // caller in this same process. We intentionally do NOT treat
            // same-process holders as automatically reentrant here: two
            // independent logical operations (e.g. two different API requests)
            // running concurrently in the same process must not both believe
            // they hold the lock, or their writes under it can interleave
            // unguarded. Just retry with backoff like any other contended lock.
            if (attempt < maxRetries - 1) {
                const delay = retryDelayMs * Math.pow(2, attempt);
                await new Promise((resolve) => setTimeout(resolve, delay));
            }
        }

        return null;
    }

    /**
     * Release a lock previously acquired via acquireLock/acquireLockWithRetry.
     * @param lockKey - Unique identifier for the lock
     * @param token - the exact token returned by the acquisition being released.
     *   Required so a caller whose TTL already expired can't delete a
     *   different, currently-active holder's lock.
     */
    async releaseLock(lockKey: string, token: string): Promise<void> {
        this.clearExpiredLocalLock(lockKey);
        const existing = localLocks.get(lockKey);

        if (existing && existing.owner === token) {
            localLocks.delete(lockKey);
        }
    }

    /**
     * Force release a lock regardless of owner (use with caution)
     * @param lockKey - Unique identifier for the lock
     */
    async forceReleaseLock(lockKey: string): Promise<void> {
        localLocks.delete(lockKey);
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
        this.clearExpiredLocalLock(lockKey);
        const existing = localLocks.get(lockKey);

        if (!existing || existing.owner !== token) {
            return false;
        }

        existing.expiresAt = Date.now() + ttlMs;
        localLocks.set(lockKey, existing);
        return true;
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
                const delay =
                    baseDelayMs * Math.pow(2, attempt) + Math.random() * 100;
                await new Promise((resolve) => setTimeout(resolve, delay));
            }
        }

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

    /**
     * Close the Redis connection
     */
    async disconnect(): Promise<void> {}
}

export const lockManager = new LockManager();
