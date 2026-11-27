import { eq } from "drizzle-orm";
import { db, exitNodes, Transaction } from "@server/db";

/**
 * Whether a local site's targets are dialled by Pangolin's own Traefik.
 * Local sites on a remote exit node are served by that node's Traefik inside
 * the customer's network, where localhost and similar targets are expected,
 * so the local-site target restrictions only apply to the other case.
 */
export async function isLocalSiteServedByPangolin(
    exitNodeId: number | null | undefined,
    trx: Transaction | typeof db = db
): Promise<boolean> {
    if (exitNodeId == null) {
        return true;
    }
    const [node] = await trx
        .select({ type: exitNodes.type })
        .from(exitNodes)
        .where(eq(exitNodes.exitNodeId, exitNodeId))
        .limit(1);
    return node?.type !== "remoteExitNode";
}
