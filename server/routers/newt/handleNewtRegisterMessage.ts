import { db, ExitNode, exitNodeOrgs, newts, Transaction } from "@server/db";
import { MessageHandler } from "@server/routers/ws";
import { exitNodes, Newt, resources, sites, Target, targets } from "@server/db";
import { targetHealthCheck } from "@server/db";
import { eq, and, sql, inArray, ne } from "drizzle-orm";
import { addPeer, deletePeer } from "../gerbil/peers";
import logger from "@server/logger";
import config from "@server/lib/config";
import {
    findNextAvailableCidr,
    getNextAvailableClientSubnet
} from "@server/lib/ip";
import { usageService } from "@server/lib/billing/usageService";
import { FeatureId } from "@server/lib/billing";
import {
    selectBestExitNode,
    verifyExitNodeOrgAccess
} from "#dynamic/lib/exitNodes";
import { fetchContainers } from "./dockerSocket";
import { lockManager } from "#dynamic/lib/lock";

export type ExitNodePingResult = {
    exitNodeId: number;
    latencyMs: number;
    weight: number;
    error?: string;
    exitNodeName: string;
    endpoint: string;
    wasPreviouslyConnected: boolean;
};

const numTimesLimitExceededForId: Record<string, number> = {};

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

    const { publicKey, pingResults, newtVersion, backwardsCompatible } =
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

    const rejectSiteUptime = await usageService.checkLimitSet(
        oldSite.orgId,
        false,
        FeatureId.SITE_UPTIME
    );
    const rejectEgressDataMb = await usageService.checkLimitSet(
        oldSite.orgId,
        false,
        FeatureId.EGRESS_DATA_MB
    );

    // Do we need to check the users and domains daily limits here?
    // const rejectUsers = await usageService.checkLimitSet(oldSite.orgId, false, FeatureId.USERS);
    // const rejectDomains = await usageService.checkLimitSet(oldSite.orgId, false, FeatureId.DOMAINS);

    // if (rejectEgressDataMb || rejectSiteUptime || rejectUsers || rejectDomains) {
    if (rejectEgressDataMb || rejectSiteUptime) {
        logger.info(
            `Usage limits exceeded for org ${oldSite.orgId}. Rejecting newt registration.`
        );

        // PREVENT FURTHER REGISTRATION ATTEMPTS SO WE DON'T SPAM

        // Increment the limit exceeded count for this site
        numTimesLimitExceededForId[newt.newtId] =
            (numTimesLimitExceededForId[newt.newtId] || 0) + 1;

        if (numTimesLimitExceededForId[newt.newtId] > 15) {
            logger.debug(
                `Newt ${newt.newtId} has exceeded usage limits 15 times. Terminating...`
            );
        }

        return;
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

    // Get all enabled targets with their resource protocol information
    const allTargets = await db
        .select({
            resourceId: targets.resourceId,
            targetId: targets.targetId,
            ip: targets.ip,
            method: targets.method,
            port: targets.port,
            internalPort: targets.internalPort,
            enabled: targets.enabled,
            protocol: resources.protocol,
            hcEnabled: targetHealthCheck.hcEnabled,
            hcPath: targetHealthCheck.hcPath,
            hcScheme: targetHealthCheck.hcScheme,
            hcMode: targetHealthCheck.hcMode,
            hcHostname: targetHealthCheck.hcHostname,
            hcPort: targetHealthCheck.hcPort,
            hcInterval: targetHealthCheck.hcInterval,
            hcUnhealthyInterval: targetHealthCheck.hcUnhealthyInterval,
            hcTimeout: targetHealthCheck.hcTimeout,
            hcHeaders: targetHealthCheck.hcHeaders,
            hcMethod: targetHealthCheck.hcMethod
        })
        .from(targets)
        .innerJoin(resources, eq(targets.resourceId, resources.resourceId))
        .leftJoin(
            targetHealthCheck,
            eq(targets.targetId, targetHealthCheck.targetId)
        )
        .where(and(eq(targets.siteId, siteId), eq(targets.enabled, true)));

    const { tcpTargets, udpTargets } = allTargets.reduce(
        (acc, target) => {
            // Filter out invalid targets
            if (!target.internalPort || !target.ip || !target.port) {
                return acc;
            }

            // Format target into string
            const formattedTarget = `${target.internalPort}:${target.ip}:${target.port}`;

            // Add to the appropriate protocol array
            if (target.protocol === "tcp") {
                acc.tcpTargets.push(formattedTarget);
            } else {
                acc.udpTargets.push(formattedTarget);
            }

            return acc;
        },
        { tcpTargets: [] as string[], udpTargets: [] as string[] }
    );

    const healthCheckTargets = allTargets.map((target) => {
        // make sure the stuff is defined
        if (
            !target.hcPath ||
            !target.hcHostname ||
            !target.hcPort ||
            !target.hcInterval ||
            !target.hcMethod
        ) {
            logger.debug(
                `Skipping target ${target.targetId} due to missing health check fields`
            );
            return null; // Skip targets with missing health check fields
        }

        // parse headers
        const hcHeadersParse = target.hcHeaders
            ? JSON.parse(target.hcHeaders)
            : null;
        const hcHeadersSend: { [key: string]: string } = {};
        if (hcHeadersParse) {
            hcHeadersParse.forEach(
                (header: { name: string; value: string }) => {
                    hcHeadersSend[header.name] = header.value;
                }
            );
        }

        return {
            id: target.targetId,
            hcEnabled: target.hcEnabled,
            hcPath: target.hcPath,
            hcScheme: target.hcScheme,
            hcMode: target.hcMode,
            hcHostname: target.hcHostname,
            hcPort: target.hcPort,
            hcInterval: target.hcInterval, // in seconds
            hcUnhealthyInterval: target.hcUnhealthyInterval, // in seconds
            hcTimeout: target.hcTimeout, // in seconds
            hcHeaders: hcHeadersSend,
            hcMethod: target.hcMethod
        };
    });

    // Filter out any null values from health check targets
    const validHealthCheckTargets = healthCheckTargets.filter(
        (target) => target !== null
    );

    logger.debug(
        `Sending health check targets to newt ${newt.newtId}: ${JSON.stringify(validHealthCheckTargets)}`
    );

    return {
        message: {
            type: "newt/wg/connect",
            data: {
                endpoint: `${exitNode.endpoint}:${exitNode.listenPort}`,
                publicKey: exitNode.publicKey,
                serverIP: exitNode.address.split("/")[0],
                tunnelIP: siteSubnet.split("/")[0],
                targets: {
                    udp: udpTargets,
                    tcp: tcpTargets
                },
                healthCheckTargets: validHealthCheckTargets
            }
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
                        subnet && /^(\d{1,3}\.){3}\d{1,3}\/\d{1,2}$/.test(subnet)
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
