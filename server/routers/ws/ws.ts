import { Router, Request, Response } from "express";
import zlib from "zlib";
import { Server as HttpServer } from "http";
import { WebSocket, WebSocketServer } from "ws";
import { Socket } from "net";
import {
    Newt,
    newts,
    NewtSession,
    olms,
    Olm,
    OlmSession,
    sites
} from "@server/db";
import { eq } from "drizzle-orm";
import { db } from "@server/db";
import { recordSitePing } from "@server/routers/newt/pingAccumulator";
import { validateNewtSessionToken } from "@server/auth/sessions/newt";
import { validateOlmSessionToken } from "@server/auth/sessions/olm";
import { messageHandlers } from "./messageHandlers";
import logger from "@server/logger";
import { v4 as uuidv4 } from "uuid";
import {
    ClientType,
    TokenPayload,
    WebSocketRequest,
    WSMessage,
    AuthenticatedWebSocket,
    SendMessageOptions,
    BatchSendMessage
} from "./types";
import { validateSessionToken } from "@server/auth/sessions/app";

// Subset of TokenPayload for public ws.ts (newt and olm only)
interface PublicTokenPayload {
    client: Newt | Olm;
    session: NewtSession | OlmSession;
    clientType: "newt" | "olm";
}

const router: Router = Router();
const wss: WebSocketServer = new WebSocketServer({ noServer: true });

// Generate unique node ID for this instance
const NODE_ID = uuidv4();

// Client tracking map (local to this node)
const connectedClients: Map<string, AuthenticatedWebSocket[]> = new Map();
// Config version tracking map (clientId -> version)
const clientConfigVersions: Map<string, number> = new Map();
// Helper to get map key
const getClientMapKey = (clientId: string) => clientId;

// Helper functions for client management
const addClient = async (
    clientType: ClientType,
    clientId: string,
    ws: AuthenticatedWebSocket
): Promise<void> => {
    // Generate unique connection ID
    const connectionId = uuidv4();
    ws.connectionId = connectionId;

    // Add to local tracking
    const mapKey = getClientMapKey(clientId);
    const existingClients = connectedClients.get(mapKey) || [];
    existingClients.push(ws);
    connectedClients.set(mapKey, existingClients);

    // Initialize config version to 0 if not already set, otherwise use existing
    if (!clientConfigVersions.has(clientId)) {
        clientConfigVersions.set(clientId, 0);
    }
    // Set the current config version on the websocket
    ws.configVersion = clientConfigVersions.get(clientId) || 0;

    logger.info(
        `Client added to tracking - ${clientType.toUpperCase()} ID: ${clientId}, Connection ID: ${connectionId}, Total connections: ${existingClients.length}`
    );
};

const removeClient = async (
    clientType: ClientType,
    clientId: string,
    ws: AuthenticatedWebSocket
): Promise<void> => {
    const mapKey = getClientMapKey(clientId);
    const existingClients = connectedClients.get(mapKey) || [];
    const updatedClients = existingClients.filter((client) => client !== ws);
    if (updatedClients.length === 0) {
        connectedClients.delete(mapKey);
        // Remove clientId from clientConfigVersions — prevents unbounded growth
        // from stale entries.
        clientConfigVersions.delete(clientId);

        logger.info(
            `All connections removed for ${clientType.toUpperCase()} ID: ${clientId}`
        );
    } else {
        connectedClients.set(mapKey, updatedClients);

        logger.info(
            `Connection removed - ${clientType.toUpperCase()} ID: ${clientId}, Remaining connections: ${updatedClients.length}`
        );
    }
};

// Local message sending (within this node)
const sendToClientLocal = async (
    clientId: string,
    message: WSMessage,
    options: SendMessageOptions = {}
): Promise<boolean> => {
    const mapKey = getClientMapKey(clientId);
    const clients = connectedClients.get(mapKey);
    if (!clients || clients.length === 0) {
        return false;
    }

    // Include config version in message
    const configVersion = clientConfigVersions.get(clientId) || 0;
    // Update version on all client connections
    clients.forEach((client) => {
        client.configVersion = configVersion;
    });

    const messageWithVersion = {
        ...message,
        configVersion
    };

    const messageString = JSON.stringify(messageWithVersion);
    if (options.compress) {
        const compressed = zlib.gzipSync(Buffer.from(messageString, "utf8"));
        clients.forEach((client) => {
            if (client.readyState === WebSocket.OPEN) {
                client.send(compressed);
            }
        });
    } else {
        clients.forEach((client) => {
            if (client.readyState === WebSocket.OPEN) {
                client.send(messageString);
            }
        });
    }
    return true;
};

const broadcastToAllExceptLocal = async (
    message: WSMessage,
    excludeClientId?: string,
    options: SendMessageOptions = {}
): Promise<void> => {
    connectedClients.forEach((clients, mapKey) => {
        const clientId = mapKey; // mapKey is the clientId
        if (!(excludeClientId && clientId === excludeClientId)) {
            // Handle config version per client
            if (options.incrementConfigVersion) {
                const currentVersion = clientConfigVersions.get(clientId) || 0;
                const newVersion = currentVersion + 1;
                clientConfigVersions.set(clientId, newVersion);
                clients.forEach((client) => {
                    client.configVersion = newVersion;
                });
            }
            // Include config version in message for this client
            const configVersion = clientConfigVersions.get(clientId) || 0;
            const messageWithVersion = {
                ...message,
                configVersion
            };
            if (options.compress) {
                const compressed = zlib.gzipSync(
                    Buffer.from(JSON.stringify(messageWithVersion), "utf8")
                );
                clients.forEach((client) => {
                    if (client.readyState === WebSocket.OPEN) {
                        client.send(compressed);
                    }
                });
            } else {
                clients.forEach((client) => {
                    if (client.readyState === WebSocket.OPEN) {
                        client.send(JSON.stringify(messageWithVersion));
                    }
                });
            }
        }
    });
};

// Cross-node message sending
const sendToClient = async (
    clientId: string,
    message: WSMessage,
    options: SendMessageOptions = {}
): Promise<boolean> => {
    // Increment config version if requested
    if (options.incrementConfigVersion) {
        const currentVersion = clientConfigVersions.get(clientId) || 0;
        const newVersion = currentVersion + 1;
        clientConfigVersions.set(clientId, newVersion);
    }

    // Try to send locally first
    const localSent = await sendToClientLocal(clientId, message, options);

    logger.debug(
        `sendToClient: Message type ${message.type} sent to clientId ${clientId}`
    );

    return localSent;
};

const sendToClientsBatch = async (
    entries: BatchSendMessage[]
): Promise<void> => {
    if (entries.length === 0) {
        return;
    }

    await Promise.all(
        entries.map((entry) =>
            sendToClient(entry.clientId, entry.message, entry.options)
        )
    );
};

const broadcastToAllExcept = async (
    message: WSMessage,
    excludeClientId?: string,
    options: SendMessageOptions = {}
): Promise<void> => {
    // Broadcast locally
    await broadcastToAllExceptLocal(message, excludeClientId, options);
};

// Check if a client has active connections across all nodes
const hasActiveConnections = async (clientId: string): Promise<boolean> => {
    const mapKey = getClientMapKey(clientId);
    const clients = connectedClients.get(mapKey);
    return !!(clients && clients.length > 0);
};

// Get the current config version for a client
const getClientConfigVersion = async (
    clientId: string
): Promise<number | undefined> => {
    const version = clientConfigVersions.get(clientId);
    logger.debug(
        `getClientConfigVersion called for clientId: ${clientId}, returning: ${version} (type: ${typeof version})`
    );
    return version;
};

// Get all active nodes for a client
const getActiveNodes = async (
    clientType: ClientType,
    clientId: string
): Promise<string[]> => {
    const mapKey = getClientMapKey(clientId);
    const clients = connectedClients.get(mapKey);
    return clients && clients.length > 0 ? [NODE_ID] : [];
};

// Token verification middleware
const verifyToken = async (
    token: string,
    clientType: ClientType,
    userToken: string
): Promise<PublicTokenPayload | null> => {
    try {
        if (clientType === "newt") {
            const { session, newt } = await validateNewtSessionToken(token);
            if (!session || !newt) {
                return null;
            }
            const existingNewt = await db
                .select()
                .from(newts)
                .where(eq(newts.newtId, newt.newtId));
            if (!existingNewt || !existingNewt[0]) {
                return null;
            }
            return { client: existingNewt[0], session, clientType };
        } else if (clientType === "olm") {
            const { session, olm } = await validateOlmSessionToken(token);
            if (!session || !olm) {
                return null;
            }
            const existingOlm = await db
                .select()
                .from(olms)
                .where(eq(olms.olmId, olm.olmId));
            if (!existingOlm || !existingOlm[0]) {
                return null;
            }

            if (olm.userId) {
                // this is a user device and we need to check the user token
                const { session: userSession, user } =
                    await validateSessionToken(userToken);
                if (!userSession || !user) {
                    return null;
                }
                if (user.userId !== olm.userId) {
                    return null;
                }
            }

            return { client: existingOlm[0], session, clientType };
        }

        return null;
    } catch (error) {
        logger.error("Token verification failed:", error);
        return null;
    }
};

const setupConnection = async (
    ws: AuthenticatedWebSocket,
    client: Newt | Olm,
    clientType: "newt" | "olm"
): Promise<void> => {
    logger.info("Establishing websocket connection");
    if (!client) {
        logger.error("Connection attempt without client");
        return ws.terminate();
    }

    ws.client = client;
    ws.clientType = clientType;

    // Add client to tracking
    const clientId =
        clientType === "newt" ? (client as Newt).newtId : (client as Olm).olmId;
    await addClient(clientType, clientId, ws);

    ws.on("message", async (data, isBinary) => {
        try {
            const messageBuffer = isBinary
                ? zlib.gunzipSync(data as Buffer)
                : (data as Buffer);
            const message: WSMessage = JSON.parse(messageBuffer.toString());

            if (!message.type || typeof message.type !== "string") {
                throw new Error(
                    "Invalid message format: missing or invalid type"
                );
            }

            const handler = messageHandlers[message.type];
            if (!handler) {
                throw new Error(`Unsupported message type: ${message.type}`);
            }

            const response = await handler({
                message,
                senderWs: ws,
                client: ws.client,
                clientType: ws.clientType!,
                sendToClient,
                broadcastToAllExcept,
                connectedClients
            });

            if (response) {
                if (response.broadcast) {
                    await broadcastToAllExcept(
                        response.message,
                        response.excludeSender ? clientId : undefined,
                        response.options
                    );
                } else if (response.targetClientId) {
                    await sendToClient(
                        response.targetClientId,
                        response.message,
                        response.options
                    );
                } else {
                    await sendToClient(
                        clientId,
                        response.message,
                        response.options
                    );
                }
            }
        } catch (error) {
            logger.error("Message handling error:", error);
            ws.send(
                JSON.stringify({
                    type: "error",
                    data: {
                        message:
                            error instanceof Error
                                ? error.message
                                : "Unknown error occurred",
                        originalMessage: data.toString()
                    }
                })
            );
        }
    });

    ws.on("close", () => {
        removeClient(clientType, clientId, ws);
        logger.info(
            `Client disconnected - ${clientType.toUpperCase()} ID: ${clientId}`
        );
    });

    // Handle WebSocket protocol-level pings from older newt clients that do
    // not send application-level "newt/ping" messages. Update the site's
    // online state and lastPing timestamp so the offline checker treats them
    // the same as modern newt clients.
    if (clientType === "newt") {
        const newtClient = client as Newt;
        ws.on("ping", () => {
            if (!newtClient.siteId) return;
            // Record the ping in the accumulator instead of writing to the
            // database on every WS ping frame. The accumulator flushes all
            // pending pings in a single batched UPDATE every ~10s, which
            // prevents connection pool exhaustion under load (especially
            // with cross-region latency to the database).
            recordSitePing(newtClient.siteId);
        });
    }

    ws.on("error", (error: Error) => {
        logger.error(
            `WebSocket error for ${clientType.toUpperCase()} ID ${clientId}:`,
            error
        );
    });

    logger.info(
        `WebSocket connection established - ${clientType.toUpperCase()} ID: ${clientId}`
    );
};

// Router endpoint
router.get("/ws", (req: Request, res: Response) => {
    res.status(200).send("WebSocket endpoint");
});

// WebSocket upgrade handler
const handleWSUpgrade = (server: HttpServer): void => {
    server.on(
        "upgrade",
        async (request: WebSocketRequest, socket: Socket, head: Buffer) => {
            try {
                const url = new URL(
                    request.url || "",
                    `http://${request.headers.host}`
                );
                const token =
                    url.searchParams.get("token") ||
                    request.headers["sec-websocket-protocol"] ||
                    "";
                const userToken = url.searchParams.get("userToken") || "";
                let clientType = url.searchParams.get(
                    "clientType"
                ) as ClientType;

                if (!clientType) {
                    clientType = "newt";
                }

                if (
                    !token ||
                    !clientType ||
                    !["newt", "olm"].includes(clientType)
                ) {
                    logger.warn(
                        "Unauthorized connection attempt: invalid token or client type..."
                    );
                    socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
                    socket.destroy();
                    return;
                }

                const tokenPayload = await verifyToken(
                    token,
                    clientType,
                    userToken
                );
                if (!tokenPayload) {
                    logger.warn(
                        "Unauthorized connection attempt: invalid token..."
                    );
                    socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
                    socket.destroy();
                    return;
                }

                wss.handleUpgrade(
                    request,
                    socket,
                    head,
                    (ws: AuthenticatedWebSocket) => {
                        setupConnection(
                            ws,
                            tokenPayload.client,
                            tokenPayload.clientType
                        );
                    }
                );
            } catch (error) {
                logger.error("WebSocket upgrade error:", error);
                socket.write("HTTP/1.1 500 Internal Server Error\r\n\r\n");
                socket.destroy();
            }
        }
    );
};

// Disconnect a specific client and force them to reconnect
const disconnectClient = async (clientId: string): Promise<boolean> => {
    const mapKey = getClientMapKey(clientId);
    const clients = connectedClients.get(mapKey);

    if (!clients || clients.length === 0) {
        logger.debug(`No connections found for client ID: ${clientId}`);
        return false;
    }

    logger.info(
        `Disconnecting client ID: ${clientId} (${clients.length} connection(s))`
    );

    // Close all connections for this client
    clients.forEach((client) => {
        if (client.readyState === WebSocket.OPEN) {
            client.close(1000, "Disconnected by server");
        }
    });

    // Eagerly remove client — close event may not fire if socket already
    // CLOSING, leaving zombie entries.
    connectedClients.delete(mapKey);
    clientConfigVersions.delete(clientId);

    return true;
};

// Cleanup function for graceful shutdown
const cleanup = async (): Promise<void> => {
    try {
        // Close all WebSocket connections
        connectedClients.forEach((clients) => {
            clients.forEach((client) => {
                if (client.readyState === WebSocket.OPEN) {
                    client.terminate();
                }
            });
        });

        logger.info("WebSocket cleanup completed");
    } catch (error) {
        logger.error("Error during WebSocket cleanup:", error);
    }
};

export {
    router,
    handleWSUpgrade,
    sendToClient,
    sendToClientsBatch,
    broadcastToAllExcept,
    connectedClients,
    hasActiveConnections,
    getActiveNodes,
    disconnectClient,
    NODE_ID,
    cleanup,
    getClientConfigVersion
};
