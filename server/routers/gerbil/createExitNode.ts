import { db, ExitNode, exitNodes } from "@server/db";
import { getUniqueExitNodeEndpointName } from "@server/db/names";
import config from "@server/lib/config";
import { getNextAvailableSubnet } from "@server/lib/exitNodes";
import logger from "@server/logger";
import { eq } from "drizzle-orm";

export async function createExitNode(publicKey: string, reachableAt: string | undefined) {
    // Fetch exit node
    const [exitNodeQuery] = await db.select().from(exitNodes).limit(1);
    let exitNode: ExitNode;
    if (!exitNodeQuery) {
        const address = await getNextAvailableSubnet();
        // TODO: eventually we will want to get the next available port so that we can multiple exit nodes
        // const listenPort = await getNextAvailablePort();
        const listenPort = config.getRawConfig().gerbil.start_port;
        let subEndpoint = "";
        if (config.getRawConfig().gerbil.use_subdomain) {
            subEndpoint = await getUniqueExitNodeEndpointName();
        }

        const exitNodeName =
            config.getRawConfig().gerbil.exit_node_name ||
            `Exit Node ${publicKey.slice(0, 8)}`;

        // create a new exit node
        [exitNode] = await db
            .insert(exitNodes)
            .values({
                publicKey,
                endpoint: `${subEndpoint}${subEndpoint != "" ? "." : ""}${config.getRawConfig().gerbil.base_endpoint}`,
                address,
                online: true,
                listenPort,
                reachableAt,
                name: exitNodeName
            })
            .returning()
            .execute();

        logger.info(
            `Created new exit node ${exitNode.name} with address ${exitNode.address} and port ${exitNode.listenPort}`
        );
    } else {
        // update the existing exit node
        [exitNode] = await db
            .update(exitNodes)
            .set({
                reachableAt,
                publicKey,
                online: true
            })
            .where(eq(exitNodes.publicKey, publicKey))
            .returning();

        logger.info(`Updated exit node with reachableAt to ${reachableAt}`);
    }

    return exitNode;
}
