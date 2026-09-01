import NodeCache from "node-cache";
import logger from "@server/logger";

// Create local cache with maxKeys limit to prevent memory leaks
// With ~10k requests/day and 5min TTL, 10k keys should be more than sufficient
export const localCache = new NodeCache({
    stdTTL: 3600,
    checkperiod: 120,
    maxKeys: 10000
});

// Log cache statistics periodically for monitoring
// setInterval(() => {
//     const stats = localCache.getStats();
//     logger.debug(
//         `Local cache stats - Keys: ${stats.keys}, Hits: ${stats.hits}, Misses: ${stats.misses}, Hit rate: ${stats.hits > 0 ? ((stats.hits / (stats.hits + stats.misses)) * 100).toFixed(2) : 0}%`
//     );
// }, 300000); // Every 5 minutes

/**
 * Adaptive cache that uses Redis when available in multi-node environments,
 * otherwise falls back to local memory cache for single-node deployments.
 */
class AdaptiveCache {
    /**
     * Set a value in the cache
     * @param key - Cache key
     * @param value - Value to cache (will be JSON stringified for Redis)
     * @param ttl - Time to live in seconds (0 = no expiration)
     * @returns boolean indicating success
     */
    async set(key: string, value: any, ttl?: number): Promise<boolean> {
        const effectiveTtl = ttl === 0 ? undefined : ttl;

        // Use local cache as fallback or primary
        const success = localCache.set(key, value, effectiveTtl || 0);
        // if (success) {
        //     logger.debug(`Set key in local cache: ${key}`);
        // }
        return success;
    }

    /**
     * Get a value from the cache
     * @param key - Cache key
     * @returns The cached value or undefined if not found
     */
    async get<T = any>(key: string): Promise<T | undefined> {
        // Use local cache as fallback or primary
        const value = localCache.get<T>(key);
        // if (value !== undefined) {
        //     logger.debug(`Cache hit in local cache: ${key}`);
        // } else {
        //     logger.debug(`Cache miss in local cache: ${key}`);
        // }
        return value;
    }

    /**
     * Delete a value from the cache
     * @param key - Cache key or array of keys
     * @returns Number of deleted entries
     */
    async del(key: string | string[]): Promise<number> {
        const keys = Array.isArray(key) ? key : [key];
        let deletedCount = 0;

        // Use local cache as fallback or primary
        for (const k of keys) {
            const success = localCache.del(k);
            if (success > 0) {
                deletedCount++;
                logger.debug(`Deleted key from local cache: ${k}`);
            }
        }

        return deletedCount;
    }

    /**
     * Check if a key exists in the cache
     * @param key - Cache key
     * @returns boolean indicating if key exists
     */
    async has(key: string): Promise<boolean> {
        // Use local cache as fallback or primary
        return localCache.has(key);
    }

    /**
     * Get multiple values from the cache
     * @param keys - Array of cache keys
     * @returns Array of values (undefined for missing keys)
     */
    async mget<T = any>(keys: string[]): Promise<(T | undefined)[]> {
        // Use local cache as fallback or primary
        return keys.map((key) => localCache.get<T>(key));
    }

    /**
     * Flush all keys from the cache
     */
    async flushAll(): Promise<void> {
        localCache.flushAll();
        logger.debug("Flushed local cache");
    }

    /**
     * Get cache statistics
     * Note: Only returns local cache stats, Redis stats are not included
     */
    getStats() {
        return localCache.getStats();
    }

    /**
     * Get the current cache backend being used
     * @returns "redis" if Redis is available and healthy, "local" otherwise
     */
    getCurrentBackend(): "redis" | "local" {
        return "local";
    }

    /**
     * Take a key from the cache and delete it
     * @param key - Cache key
     * @returns The value or undefined if not found
     */
    async take<T = any>(key: string): Promise<T | undefined> {
        const value = await this.get<T>(key);
        if (value !== undefined) {
            await this.del(key);
        }
        return value;
    }

    /**
     * Get TTL (time to live) for a key
     * @param key - Cache key
     * @returns TTL in seconds, 0 if no expiration, -1 if key doesn't exist
     */
    getTtl(key: string): number {
        const ttl = localCache.getTtl(key);
        if (ttl === undefined) {
            return -1;
        }
        return Math.max(0, Math.floor((ttl - Date.now()) / 1000));
    }

    /**
     * Get all keys from the cache
     * Note: Only returns local cache keys, Redis keys are not included
     */
    keys(): string[] {
        return localCache.keys();
    }

    /**
     * Get keys with a specific prefix
     * @param prefix - Key prefix to match
     * @returns Array of matching keys
     */
    async keysWithPrefix(prefix: string): Promise<string[]> {
        const allKeys = localCache.keys();
        return allKeys.filter((key) => key.startsWith(prefix));
    }
}

// Export singleton instance
export const cache = new AdaptiveCache();
export const regionalCache = cache; // Alias for compatibility with the private version
export default cache;
