import { ExitNode, primaryDb, sites, clients } from "@server/db";
import { eq } from "drizzle-orm";
import config from "@server/lib/config";
import { findNextAvailableCidr } from "@server/lib/ip";
import { lockManager } from "#dynamic/lib/lock";

/**
 * Picks the next free site/client subnet on the given exit node. This acquires
 * a per-exit-node lock that the caller MUST release (via the returned
 * `release`) only after the chosen subnet has been persisted to the database
 * (or the operation has failed) — otherwise a concurrent caller on another
 * node could pick the same subnet. If no subnet is available the lock is
 * released before returning and `value` is null.
 */
export async function getUniqueSubnetForExitNode(
    exitNode: ExitNode
): Promise<{ value: string | null; release: () => Promise<void> }> {
    const lockKey = `subnet-allocation:${exitNode.exitNodeId}`;
    const acquired = await lockManager.acquireLockWithRetry(lockKey, 6000);
    if (!acquired) {
        throw new Error(`Failed to acquire lock: ${lockKey}`);
    }
    const release = () => lockManager.releaseLock(lockKey, acquired);

    try {
        // read from the primary so we see subnets committed by the previous lock holder
        const [sitesQuery, clientsQuery] = await Promise.all([
            primaryDb
                .select({ subnet: sites.exitNodeSubnet })
                .from(sites)
                .where(eq(sites.exitNodeId, exitNode.exitNodeId)),
            primaryDb
                .select({ subnet: clients.exitNodeSubnet })
                .from(clients)
                .where(eq(clients.exitNodeId, exitNode.exitNodeId))
        ]);

        const blockSize = config.getRawConfig().gerbil.site_block_size;
        const subnets = [...sitesQuery, ...clientsQuery]
            .map((row) => row.subnet)
            .filter(
                (subnet): subnet is string =>
                    !!subnet && /^(\d{1,3}\.){3}\d{1,3}\/\d{1,2}$/.test(subnet)
            );
        subnets.push(exitNode.address.replace(/\/\d+$/, `/${blockSize}`));

        const subnet = findNextAvailableCidr(
            subnets,
            blockSize,
            exitNode.address
        );
        if (!subnet) {
            await release();
            return { value: null, release: async () => {} };
        }

        return { value: subnet, release };
    } catch (e) {
        await release();
        throw e;
    }
}
