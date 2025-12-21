import NodeCache from "node-cache";
import logger from "@server/logger";

// Create cache with maxKeys limit to prevent memory leaks
// With ~10k requests/day and 5min TTL, 10k keys should be more than sufficient
export const cache = new NodeCache({
    stdTTL: 3600,
    checkperiod: 120,
    maxKeys: 10000
});

// Log cache statistics periodically for monitoring
setInterval(() => {
    const stats = cache.getStats();
    logger.debug(
        `Cache stats - Keys: ${stats.keys}, Hits: ${stats.hits}, Misses: ${stats.misses}, Hit rate: ${stats.hits > 0 ? ((stats.hits / (stats.hits + stats.misses)) * 100).toFixed(2) : 0}%`
    );
}, 300000); // Every 5 minutes

export default cache;
