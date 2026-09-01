import { db, sites, clients } from "@server/db";
import { and, eq, count } from "drizzle-orm";

// (MAX_CONNECTIONS - current_connections) / MAX_CONNECTIONS)
// higher = more desirable
// like saying, this node has x% of its capacity left
export async function calculateExitNodeWeight(
    exitNodeId: number,
    maxConnections: number | null | undefined
): Promise<number | null> {
    if (maxConnections === null || maxConnections === undefined) {
        return 1;
    }

    const [[siteConnections], [clientConnections]] = await Promise.all([
        db
            .select({ count: count() })
            .from(sites)
            .where(
                and(eq(sites.exitNodeId, exitNodeId), eq(sites.online, true))
            ),
        db
            .select({ count: count() })
            .from(clients)
            .where(
                and(
                    eq(clients.exitNodeId, exitNodeId),
                    eq(clients.online, true)
                )
            )
    ]);

    const currentConnections = siteConnections.count + clientConnections.count;

    if (currentConnections >= maxConnections) {
        return null;
    }

    return (maxConnections - currentConnections) / maxConnections;
}
