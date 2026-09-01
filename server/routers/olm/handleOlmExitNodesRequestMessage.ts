import { db, clients } from "@server/db";
import { MessageHandler } from "@server/routers/ws";
import { exitNodes, Olm } from "@server/db";
import logger from "@server/logger";
import { eq } from "drizzle-orm";
import { listExitNodes } from "#dynamic/lib/exitNodes";
import { calculateExitNodeWeight } from "@server/lib/exitNodes";

export const handleOlmExitNodesRequestMessage: MessageHandler = async (
    context
) => {
    const { message, client: olmClient, sendToClient } = context;
    const olm = olmClient as Olm;

    logger.info("Handling exit nodes request olm message!");

    if (!olm) {
        logger.warn("olm not found");
        return;
    }

    // Get the olm's orgId through the client relationship
    if (!olm.clientId) {
        logger.warn("olm clientId not found");
        return;
    }

    const [client] = await db
        .select({ orgId: clients.orgId })
        .from(clients)
        .where(eq(clients.clientId, olm.clientId))
        .limit(1);

    if (!client || !client.orgId) {
        logger.warn("client not found");
        return;
    }

    const { noCloud, chainId } = message.data;

    const exitNodesList = await listExitNodes(
        client.orgId,
        true,
        noCloud || false,
        olm.clientId,
        true // don't select remote exit nodes for clients
    ); // filter for only the online ones

    let lastExitNodeId = null;
    if (olm.clientId) {
        const [lastExitNode] = await db
            .select()
            .from(clients)
            .where(eq(clients.clientId, olm.clientId))
            .limit(1);
        lastExitNodeId = lastExitNode?.exitNodeId || null;
    }

    const exitNodesPayload = await Promise.all(
        exitNodesList.map(async (node) => {
            const weight = await calculateExitNodeWeight(
                node.exitNodeId,
                node.maxConnections
            );

            if (weight === null) {
                return null;
            }

            return {
                exitNodeId: node.exitNodeId,
                exitNodeName: node.name,
                endpoint: node.endpoint,
                weight,
                wasPreviouslyConnected: node.exitNodeId === lastExitNodeId
            };
        })
    );

    // filter out null values
    const filteredExitNodes = exitNodesPayload.filter((node) => node !== null);

    return {
        message: {
            type: "olm/ping/exitNodes",
            data: {
                exitNodes: filteredExitNodes,
                chainId: chainId
            }
        },
        broadcast: false, // Send to all clients
        excludeSender: false // Include sender in broadcast
    };
};
