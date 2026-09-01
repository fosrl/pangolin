import { db, exitNodes, exitNodeOrgs, Transaction } from "@server/db";
import config from "@server/lib/config";
import { findNextAvailableCidr } from "@server/lib/ip";
import { lockManager } from "#dynamic/lib/lock";
import { eq } from "drizzle-orm";

/**
 * Reserves the next available exit node subnet.
 *
 * There isn't enough address space to give every exit node in every org a
 * globally unique subnet, so we only guarantee uniqueness among exit nodes
 * that already belong to the same org - that's all that actually matters,
 * since HA only routes multiple exit nodes for a single org. Pass `orgId` to
 * scope the search to that org's existing exit nodes; without it, the search
 * considers every exit node (used by flows with no org context, e.g. the
 * initial gerbil exit node bootstrap). This acquires a lock that the caller
 * MUST release (via the returned `release`) only after the chosen address
 * has been durably persisted (e.g. after the enclosing transaction commits),
 * otherwise concurrent callers can race and pick the same subnet.
 */
export async function getNextAvailableSubnet(
    trx: Transaction | typeof db = db,
    orgId?: string
): Promise<{ value: string; release: () => Promise<void> }> {
    const lockKey = "exit-node-subnet-allocation";
    const acquired = await lockManager.acquireLockWithRetry(lockKey, 6000);
    if (!acquired) {
        throw new Error(`Failed to acquire lock: ${lockKey}`);
    }
    const release = () => lockManager.releaseLock(lockKey, acquired);

    try {
        // Get existing subnets, scoped to this org's exit nodes when known
        const existingAddresses = orgId
            ? await trx
                  .select({ address: exitNodes.address })
                  .from(exitNodes)
                  .innerJoin(
                      exitNodeOrgs,
                      eq(exitNodeOrgs.exitNodeId, exitNodes.exitNodeId)
                  )
                  .where(eq(exitNodeOrgs.orgId, orgId))
            : await trx
                  .select({ address: exitNodes.address })
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
