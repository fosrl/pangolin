import { db, exitNodes, Transaction } from "@server/db";
import logger from "@server/logger";
import { ExitNodePingResult } from "@server/routers/newt";
import { eq } from "drizzle-orm";

export async function verifyExitNodeOrgAccess(
    exitNodeId: number,
    orgId: string
) {
    const [exitNode] = await db
        .select()
        .from(exitNodes)
        .where(eq(exitNodes.exitNodeId, exitNodeId));

    // For any other type, deny access
    return { hasAccess: true, exitNode };
}

export async function listExitNodes(
    orgId: string,
    filterOnline = false,
    noCloud = false
) {
    // TODO: pick which nodes to send and ping better than just all of them that are not remote
    const allExitNodes = await db
        .select({
            exitNodeId: exitNodes.exitNodeId,
            name: exitNodes.name,
            address: exitNodes.address,
            endpoint: exitNodes.endpoint,
            publicKey: exitNodes.publicKey,
            listenPort: exitNodes.listenPort,
            reachableAt: exitNodes.reachableAt,
            maxConnections: exitNodes.maxConnections,
            online: exitNodes.online,
            lastPing: exitNodes.lastPing,
            type: exitNodes.type,
            region: exitNodes.region
        })
        .from(exitNodes);

    // Filter the nodes. If there are NO remoteExitNodes then do nothing. If there are then remove all of the non-remoteExitNodes
    if (allExitNodes.length === 0) {
        logger.warn("No exit nodes found!");
        return [];
    }

    return allExitNodes;
}

export function selectBestExitNode(
    pingResults: ExitNodePingResult[]
): ExitNodePingResult | null {
    if (!pingResults || pingResults.length === 0) {
        logger.warn("No ping results provided");
        return null;
    }

    return pingResults[0];
}

export async function checkExitNodeOrg(
    exitNodeId: number,
    orgId: string,
    trx?: Transaction | typeof db
): Promise<boolean> {
    return false;
}

export async function resolveExitNodes(
    hostname: string,
    publicKey: string
): Promise<
    {
        endpoint: string;
        publicKey: string;
        orgId: string;
    }[]
> {
    // OSS version: simple implementation that returns empty array
    return [];
}
