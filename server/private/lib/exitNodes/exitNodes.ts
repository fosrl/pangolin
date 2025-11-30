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

import {
    db,
    exitNodes,
    exitNodeOrgs,
    resources,
    targets,
    sites,
    targetHealthCheck,
    Transaction
} from "@server/db";
import logger from "@server/logger";
import { ExitNodePingResult } from "@server/routers/newt";
import { eq, and, or, ne, isNull } from "drizzle-orm";
import axios from "axios";
import config from "../config";

/**
 * Checks if an exit node is actually online by making HTTP requests to its endpoint/ping
 * Makes up to 3 attempts in parallel with small delays, returns as soon as one succeeds
 */
async function checkExitNodeOnlineStatus(
    endpoint: string | undefined
): Promise<boolean> {
    if (!endpoint || endpoint == "") {
        // the endpoint can start out as a empty string
        return false;
    }

    const maxAttempts = 3;
    const timeoutMs = 5000; // 5 second timeout per request
    const delayBetweenAttempts = 100; // 100ms delay between starting each attempt

    // Create promises for all attempts with staggered delays
    const attemptPromises = Array.from({ length: maxAttempts }, async (_, index) => {
        const attemptNumber = index + 1;
        
        // Add delay before each attempt (except the first)
        if (index > 0) {
            await new Promise((resolve) => setTimeout(resolve, delayBetweenAttempts * index));
        }

        try {
            const response = await axios.get(`http://${endpoint}/ping`, {
                timeout: timeoutMs,
                validateStatus: (status) => status === 200
            });

            if (response.status === 200) {
                logger.debug(
                    `Exit node ${endpoint} is online (attempt ${attemptNumber}/${maxAttempts})`
                );
                return { success: true, attemptNumber };
            }
            return { success: false, attemptNumber, error: 'Non-200 status' };
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : "Unknown error";
            logger.debug(
                `Exit node ${endpoint} ping failed (attempt ${attemptNumber}/${maxAttempts}): ${errorMessage}`
            );
            return { success: false, attemptNumber, error: errorMessage };
        }
    });

    try {
        // Wait for the first successful response or all to fail
        const results = await Promise.allSettled(attemptPromises);
        
        // Check if any attempt succeeded
        for (const result of results) {
            if (result.status === 'fulfilled' && result.value.success) {
                return true;
            }
        }

        // All attempts failed
        logger.warn(
            `Exit node ${endpoint} is offline after ${maxAttempts} parallel attempts`
        );
        return false;
    } catch (error) {
        logger.warn(
            `Unexpected error checking exit node ${endpoint}: ${error instanceof Error ? error.message : "Unknown error"}`
        );
        return false;
    }
}

export async function verifyExitNodeOrgAccess(
    exitNodeId: number,
    orgId: string
) {
    const [result] = await db
        .select({
            exitNode: exitNodes,
            exitNodeOrgId: exitNodeOrgs.exitNodeId
        })
        .from(exitNodes)
        .leftJoin(
            exitNodeOrgs,
            and(
                eq(exitNodeOrgs.exitNodeId, exitNodes.exitNodeId),
                eq(exitNodeOrgs.orgId, orgId)
            )
        )
        .where(eq(exitNodes.exitNodeId, exitNodeId));

    if (!result) {
        return { hasAccess: false, exitNode: null };
    }

    const { exitNode } = result;

    // If the exit node is type "gerbil", access is allowed
    if (exitNode.type === "gerbil") {
        return { hasAccess: true, exitNode };
    }

    // If the exit node is type "remoteExitNode", check if it has org access
    if (exitNode.type === "remoteExitNode") {
        return { hasAccess: !!result.exitNodeOrgId, exitNode };
    }

    // For any other type, deny access
    return { hasAccess: false, exitNode };
}

export async function listExitNodes(orgId: string, filterOnline = false, noCloud = false) {
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
            orgId: exitNodeOrgs.orgId,
            region: exitNodes.region
        })
        .from(exitNodes)
        .leftJoin(
            exitNodeOrgs,
            eq(exitNodes.exitNodeId, exitNodeOrgs.exitNodeId)
        )
        .where(
            or(
                // Include all exit nodes that are NOT of type remoteExitNode
                and(
                    eq(exitNodes.type, "gerbil"),
                    or(
                        // only choose nodes that are in the same region
                        eq(exitNodes.region, config.getRawPrivateConfig().app.region),
                        isNull(exitNodes.region) // or for enterprise where region is not set
                    )
                ),
                // Include remoteExitNode types where the orgId matches the newt's organization
                and(
                    eq(exitNodes.type, "remoteExitNode"),
                    eq(exitNodeOrgs.orgId, orgId)
                )
            )
        );

    // Filter the nodes. If there are NO remoteExitNodes then do nothing. If there are then remove all of the non-remoteExitNodes
    if (allExitNodes.length === 0) {
        logger.warn("No exit nodes found for ping request!");
        return [];
    }

    // // Enhanced online checking: consider node offline if either DB says offline OR HTTP ping fails
    // const nodesWithRealOnlineStatus = await Promise.all(
    //     allExitNodes.map(async (node) => {
    //         // If database says it's online, verify with HTTP ping
    //         let online: boolean;
    //         if (filterOnline && node.type == "remoteExitNode") {
    //             try {
    //                 const isActuallyOnline = await checkExitNodeOnlineStatus( 
    //                     node.endpoint
    //                 );

    //                 // set the item in the database if it is offline
    //                 if (isActuallyOnline != node.online) {
    //                     await db
    //                         .update(exitNodes)
    //                         .set({ online: isActuallyOnline })
    //                         .where(eq(exitNodes.exitNodeId, node.exitNodeId));
    //                 }
    //                 online = isActuallyOnline;
    //             } catch (error) {
    //                 logger.warn(
    //                     `Failed to check online status for exit node ${node.name} (${node.endpoint}): ${error instanceof Error ? error.message : "Unknown error"}`
    //                 );
    //                 online = false;
    //             }
    //         } else {
    //             online = node.online;
    //         }

    //         return {
    //             ...node,
    //             online
    //         };
    //     })
    // );

    const remoteExitNodes = allExitNodes.filter(
        (node) =>
            node.type === "remoteExitNode" && (!filterOnline || node.online)
    );
    const gerbilExitNodes = allExitNodes.filter(
        (node) => node.type === "gerbil" && (!filterOnline || node.online) && !noCloud
    );

    // THIS PROVIDES THE FALL
    const exitNodesList =
        remoteExitNodes.length > 0 ? remoteExitNodes : gerbilExitNodes;

    return exitNodesList;
}

/**
 * Selects the most suitable exit node from a list of ping results.
 *
 * The selection algorithm follows these steps:
 *
 * 1. **Filter Invalid Nodes**: Excludes nodes with errors or zero weight.
 *
 * 2. **Sort by Latency**: Sorts valid nodes in ascending order of latency.
 *
 * 3. **Preferred Selection**:
 *    - If the lowest-latency node has sufficient capacity (≥10% weight),
 *      check if a previously connected node is also acceptable.
 *    - The previously connected node is preferred if its latency is within
 *      30ms or 15% of the best node’s latency.
 *
 * 4. **Fallback to Next Best**:
 *    - If the lowest-latency node is under capacity, find the next node
 *      with acceptable capacity.
 *
 * 5. **Final Fallback**:
 *    - If no nodes meet the capacity threshold, fall back to the node
 *      with the highest weight (i.e., most available capacity).
 *
 */
export function selectBestExitNode(
    pingResults: ExitNodePingResult[]
): ExitNodePingResult | null {
    const MIN_CAPACITY_THRESHOLD = 0.1;
    const LATENCY_TOLERANCE_MS = 30;
    const LATENCY_TOLERANCE_PERCENT = 0.15;

    // Filter out invalid nodes
    const validNodes = pingResults.filter((n) => !n.error && n.weight > 0);

    if (validNodes.length === 0) {
        logger.error("No valid exit nodes available");
        return null;
    }

    // Sort by latency (ascending)
    const sortedNodes = validNodes
        .slice()
        .sort((a, b) => a.latencyMs - b.latencyMs);
    const lowestLatencyNode = sortedNodes[0];

    logger.debug(
        `Lowest latency node: ${lowestLatencyNode.exitNodeName} (${lowestLatencyNode.latencyMs} ms, weight=${lowestLatencyNode.weight.toFixed(2)})`
    );

    // If lowest latency node has enough capacity, check if previously connected node is acceptable
    if (lowestLatencyNode.weight >= MIN_CAPACITY_THRESHOLD) {
        const previouslyConnectedNode = sortedNodes.find(
            (n) =>
                n.wasPreviouslyConnected && n.weight >= MIN_CAPACITY_THRESHOLD
        );

        if (previouslyConnectedNode) {
            const latencyDiff =
                previouslyConnectedNode.latencyMs - lowestLatencyNode.latencyMs;
            const percentDiff = latencyDiff / lowestLatencyNode.latencyMs;

            if (
                latencyDiff <= LATENCY_TOLERANCE_MS ||
                percentDiff <= LATENCY_TOLERANCE_PERCENT
            ) {
                logger.info(
                    `Sticking with previously connected node: ${previouslyConnectedNode.exitNodeName} ` +
                        `(${previouslyConnectedNode.latencyMs} ms), latency diff = ${latencyDiff.toFixed(1)}ms ` +
                        `/ ${(percentDiff * 100).toFixed(1)}%.`
                );
                return previouslyConnectedNode;
            }
        }

        return lowestLatencyNode;
    }

    // Otherwise, find the next node (after the lowest) that has enough capacity
    for (let i = 1; i < sortedNodes.length; i++) {
        const node = sortedNodes[i];
        if (node.weight >= MIN_CAPACITY_THRESHOLD) {
            logger.info(
                `Lowest latency node under capacity. Using next best: ${node.exitNodeName} ` +
                    `(${node.latencyMs} ms, weight=${node.weight.toFixed(2)})`
            );
            return node;
        }
    }

    // Fallback: pick the highest weight node
    const fallbackNode = validNodes.reduce((a, b) =>
        a.weight > b.weight ? a : b
    );
    logger.warn(
        `No nodes with ≥10% weight. Falling back to highest capacity node: ${fallbackNode.exitNodeName}`
    );
    return fallbackNode;
}

export async function checkExitNodeOrg(exitNodeId: number, orgId: string, trx: Transaction | typeof db = db) {
    const [exitNodeOrg] = await trx
        .select()
        .from(exitNodeOrgs)
        .where(
            and(
                eq(exitNodeOrgs.exitNodeId, exitNodeId),
                eq(exitNodeOrgs.orgId, orgId)
            )
        )
        .limit(1);

    if (!exitNodeOrg) {
        return true;
    }

    return false;
}

export async function resolveExitNodes(hostname: string, publicKey: string) {
    const resourceExitNodes = await db
        .select({
            endpoint: exitNodes.endpoint,
            publicKey: exitNodes.publicKey,
            orgId: resources.orgId
        })
        .from(resources)
        .innerJoin(targets, eq(resources.resourceId, targets.resourceId))
        .leftJoin(
            targetHealthCheck,
            eq(targetHealthCheck.targetId, targets.targetId)
        )
        .innerJoin(sites, eq(targets.siteId, sites.siteId))
        .innerJoin(exitNodes, eq(sites.exitNodeId, exitNodes.exitNodeId))
        .where(
            and(
                eq(resources.fullDomain, hostname),
                ne(exitNodes.publicKey, publicKey),
                ne(targetHealthCheck.hcHealth, "unhealthy")
            )
        );

    return resourceExitNodes;
}
