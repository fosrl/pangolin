import { localCache } from "#dynamic/lib/cache";
import logger from "@server/logger";

/**
 * Invalidates the badger resource cache for a given domain.
 * Call this when resource settings, policies, or auth methods change.
 */
export function invalidateResourceCache(fullDomain: string | null | undefined) {
    if (!fullDomain) return;
    const key = `resource:${fullDomain}`;
    localCache.del(key);
    logger.debug(`Invalidated badger resource cache: ${key}`);
}

/**
 * Invalidates the badger rules cache for a given resource.
 * Call this when resource rules are created, updated, or deleted.
 */
export function invalidateRulesCache(resourceId: number) {
    const key = `rules:${resourceId}`;
    localCache.del(key);
    logger.debug(`Invalidated badger rules cache: ${key}`);
}

/**
 * Invalidates all badger header auth cache entries for a resource.
 * Call this when header auth settings change for a resource.
 */
export function invalidateHeaderAuthCache(resourceId: number) {
    const prefix = `headerAuth:${resourceId}:`;
    const allKeys = localCache.keys();
    const matching = allKeys.filter((k) => k.startsWith(prefix));
    if (matching.length > 0) {
        localCache.del(matching);
        logger.debug(
            `Invalidated ${matching.length} badger headerAuth cache entries for resource ${resourceId}`
        );
    }
}

/**
 * Invalidates a specific resource session from the cache.
 * Call this when a resource session is explicitly deleted or invalidated.
 */
export function invalidateResourceSessionCache(sessionToken: string) {
    const key = `session:${sessionToken}`;
    localCache.del(key);
    logger.debug(`Invalidated badger session cache: ${key}`);
}

/**
 * Invalidates all user access cache entries for a given resource.
 * Call this when role/user access permissions change for a resource.
 */
export function invalidateUserAccessCache(resourceId: number) {
    const prefix = `userAccess:`;
    const suffix = `:${resourceId}`;
    const allKeys = localCache.keys();
    const matching = allKeys.filter(
        (k) => k.startsWith(prefix) && k.endsWith(suffix)
    );
    if (matching.length > 0) {
        localCache.del(matching);
        logger.debug(
            `Invalidated ${matching.length} badger userAccess cache entries for resource ${resourceId}`
        );
    }
}
