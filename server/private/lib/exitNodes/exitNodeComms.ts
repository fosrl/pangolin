/*
 * This file is part of a proprietary work.
 *
 * Copyright (c) 2025-2026 Fossorial, Inc.
 * All rights reserved.
 *
 * This file is licensed under the Fossorial Commercial License.
 * You may not use this file except in compliance with the License.
 * Unauthorized use, copying, modification, or distribution is strictly prohibited.
 *
 * This file is not licensed under the AGPLv3.
 */

import axios from "axios";
import logger from "@server/logger";
import { db, ExitNode, remoteExitNodes } from "@server/db";
import { eq } from "drizzle-orm";
import { sendToClient } from "#private/routers/ws";
import privateConfig from "#private/lib/config";
import config from "@server/lib/config";
import { hasExitNodeCheckedIn } from "@server/lib/exitNodes";

interface ExitNodeRequest {
    remoteType?: string;
    localPath: string;
    method?: "POST" | "DELETE" | "GET" | "PUT";
    data?: any;
    queryParams?: Record<string, string>;
}

/**
 * Sends a request to an exit node, handling both remote and local exit nodes
 * @param exitNode The exit node to send the request to
 * @param request The request configuration
 * @returns Promise<any> Response data for local nodes, undefined for remote nodes
 */
export async function sendToExitNode(
    exitNode: ExitNode,
    request: ExitNodeRequest
): Promise<any> {
    if (exitNode.type === "remoteExitNode" && request.remoteType) {
        const [remoteExitNode] = await db
            .select()
            .from(remoteExitNodes)
            .where(eq(remoteExitNodes.exitNodeId, exitNode.exitNodeId))
            .limit(1);

        if (!remoteExitNode) {
            throw new Error(
                `Remote exit node with ID ${exitNode.exitNodeId} not found`
            );
        }

        return sendToClient(
            remoteExitNode.remoteExitNodeId,
            {
                type: request.remoteType,
                data: request.data
            },
            { incrementConfigVersion: true }
        );
    } else {
        let hostname = exitNode.reachableAt;

        // logger.debug(`Exit node details:`, {
        //     type: exitNode.type,
        //     name: exitNode.name,
        //     reachableAt: exitNode.reachableAt,
        // });

        // logger.debug(`Configured local exit node name: ${config.getRawConfig().gerbil.exit_node_name}`);

        if (exitNode.name == config.getRawConfig().gerbil.exit_node_name) {
            hostname =
                privateConfig.getRawPrivateConfig().gerbil
                    .local_exit_node_reachable_at;
        }

        if (!hostname) {
            throw new Error(
                `Exit node with ID ${exitNode.exitNodeId} is not reachable`
            );
        }

        // logger.debug(`Sending request to exit node at ${hostname}`, {
        //     type: request.remoteType,
        //     data: request.data
        // });

        // Handle local exit node with HTTP API
        const method = request.method || "POST";
        let url = `${hostname}${request.localPath}`;

        // Add query parameters if provided
        if (request.queryParams) {
            const params = new URLSearchParams(request.queryParams);
            url += `?${params.toString()}`;
        }

        try {
            let response;

            switch (method) {
                case "POST":
                    response = await axios.post(url, request.data, {
                        headers: {
                            "Content-Type": "application/json"
                        },
                        timeout: 8000
                    });
                    break;
                case "DELETE":
                    response = await axios.delete(url, {
                        timeout: 8000
                    });
                    break;
                case "GET":
                    response = await axios.get(url, {
                        timeout: 8000
                    });
                    break;
                case "PUT":
                    response = await axios.put(url, request.data, {
                        headers: {
                            "Content-Type": "application/json"
                        },
                        timeout: 8000
                    });
                    break;
                default:
                    throw new Error(`Unsupported HTTP method: ${method}`);
            }

            logger.debug(`Exit node request successful:`, {
                method,
                url,
                status: response.data.status
            });

            return response.data;
        } catch (error) {
            const message = axios.isAxiosError(error)
                ? `Error making ${method} request (can Pangolin see Gerbil HTTP API?) for exit node at ${hostname} (status: ${error.response?.status}): ${error.message}`
                : `Error making ${method} request for exit node at ${hostname}: ${error}`;

            // The exit node (gerbil) may still be starting up and not yet
            // reachable. Until it has checked in at least once, log this at a
            // lower level since it's expected; once it has checked in, a
            // connection failure is a real problem.
            if (hasExitNodeCheckedIn(exitNode.exitNodeId)) {
                logger.error(message);
            } else {
                logger.warn(
                    `${message} (exit node has not checked in yet since startup, this is expected briefly)`
                );
            }
        }
    }
}
