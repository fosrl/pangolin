import { db, exitNodes, Transaction } from "@server/db";
import config from "@server/lib/config";
import { findNextAvailableCidr } from "@server/lib/ip";
import { lockManager } from "#dynamic/lib/lock";

/**
 * Reserves the next available exit node subnet.
 *
 * Exit node subnets must never overlap with one another - regardless of
 * which org(s) they belong to - since HA exit nodes can end up routing for
 * the same org. This acquires a lock that the caller MUST release (via the
 * returned `release`) only after the chosen address has been durably
 * persisted (e.g. after the enclosing transaction commits), otherwise
 * concurrent callers can race and pick the same subnet.
 */
export async function getNextAvailableSubnet(
    trx: Transaction | typeof db = db
): Promise<{ value: string; release: () => Promise<void> }> {
    const lockKey = "exit-node-subnet-allocation";
    const acquired = await lockManager.acquireLockWithRetry(lockKey, 6000);
    if (!acquired) {
        throw new Error(`Failed to acquire lock: ${lockKey}`);
    }
    const release = () => lockManager.releaseLock(lockKey, acquired);

    try {
        // Get all existing subnets from routes table
        const existingAddresses = await trx
            .select({
                address: exitNodes.address
            })
            .from(exitNodes);

        const addresses = existingAddresses.map((a) => a.address);
        let subnet = findNextAvailableCidr(
            addresses,
            config.getRawConfig().gerbil.block_size,
            config.getRawConfig().gerbil.subnet_group
        );
        if (!subnet) {
            throw new Error("No available subnets remaining in space");
        }

        // replace the last octet with 1
        subnet =
            subnet.split(".").slice(0, 3).join(".") +
            ".1" +
            "/" +
            subnet.split("/")[1];
        return { value: subnet, release };
    } catch (e) {
        await release();
        throw e;
    }
}
