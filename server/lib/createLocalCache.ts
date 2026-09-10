import { LRUCache } from "lru-cache";

const DEFAULT_MAX_KEYS = 10000;
const DEFAULT_TTL_MS = 3600 * 1000;

export type LocalCache = {
    get<T>(key: string): T | undefined;
    set(key: string, value: unknown, ttlSeconds?: number): boolean;
    del(key: string | string[]): number;
    has(key: string): boolean;
    keys(): string[];
    flushAll(): void;
    getStats(): { keys: number };
    getTtl(key: string): number | undefined;
};

export function createLocalCache(max = DEFAULT_MAX_KEYS): LocalCache {
    const lru = new LRUCache<string, {}>({
        max,
        ttl: DEFAULT_TTL_MS,
        updateAgeOnGet: false
    });

    return {
        get<T>(key: string): T | undefined {
            return lru.get(key) as T | undefined;
        },

        set(key: string, value: unknown, ttlSeconds?: number): boolean {
            const stored = value as {};
            if (ttlSeconds === undefined) {
                lru.set(key, stored);
            } else if (ttlSeconds === 0) {
                lru.set(key, stored, { ttl: 0 });
            } else {
                lru.set(key, stored, { ttl: ttlSeconds * 1000 });
            }
            return true;
        },

        del(key: string | string[]): number {
            const keys = Array.isArray(key) ? key : [key];
            let deleted = 0;
            for (const k of keys) {
                if (lru.delete(k)) {
                    deleted++;
                }
            }
            return deleted;
        },

        has(key: string): boolean {
            return lru.has(key);
        },

        keys(): string[] {
            return [...lru.keys()];
        },

        flushAll(): void {
            lru.clear();
        },

        getStats(): { keys: number } {
            return { keys: lru.size };
        },

        getTtl(key: string): number | undefined {
            if (!lru.has(key)) {
                return undefined;
            }
            const remaining = lru.getRemainingTTL(key);
            if (!Number.isFinite(remaining)) {
                return 0;
            }
            return Date.now() + remaining;
        }
    };
}
