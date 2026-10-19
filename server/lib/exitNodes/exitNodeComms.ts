import axios from "axios";
import logger from "@server/logger";
import { ExitNode } from "@server/db";
import { hasExitNodeCheckedIn } from "./exitNodeCheckIn";

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
    if (!exitNode.reachableAt) {
        throw new Error(
            `Exit node with ID ${exitNode.exitNodeId} is not reachable`
        );
    }

    // Handle local exit node with HTTP API
    const method = request.method || "POST";
    let url = `${exitNode.reachableAt}${request.localPath}`;

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
                    }
                });
                break;
            case "DELETE":
                response = await axios.delete(url);
                break;
            case "GET":
                response = await axios.get(url);
                break;
            case "PUT":
                response = await axios.put(url, request.data, {
                    headers: {
                        "Content-Type": "application/json"
                    }
                });
                break;
            default:
                throw new Error(`Unsupported HTTP method: ${method}`);
        }

        logger.info(`Exit node request successful:`, {
            method,
            url,
            status: response.data.status
        });

        return response.data;
    } catch (error) {
        const message = axios.isAxiosError(error)
            ? `Error making ${method} request (can Pangolin see Gerbil HTTP API?) for exit node at ${exitNode.reachableAt} (status: ${error.response?.status}): ${error.message}`
            : `Error making ${method} request for exit node at ${exitNode.reachableAt}: ${error}`;

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
        throw error;
    }
}
