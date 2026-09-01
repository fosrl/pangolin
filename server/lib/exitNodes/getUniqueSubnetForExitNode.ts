import { db, ExitNode, Transaction, sites, clients } from "@server/db";
import { eq } from "drizzle-orm";
import config from "@server/lib/config";
import { findNextAvailableCidr } from "@server/lib/ip";
import { lockManager } from "#dynamic/lib/lock";

export async function getUniqueSubnetForExitNode(
    exitNode: ExitNode,
    trx: Transaction | typeof db = db
): Promise<string | null> {
    const lockKey = `subnet-allocation:${exitNode.exitNodeId}`;

    return await lockManager.withLock(
        lockKey,
        async () => {
            const [sitesQuery, clientsQuery] = await Promise.all([
                trx
                    .select({ subnet: sites.exitNodeSubnet })
                    .from(sites)
                    .where(eq(sites.exitNodeId, exitNode.exitNodeId)),
                trx
                    .select({ subnet: clients.exitNodeSubnet })
                    .from(clients)
                    .where(eq(clients.exitNodeId, exitNode.exitNodeId))
            ]);

            const blockSize = config.getRawConfig().gerbil.site_block_size;
            const subnets = [...sitesQuery, ...clientsQuery]
                .map((row) => row.subnet)
                .filter(
                    (subnet): subnet is string =>
                        !!subnet &&
                        /^(\d{1,3}\.){3}\d{1,3}\/\d{1,2}$/.test(subnet)
                );
            subnets.push(exitNode.address.replace(/\/\d+$/, `/${blockSize}`));

            return findNextAvailableCidr(subnets, blockSize, exitNode.address);
        },
        5000 // 5 second lock TTL - subnet allocation should be quick
    );
}
