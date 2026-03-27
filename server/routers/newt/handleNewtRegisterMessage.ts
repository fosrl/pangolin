import { db, ExitNode, newts, Transaction } from "@server/db";
import { MessageHandler } from "@server/routers/ws";
import { exitNodes, Newt, sites } from "@server/db";
import { eq } from "drizzle-orm";
import { addPeer, deletePeer } from "../gerbil/peers";
import logger from "@server/logger";
import config from "@server/lib/config";
import { findNextAvailableCidr } from "@server/lib/ip";
import {
    selectBestExitNode,
    verifyExitNodeOrgAccess
} from "#dynamic/lib/exitNodes";
import { fetchContainers } from "./dockerSocket";
import { lockManager } from "#dynamic/lib/lock";
import { buildTargetConfigurationForNewtClient } from "./buildConfiguration";
import { canCompress } from "@server/lib/clientVersionChecks";

export type ExitNodePingResult = {
    exitNodeId: number;
    latencyMs: number;
    weight: number;
    error?: string;
    exitNodeName: string;
    endpoint: string;
    wasPreviouslyConnected: boolean;
};

export const handleNewtRegisterMessage: MessageHandler = async (context) => {
    const { message, client, sendToClient } = context;
    const newt = client as Newt;

    logger.debug("Handling register newt message!");

    if (!newt) {
        logger.warn("Newt not found");
        return;
    }

    if (!newt.siteId) {
        logger.warn("Newt has no site!"); // TODO: Maybe we create the site here?
        return;
    }

    const siteId = newt.siteId;

    const { publicKey, pingResults, newtVersion, backwardsCompatible, chainId } =
        message.data;
    if (!publicKey) {
        logger.warn("Public key not provided");
        return;
    }

    if (backwardsCompatible) {
        logger.debug(
            "Backwards compatible mode detecting - not sending connect message and waiting for ping response."
        );
        return;
    }

    let exitNodeId: number | undefined;
    if (pingResults) {
        const bestPingResult = selectBestExitNode(
            pingResults as ExitNodePingResult[]
        );
        if (!bestPingResult) {
            logger.warn("No suitable exit node found based on ping results");
            return;
        }
        exitNodeId = bestPingResult.exitNodeId;
    }

    const [oldSite] = await db
        .select()
        .from(sites)
        .where(eq(sites.siteId, siteId))
        .limit(1);

    if (!oldSite) {
        logger.warn("Site not found");
        return;
    }

    logger.debug(`Docker socket enabled: ${oldSite.dockerSocketEnabled}`);

    if (oldSite.dockerSocketEnabled) {
        logger.debug(
            "Site has docker socket enabled - requesting docker containers"
        );
        fetchContainers(newt.newtId);
    }

    let siteSubnet = oldSite.subnet;
    let exitNodeIdToQuery = oldSite.exitNodeId;
    if (exitNodeId && (oldSite.exitNodeId !== exitNodeId || !oldSite.subnet)) {
        // This effectively moves the exit node to the new one
        exitNodeIdToQuery = exitNodeId; // Use the provided exitNodeId if it differs from the site's exitNodeId

        const { exitNode, hasAccess } = await verifyExitNodeOrgAccess(
            exitNodeIdToQuery,
            oldSite.orgId
        );

        if (!exitNode) {
            logger.warn("Exit node not found");
            return;
        }

        if (!hasAccess) {
            logger.warn("Not authorized to use this exit node");
            return;
        }

        const newSubnet = await getUniqueSubnetForSite(exitNode);

        if (!newSubnet) {
            logger.error(
                `No available subnets found for the new exit node id ${exitNodeId} and site id ${siteId}`
            );
            return;
        }

        siteSubnet = newSubnet;

        await db
            .update(sites)
            .set({
                pubKey: publicKey,
                exitNodeId: exitNodeId,
                subnet: newSubnet
            })
            .where(eq(sites.siteId, siteId))
            .returning();
    } else {
        await db
            .update(sites)
            .set({
                pubKey: publicKey
            })
            .where(eq(sites.siteId, siteId))
            .returning();
    }

    if (!exitNodeIdToQuery) {
        logger.warn("No exit node ID to query");
        return;
    }

    const [exitNode] = await db
        .select()
        .from(exitNodes)
        .where(eq(exitNodes.exitNodeId, exitNodeIdToQuery))
        .limit(1);

    if (oldSite.pubKey && oldSite.pubKey !== publicKey && oldSite.exitNodeId) {
        logger.info("Public key mismatch. Deleting old peer...");
        await deletePeer(oldSite.exitNodeId, oldSite.pubKey);
    }

    if (!siteSubnet) {
        logger.warn("Site has no subnet");
        return;
    }

    try {
        // add the peer to the exit node
        await addPeer(exitNodeIdToQuery, {
            publicKey: publicKey,
            allowedIps: [siteSubnet]
        });
    } catch (error) {
        logger.error(`Failed to add peer to exit node: ${error}`);
    }

    if (newtVersion && newtVersion !== newt.version) {
        // update the newt version in the database
        await db
            .update(newts)
            .set({
                version: newtVersion as string
            })
            .where(eq(newts.newtId, newt.newtId));
    }

    if (newtVersion && newtVersion !== newt.version) {
        // update the newt version in the database
        await db
            .update(newts)
            .set({
                version: newtVersion as string
            })
            .where(eq(newts.newtId, newt.newtId));
    }

    const { tcpTargets, udpTargets, validHealthCheckTargets } =
        await buildTargetConfigurationForNewtClient(siteId);

    logger.debug(
        `Sending health check targets to newt ${newt.newtId}: ${JSON.stringify(validHealthCheckTargets)}`
    );

    return {
        message: {
            type: "newt/wg/connect",
            data: {
                endpoint: `${exitNode.endpoint}:${exitNode.listenPort}`,
                relayPort: config.getRawConfig().gerbil.clients_start_port,
                publicKey: exitNode.publicKey,
                serverIP: exitNode.address.split("/")[0],
                tunnelIP: siteSubnet.split("/")[0],
                targets: {
                    udp: udpTargets,
                    tcp: tcpTargets
                },
                healthCheckTargets: validHealthCheckTargets,
                chainId: chainId
            }
        },
        options: {
            compress: canCompress(newt.version, "newt")
        },
        broadcast: false, // Send to all clients
        excludeSender: false // Include sender in broadcast
    };
};

async function getUniqueSubnetForSite(
    exitNode: ExitNode,
    trx: Transaction | typeof db = db
): Promise<string | null> {
    const lockKey = `subnet-allocation:${exitNode.exitNodeId}`;

    return await lockManager.withLock(
        lockKey,
        async () => {
            const sitesQuery = await trx
                .select({
                    subnet: sites.subnet
                })
                .from(sites)
                .where(eq(sites.exitNodeId, exitNode.exitNodeId));

            const blockSize = config.getRawConfig().gerbil.site_block_size;
            const subnets = sitesQuery
                .map((site) => site.subnet)
                .filter(
                    (subnet) =>
                        subnet &&
                        /^(\d{1,3}\.){3}\d{1,3}\/\d{1,2}$/.test(subnet)
                )
                .filter((subnet) => subnet !== null);
            subnets.push(exitNode.address.replace(/\/\d+$/, `/${blockSize}`));
            const newSubnet = findNextAvailableCidr(
                subnets,
                blockSize,
                exitNode.address
            );
            return newSubnet;
        },
        5000 // 5 second lock TTL - subnet allocation should be quick
    );
}
