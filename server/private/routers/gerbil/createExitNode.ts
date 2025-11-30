/*
 * This file is part of a proprietary work.
 *
 * Copyright (c) 2025 Fossorial, Inc.
 * All rights reserved.
 *
 * This file is licensed under the Fossorial Commercial License.
 * You may not use this file except in compliance with the License.
 * Unauthorized use, copying, modification, or distribution is strictly prohibited.
 *
 * This file is not licensed under the AGPLv3.
 */

import { db, ExitNode, exitNodes } from "@server/db";
import { getUniqueExitNodeEndpointName } from "@server/db/names";
import config from "@server/lib/config";
import { getNextAvailableSubnet } from "@server/lib/exitNodes";
import logger from "@server/logger";
import { eq } from "drizzle-orm";

export async function createExitNode(
    publicKey: string,
    reachableAt: string | undefined
) {
    // Fetch exit node
    const [exitNodeQuery] = await db
        .select()
        .from(exitNodes)
        .where(eq(exitNodes.publicKey, publicKey));
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
                listenPort,
                online: true,
                reachableAt,
                name: exitNodeName
            })
            .returning()
            .execute();

        logger.info(
            `Created new exit node ${exitNode.name} with address ${exitNode.address} and port ${exitNode.listenPort}`
        );
    } else {
        // update the reachable at
        [exitNode] = await db
            .update(exitNodes)
            .set({
                reachableAt,
                online: true
            })
            .where(eq(exitNodes.exitNodeId, exitNodeQuery.exitNodeId))
            .returning();

        logger.info(`Updated exit node reachableAt to ${reachableAt}`);
    }

    return exitNode;
}
