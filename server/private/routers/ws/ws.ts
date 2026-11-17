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

import { Router, Request, Response } from "express";
import zlib from "zlib";
import { encodeHexLowerCase } from "@oslojs/encoding";
import { sha256 } from "@oslojs/crypto/sha2";
import { LRUCache } from "lru-cache";
import { Server as HttpServer } from "http";
import { WebSocket, WebSocketServer } from "ws";
import { Socket } from "net";
import {
    Newt,
    newts,
    Olm,
    olms,
    RemoteExitNode,
    remoteExitNodes
} from "@server/db";
import { eq, inArray } from "drizzle-orm";
import { db } from "@server/db";
import { recordSitePing } from "@server/routers/newt/pingAccumulator";
import { validateNewtSession } from "@server/auth/sessions/newt";
import { validateOlmSession } from "@server/auth/sessions/olm";
import logger from "@server/logger";
import redisManager, { regionalRedisManager } from "#private/lib/redis";
import privateConfig from "#private/lib/config";
import { v4 as uuidv4 } from "uuid";
import { validateRemoteExitNodeSession } from "#private/auth/sessions/remoteExitNode";
import { rateLimitService } from "#private/lib/rateLimit";
import { messageHandlers } from "@server/routers/ws/messageHandlers";
import { messageHandlers as privateMessageHandlers } from "#private/routers/ws/messageHandlers";
import {
    AuthenticatedWebSocket,
    BatchSendMessage,
    ClientType,
    WSMessage,
    TokenPayload,
    WebSocketRequest,
    RedisMessage,
    SendMessageOptions
} from "@server/routers/ws";
import { validateSessionById } from "@server/auth/sessions/app";
import { BridgeHandlers, WsGatewayBridge } from "#private/wsGateway/bridge";
import { AuthRequest, AuthResult } from "#private/wsGateway/protocol";

// Merge public and private message handlers
Object.assign(messageHandlers, privateMessageHandlers);

const MAX_PENDING_MESSAGES = 50; // Maximum messages to queue during connection setup

// Helper function to process a single message
const processMessage = async (
    client: Newt | Olm | RemoteExitNode | undefined,
    data: Buffer,
    isBinary: boolean,
    clientId: string,
    clientType: ClientType
): Promise<void> => {
    try {
        const messageBuffer = isBinary ? zlib.gunzipSync(data) : data;
        const message: WSMessage = JSON.parse(messageBuffer.toString());

        // logger.debug(
        //     `Processing message from ${clientType.toUpperCase()} ID: ${clientId}, type: ${message.type}`
        // );

        if (!message.type || typeof message.type !== "string") {
            throw new Error("Invalid message format: missing or invalid type");
        }

        // Check rate limiting with message type awareness
        const rateLimitResult = await rateLimitService.checkRateLimit(
            clientId,
            message.type, // Pass message type for granular limiting
            100, // max requests per window
            100, // max requests per message type per window
            60 * 1000 // window in milliseconds
        );
        if (rateLimitResult.isLimited) {
            const reason =
                rateLimitResult.reason === "global"
                    ? "too many messages"
                    : `too many '${message.type}' messages`;
            logger.debug(
                `Rate limit exceeded for ${clientType.toUpperCase()} ID: ${clientId} - ${reason}, ignoring message`
            );

            // Send rate limit error to client
            // ws.send(JSON.stringify({
            //     type: "rate_limit_error",
            //     data: {
            //         message: `Rate limit exceeded: ${reason}`,
            //         messageType: message.type,
            //         reason: rateLimitResult.reason
            //     }
            // }));
            return;
        }

        const handler = messageHandlers[message.type];
        if (!handler) {
            logger.debug(`No handler found for message type: ${message.type}`);
            return;
        }

        const response = await handler({
            message,
            client,
            clientType,
            sendToClient,
            broadcastToAllExcept
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
        logger.warn("Message handling error:", error);
        // ws.send(JSON.stringify({
        //     type: "error",
        //     data: {
        //         message: error instanceof Error ? error.message : "Unknown error occurred",
        //         originalMessage: data.toString()
        //     }
        // }));
    }
};

// Helper function to process pending messages
const processPendingMessages = async (
    ws: AuthenticatedWebSocket,
    clientId: string,
    clientType: ClientType
): Promise<void> => {
    if (!ws.pendingMessages || ws.pendingMessages.length === 0) {
        return;
    }

    logger.info(
        `Processing ${ws.pendingMessages.length} pending messages for ${clientType.toUpperCase()} ID: ${clientId}`
    );

    const jobs = [];
    for (const pending of ws.pendingMessages) {
        jobs.push(
            processMessage(
                ws.client,
                pending.data,
                pending.isBinary,
                clientId,
                clientType
            )
        );
    }

    await Promise.all(jobs);

    ws.pendingMessages = []; // Clear pending messages to prevent reprocessing
};

const router: Router = Router();
const wss: WebSocketServer = new WebSocketServer({ noServer: true });

// Generate unique node ID for this instance
const NODE_ID = uuidv4();
const REDIS_CHANNEL = "websocket_messages";
const REDIS_DIRECT_BATCH_SIZE = 250;
const REDIS_DIRECT_FLUSH_INTERVAL_MS = 10;

// Client tracking map (local to this node)
const connectedClients: Map<string, AuthenticatedWebSocket[]> = new Map();

// Config version tracking map (local to this node, resets on server restart)
const clientConfigVersions: Map<string, number> = new Map();

// Recovery tracking
let isRedisRecoveryInProgress = false;

// Connects this server to the standalone WebSocket gateways, when they're in
// use. Sockets can still connect here directly as well, so devices can be moved
// over to the gateways gradually.
let gatewayBridge: WsGatewayBridge | null = null;

// Devices on a gateway have no socket here to keep their row on, so frames look
// it up instead. Held briefly so that a newly connected device's row and any
// changes to it are picked up about as promptly as they were on connect.
const gatewayClients = new LRUCache<string, Newt | Olm | RemoteExitNode>({
    max: 200_000,
    ttl: 60 * 1000
});

interface RedisDirectBatchEntry {
    targetClientId: string;
    message: WSMessage;
    resolve: () => void;
}

let pendingRedisDirectMessages: RedisDirectBatchEntry[] = [];
let redisDirectFlushTimer: NodeJS.Timeout | null = null;

// Helper to get map key
const getClientMapKey = (clientId: string) => clientId;

// Redis keys (generalized)
const getConnectionsKey = (clientId: string) => `ws:connections:${clientId}`;
const getNodeConnectionsKey = (nodeId: string, clientId: string) =>
    `ws:node:${nodeId}:${clientId}`;
const getConfigVersionKey = (clientId: string) =>
    `ws:configVersion:${clientId}`;

const clearRedisDirectFlushTimer = (): void => {
    if (redisDirectFlushTimer) {
        clearTimeout(redisDirectFlushTimer);
        redisDirectFlushTimer = null;
    }
};

const publishDirectBatch = async (
    entries: RedisDirectBatchEntry[]
): Promise<void> => {
    const redisMessage: RedisMessage = {
        type: "direct-batch",
        id: uuidv4(),
        messages: entries.map((entry) => ({
            targetClientId: entry.targetClientId,
            message: entry.message
        })),
        fromNodeId: NODE_ID
    };

    await redisManager.publish(REDIS_CHANNEL, JSON.stringify(redisMessage));
};

const flushPendingRedisDirectMessages = async (): Promise<void> => {
    clearRedisDirectFlushTimer();

    if (pendingRedisDirectMessages.length === 0) {
        return;
    }

    const entries = pendingRedisDirectMessages;
    pendingRedisDirectMessages = [];

    if (!redisManager.isRedisEnabled()) {
        entries.forEach((entry) => entry.resolve());
        return;
    }

    for (let i = 0; i < entries.length; i += REDIS_DIRECT_BATCH_SIZE) {
        const batch = entries.slice(i, i + REDIS_DIRECT_BATCH_SIZE);
        try {
            await publishDirectBatch(batch);
        } catch (error) {
            logger.error(
                "Failed to send batched direct messages via Redis, messages may be lost:",
                error
            );
        } finally {
            batch.forEach((entry) => entry.resolve());
        }
    }
};

const enqueueRedisDirectMessage = async (
    targetClientId: string,
    message: WSMessage
): Promise<void> => {
    await new Promise<void>((resolve) => {
        pendingRedisDirectMessages.push({ targetClientId, message, resolve });

        if (pendingRedisDirectMessages.length >= REDIS_DIRECT_BATCH_SIZE) {
            void flushPendingRedisDirectMessages();
            return;
        }

        if (!redisDirectFlushTimer) {
            redisDirectFlushTimer = setTimeout(() => {
                void flushPendingRedisDirectMessages();
            }, REDIS_DIRECT_FLUSH_INTERVAL_MS);
        }
    });
};

// Initialize Redis subscription for cross-node messaging
const initializeRedisSubscription = async (): Promise<void> => {
    if (!redisManager.isRedisEnabled()) return;

    await redisManager.subscribe(
        REDIS_CHANNEL,
        async (channel: string, message: string) => {
            try {
                const redisMessage: RedisMessage = JSON.parse(message);

                // Ignore messages from this node
                if (redisMessage.fromNodeId === NODE_ID) return;

                if (
                    redisMessage.type === "direct" &&
                    redisMessage.targetClientId
                ) {
                    // Send to specific client on this node
                    await sendToClientLocal(
                        redisMessage.targetClientId,
                        redisMessage.message,
                        {},
                        redisMessage.message.configVersion
                    );
                } else if (
                    redisMessage.type === "direct-batch" &&
                    redisMessage.messages
                ) {
                    const undelivered =
                        await sendRedisDirectBatchToLocalClients(
                            redisMessage.messages
                        );
                    await forwardToGateways(redisMessage.id, undelivered);
                } else if (redisMessage.type === "broadcast") {
                    // Broadcast to all clients on this node except excluded
                    await broadcastToAllExceptLocal(
                        redisMessage.message,
                        redisMessage.excludeClientId
                    );
                    if (await claimGatewayForward(redisMessage.id)) {
                        await broadcastToGateways(
                            redisMessage.message,
                            redisMessage.excludeClientId,
                            redisMessage.options
                        );
                    }
                } else if (
                    redisMessage.type === "disconnect" &&
                    redisMessage.targetClientId
                ) {
                    // Close the client's connections if any are on this node
                    disconnectClientLocal(redisMessage.targetClientId);
                    if (await claimGatewayForward(redisMessage.id)) {
                        await gatewayBridge?.disconnect(
                            redisMessage.targetClientId
                        );
                    }
                }
            } catch (error) {
                logger.error("Error processing Redis message:", error);
            }
        }
    );
};

// Simple self-healing recovery function
// Each node is responsible for restoring its own connection state to Redis
// This approach is more efficient than cross-node coordination because:
// 1. Each node knows its own connections (source of truth)
// 2. No network overhead from broadcasting state between nodes
// 3. No race conditions from simultaneous updates
// 4. Redis becomes eventually consistent as each node restores independently
// 5. Simpler logic with better fault tolerance
const recoverConnectionState = async (): Promise<void> => {
    if (isRedisRecoveryInProgress) {
        logger.debug("Redis recovery already in progress, skipping");
        return;
    }

    isRedisRecoveryInProgress = true;
    logger.info("Starting Redis connection state recovery...");

    try {
        // Each node simply restores its own local connections to Redis
        // This is the source of truth - no need for cross-node coordination
        await restoreLocalConnectionsToRedis();

        logger.info(
            "Redis connection state recovery completed - restored local state"
        );
    } catch (error) {
        logger.error("Error during Redis recovery:", error);
    } finally {
        isRedisRecoveryInProgress = false;
    }
};

const restoreLocalConnectionsToRedis = async (): Promise<void> => {
    if (!redisManager.isRedisEnabled()) return;

    logger.info("Restoring local connections to Redis...");
    let restoredCount = 0;

    try {
        // Restore all current local connections to Redis
        for (const [clientId, clients] of connectedClients.entries()) {
            const validClients = clients.filter(
                (client) => client.readyState === WebSocket.OPEN
            );

            if (validClients.length > 0) {
                // Add this node to the client's connection list
                await redisManager.sadd(getConnectionsKey(clientId), NODE_ID);

                // Store individual connection details
                for (const client of validClients) {
                    if (client.connectionId) {
                        await redisManager.hset(
                            getNodeConnectionsKey(NODE_ID, clientId),
                            client.connectionId,
                            Date.now().toString()
                        );
                    }
                }
                restoredCount++;
            }
        }

        logger.info(`Restored ${restoredCount} client connections to Redis`);
    } catch (error) {
        logger.error("Failed to restore local connections to Redis:", error);
    }
};

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

    const configVersion = await initClientConfigVersion(clientId);

    // Set config version on websocket
    ws.configVersion = configVersion;

    // Add to Redis tracking if enabled
    if (redisManager.isRedisEnabled()) {
        try {
            await redisManager.sadd(getConnectionsKey(clientId), NODE_ID);
            await redisManager.hset(
                getNodeConnectionsKey(NODE_ID, clientId),
                connectionId,
                Date.now().toString()
            );
        } catch (error) {
            logger.error(
                "Failed to add client to Redis tracking (connection still functional locally):",
                error
            );
        }
    }

    logger.info(
        `Client added to tracking - ${clientType.toUpperCase()} ID: ${clientId}, Connection ID: ${connectionId}, Total connections: ${existingClients.length}, Config version: ${configVersion}`
    );
};

// Get or initialize the config version of a connecting client
const initClientConfigVersion = async (clientId: string): Promise<number> => {
    let configVersion = 0;

    // Check Redis first if enabled
    if (redisManager.isRedisEnabled()) {
        try {
            const redisVersion = await redisManager.get(
                getConfigVersionKey(clientId)
            );
            if (redisVersion !== null) {
                configVersion = parseInt(redisVersion, 10);
                // Sync to local cache
                clientConfigVersions.set(clientId, configVersion);
            } else if (!clientConfigVersions.has(clientId)) {
                // No version in Redis or local cache, initialize to 0
                await redisManager.set(getConfigVersionKey(clientId), "0");
                clientConfigVersions.set(clientId, 0);
            } else {
                // Use local cache version and sync to Redis
                configVersion = clientConfigVersions.get(clientId) || 0;
                await redisManager.set(
                    getConfigVersionKey(clientId),
                    configVersion.toString()
                );
            }
        } catch (error) {
            logger.error("Failed to get/set config version in Redis:", error);
            // Fall back to local cache
            if (!clientConfigVersions.has(clientId)) {
                clientConfigVersions.set(clientId, 0);
            }
            configVersion = clientConfigVersions.get(clientId) || 0;
        }
    } else {
        // Redis not enabled, use local cache only
        if (!clientConfigVersions.has(clientId)) {
            clientConfigVersions.set(clientId, 0);
        }
        configVersion = clientConfigVersions.get(clientId) || 0;
    }

    return configVersion;
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
        // Remove clientId from clientConfigVersions on disconnect — prevents
        // unbounded memory growth from stale entries.
        clientConfigVersions.delete(clientId);

        if (redisManager.isRedisEnabled()) {
            try {
                await redisManager.srem(getConnectionsKey(clientId), NODE_ID);
                await redisManager.del(
                    getNodeConnectionsKey(NODE_ID, clientId)
                );
            } catch (error) {
                logger.error(
                    "Failed to remove client from Redis tracking (cleanup will occur on recovery):",
                    error
                );
            }
        }

        logger.info(
            `All connections removed for ${clientType.toUpperCase()} ID: ${clientId}`
        );
    } else {
        connectedClients.set(mapKey, updatedClients);

        if (redisManager.isRedisEnabled() && ws.connectionId) {
            try {
                await redisManager.hdel(
                    getNodeConnectionsKey(NODE_ID, clientId),
                    ws.connectionId
                );
            } catch (error) {
                logger.error(
                    "Failed to remove specific connection from Redis tracking:",
                    error
                );
            }
        }

        logger.info(
            `Connection removed - ${clientType.toUpperCase()} ID: ${clientId}, Remaining connections: ${updatedClients.length}`
        );
    }
};

// Helper to get the current config version for a client
const getClientConfigVersion = async (
    clientId: string
): Promise<number | undefined> => {
    // Try Redis first if available
    if (redisManager.isRedisEnabled()) {
        try {
            const redisVersion = await redisManager.get(
                getConfigVersionKey(clientId)
            );
            if (redisVersion !== null) {
                const version = parseInt(redisVersion, 10);
                // Sync local cache with Redis
                clientConfigVersions.set(clientId, version);
                return version;
            }
        } catch (error) {
            logger.error("Failed to get config version from Redis:", error);
        }
    }

    // Fall back to local cache
    return clientConfigVersions.get(clientId);
};

// Helper to increment and get the new config version for a client
const incrementClientConfigVersion = async (
    clientId: string
): Promise<number> => {
    let newVersion: number;

    if (redisManager.isRedisEnabled()) {
        try {
            // Use Redis INCR for atomic increment across nodes
            newVersion = await redisManager.incr(getConfigVersionKey(clientId));
            // Sync local cache
            clientConfigVersions.set(clientId, newVersion);
            return newVersion;
        } catch (error) {
            logger.error("Failed to increment config version in Redis:", error);
            // Fall through to local increment
        }
    }

    // Local increment
    const currentVersion = clientConfigVersions.get(clientId) || 0;
    newVersion = currentVersion + 1;
    clientConfigVersions.set(clientId, newVersion);
    return newVersion;
};

// Local message sending (within this node)
const sendToClientLocal = async (
    clientId: string,
    message: WSMessage,
    options: SendMessageOptions = {},
    preResolvedConfigVersion?: number
): Promise<boolean> => {
    const mapKey = getClientMapKey(clientId);
    const clients = connectedClients.get(mapKey);
    if (!clients || clients.length === 0) {
        return false;
    }

    // Handle config version
    const configVersion =
        preResolvedConfigVersion ?? (await getClientConfigVersion(clientId));

    // Add config version to message
    const messageWithVersion = {
        ...message,
        configVersion
    };

    const messageString = JSON.stringify(messageWithVersion);
    if (options.compress) {
        // logger.debug(
        //     `Message size before compression: ${messageString.length} bytes`
        // );
        const compressed = zlib.gzipSync(Buffer.from(messageString, "utf8"));
        // logger.debug(
        //     `Message size after compression: ${compressed.length} bytes`
        // );
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

// Returns the entries that had no socket on this node
const sendRedisDirectBatchToLocalClients = async (
    entries: { targetClientId: string; message: WSMessage }[]
): Promise<{ targetClientId: string; message: WSMessage }[]> => {
    const jobs = entries.map((entry) =>
        sendToClientLocal(
            entry.targetClientId,
            entry.message,
            {},
            entry.message.configVersion
        )
    );
    const sent = await Promise.all(jobs);
    return entries.filter((_, index) => !sent[index]);
};

const encodeForGateway = (
    message: WSMessage,
    options: SendMessageOptions = {}
): { data: string | Buffer; isBinary: boolean } => {
    const messageString = JSON.stringify(message);
    return options.compress
        ? {
              data: zlib.gzipSync(Buffer.from(messageString, "utf8")),
              isBinary: true
          }
        : { data: messageString, isBinary: false };
};

// Hands messages to the gateways in this region, and returns whether each one's
// client has a socket on them
const deliverToGateways = async (
    entries: {
        clientId: string;
        message: WSMessage;
        options?: SendMessageOptions;
    }[]
): Promise<boolean[]> => {
    if (!gatewayBridge || !regionalRedisManager.isRedisEnabled()) {
        return entries.map(() => false);
    }

    try {
        return await gatewayBridge.deliver(
            entries.map(({ clientId, message, options }) => ({
                clientId,
                ...encodeForGateway(message, options)
            }))
        );
    } catch (error) {
        logger.error("Failed to hand messages to the gateways:", error);
        return entries.map(() => false);
    }
};

// Every Pangolin in a region gets the pub/sub copy of a cross-region message
// but they share the gateways, so only the one that claims it passes it on
const claimGatewayForward = async (id?: string): Promise<boolean> => {
    if (!gatewayBridge || !regionalRedisManager.isRedisEnabled()) {
        return false;
    }
    try {
        return !id || (await gatewayBridge.claimForward(id));
    } catch (error) {
        logger.error("Failed to claim a message for the gateways:", error);
        return false;
    }
};

const forwardToGateways = async (
    id: string | undefined,
    entries: { targetClientId: string; message: WSMessage }[]
): Promise<void> => {
    if (entries.length === 0 || !(await claimGatewayForward(id))) {
        return;
    }
    await deliverToGateways(
        entries.map(({ targetClientId, message }) => ({
            clientId: targetClientId,
            message
        }))
    );
};

// The gateways only pass bytes along, so unlike a local broadcast this can't
// give each client its own config version
const broadcastToGateways = async (
    message: WSMessage,
    excludeClientId?: string,
    options?: SendMessageOptions
): Promise<void> => {
    if (!gatewayBridge || !regionalRedisManager.isRedisEnabled()) {
        return;
    }
    const { data, isBinary } = encodeForGateway(message, options);
    await gatewayBridge.broadcast(excludeClientId, data, isBinary);
};

const broadcastToAllExceptLocal = async (
    message: WSMessage,
    excludeClientId?: string,
    options: SendMessageOptions = {}
): Promise<void> => {
    const sendPlans = await Promise.all(
        Array.from(connectedClients.entries()).map(
            async ([mapKey, clients]) => {
                const clientId = mapKey; // mapKey is the clientId
                if (excludeClientId && clientId === excludeClientId) {
                    return null;
                }

                let configVersion = await getClientConfigVersion(clientId);
                if (options.incrementConfigVersion) {
                    configVersion =
                        await incrementClientConfigVersion(clientId);
                }

                return {
                    clients,
                    messageWithVersion: {
                        ...message,
                        configVersion
                    }
                };
            }
        )
    );

    for (const plan of sendPlans) {
        if (!plan) {
            continue;
        }

        if (options.compress) {
            const compressed = zlib.gzipSync(
                Buffer.from(JSON.stringify(plan.messageWithVersion), "utf8")
            );
            plan.clients.forEach((client) => {
                if (client.readyState === WebSocket.OPEN) {
                    client.send(compressed);
                }
            });
        } else {
            const messageString = JSON.stringify(plan.messageWithVersion);
            plan.clients.forEach((client) => {
                if (client.readyState === WebSocket.OPEN) {
                    client.send(messageString);
                }
            });
        }
    }
};

// Cross-node message sending (via Redis)
const sendToClient = async (
    clientId: string,
    message: WSMessage,
    options: SendMessageOptions = {}
): Promise<boolean> => {
    let configVersion = await getClientConfigVersion(clientId);
    if (options.incrementConfigVersion) {
        configVersion = await incrementClientConfigVersion(clientId);
    }

    logger.debug(
        `sendToClient: Message type ${message.type} sent to clientId ${clientId} (new configVersion: ${configVersion})`
    );

    // Try to send locally first
    const localSent = await sendToClientLocal(
        clientId,
        message,
        options,
        configVersion
    );

    if (!localSent) {
        const [gatewaySent] = await deliverToGateways([
            { clientId, message: { ...message, configVersion }, options }
        ]);
        if (gatewaySent) {
            return true;
        }
    }

    // Only send via Redis if the client is not connected locally and Redis is enabled
    if (!localSent && redisManager.isRedisEnabled()) {
        try {
            await enqueueRedisDirectMessage(clientId, {
                ...message,
                configVersion
            });
        } catch (error) {
            logger.error(
                "Failed to queue batched direct message for Redis delivery, message may be lost:",
                error
            );
            // Continue execution - local delivery already attempted
        }
    } else if (!localSent && !redisManager.isRedisEnabled()) {
        // Redis is disabled or unavailable - log that we couldn't deliver to remote nodes
        logger.debug(
            `Could not deliver message to ${clientId} - not connected locally and Redis unavailable`
        );
    }

    return localSent;
};

const sendToClientsBatch = async (
    entries: BatchSendMessage[]
): Promise<void> => {
    if (entries.length === 0) {
        return;
    }

    const undeliveredEntries: {
        clientId: string;
        message: WSMessage;
        options?: SendMessageOptions;
    }[] = [];
    const clientsWithIncrement = new Set(
        entries
            .filter((entry) => !!entry.options?.incrementConfigVersion)
            .map((entry) => entry.clientId)
    );
    const nonIncrementOnlyClientIds = Array.from(
        new Set(
            entries
                .map((entry) => entry.clientId)
                .filter((clientId) => !clientsWithIncrement.has(clientId))
        )
    );
    const stableConfigVersionByClient = new Map<string, number | undefined>(
        await Promise.all(
            nonIncrementOnlyClientIds.map(
                async (clientId) =>
                    [clientId, await getClientConfigVersion(clientId)] as const
            )
        )
    );

    // Issue all increments at once so Redis receives them back to back on one
    // connection (in entry order) instead of waiting a round trip per entry
    const configVersions = await Promise.all(
        entries.map((entry) =>
            entry.options?.incrementConfigVersion
                ? incrementClientConfigVersion(entry.clientId)
                : stableConfigVersionByClient.get(entry.clientId)
        )
    );

    for (const [index, entry] of entries.entries()) {
        const options = entry.options || {};
        const { clientId, message } = entry;

        const configVersion = configVersions[index];

        logger.debug(
            `sendToClientsBatch: Message type ${message.type} queued for clientId ${clientId} (new configVersion: ${configVersion})`
        );

        const localSent = await sendToClientLocal(
            clientId,
            message,
            options,
            configVersion
        );

        if (!localSent) {
            undeliveredEntries.push({
                clientId,
                message: { ...message, configVersion },
                options
            });
        }
    }

    const gatewaySent = await deliverToGateways(undeliveredEntries);
    const remoteEntries = undeliveredEntries
        .filter((_, index) => !gatewaySent[index])
        .map(({ clientId, message }) => ({
            targetClientId: clientId,
            message
        }));

    if (remoteEntries.length === 0) {
        return;
    }

    if (!redisManager.isRedisEnabled()) {
        logger.debug(
            `Could not deliver ${remoteEntries.length} batch messages - not connected locally and Redis unavailable`
        );
        return;
    }

    for (let i = 0; i < remoteEntries.length; i += REDIS_DIRECT_BATCH_SIZE) {
        const messages = remoteEntries.slice(i, i + REDIS_DIRECT_BATCH_SIZE);
        try {
            const redisMessage: RedisMessage = {
                type: "direct-batch",
                id: uuidv4(),
                messages,
                fromNodeId: NODE_ID
            };

            await redisManager.publish(
                REDIS_CHANNEL,
                JSON.stringify(redisMessage)
            );
        } catch (error) {
            logger.error(
                "Failed to send explicit direct batch via Redis, messages may be lost:",
                error
            );
        }
    }
};

const broadcastToAllExcept = async (
    message: WSMessage,
    excludeClientId?: string,
    options: SendMessageOptions = {}
): Promise<void> => {
    // Broadcast locally
    await broadcastToAllExceptLocal(message, excludeClientId, options);

    // Claimed here so the other Pangolins in this region don't send it to the
    // gateways a second time when they get the pub/sub copy
    const id = uuidv4();
    if (await claimGatewayForward(id)) {
        try {
            await broadcastToGateways(message, excludeClientId, options);
        } catch (error) {
            logger.error("Failed to broadcast to the gateways:", error);
        }
    }

    // If Redis is enabled, also broadcast via Redis pub/sub to other nodes
    // Note: For broadcasts, we include the options so remote nodes can handle versioning
    if (redisManager.isRedisEnabled()) {
        try {
            const redisMessage: RedisMessage = {
                type: "broadcast",
                id,
                excludeClientId,
                message,
                fromNodeId: NODE_ID,
                options
            };

            await redisManager.publish(
                REDIS_CHANNEL,
                JSON.stringify(redisMessage)
            );
        } catch (error) {
            logger.error(
                "Failed to broadcast message via Redis, remote nodes may not receive it:",
                error
            );
            // Continue execution - local broadcast already completed
        }
    } else {
        logger.debug(
            "Redis unavailable - broadcast limited to local node only"
        );
    }
};

// Check if a client has active connections across all nodes
const hasActiveConnections = async (clientId: string): Promise<boolean> => {
    // Gateways report every open newt socket as a ping, so for those the
    // last ping time already answers this
    if (!redisManager.isRedisEnabled() || gatewayBridge) {
        const mapKey = getClientMapKey(clientId);
        const clients = connectedClients.get(mapKey);
        return !!(clients && clients.length > 0);
    }

    const activeNodes = await redisManager.smembers(
        getConnectionsKey(clientId)
    );
    return activeNodes.length > 0;
};

// Get all active nodes for a client
const getActiveNodes = async (
    clientType: ClientType,
    clientId: string
): Promise<string[]> => {
    if (!redisManager.isRedisEnabled()) {
        const mapKey = getClientMapKey(clientId);
        const clients = connectedClients.get(mapKey);
        return clients && clients.length > 0 ? [NODE_ID] : [];
    }

    return await redisManager.smembers(getConnectionsKey(clientId));
};

// Sessions are stored under the hash of their token
const tokenToSessionId = (token: string): string =>
    encodeHexLowerCase(sha256(new TextEncoder().encode(token)));

const verifySession = async (
    sessionId: string,
    clientType: ClientType,
    userSessionId: string
): Promise<TokenPayload | null> => {
    if (clientType === "newt") {
        const { session, newt } = await validateNewtSession(sessionId);
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
        const { session, olm } = await validateOlmSession(sessionId);
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
                await validateSessionById(userSessionId);
            if (!userSession || !user) {
                return null;
            }
            if (user.userId !== olm.userId) {
                return null;
            }
        }

        return { client: existingOlm[0], session, clientType };
    } else if (clientType === "remoteExitNode") {
        const { session, remoteExitNode } =
            await validateRemoteExitNodeSession(sessionId);
        if (!session || !remoteExitNode) {
            return null;
        }
        const existingRemoteExitNode = await db
            .select()
            .from(remoteExitNodes)
            .where(
                eq(
                    remoteExitNodes.remoteExitNodeId,
                    remoteExitNode.remoteExitNodeId
                )
            );
        if (!existingRemoteExitNode || !existingRemoteExitNode[0]) {
            return null;
        }
        return { client: existingRemoteExitNode[0], session, clientType };
    }

    return null;
};

// Token verification middleware
const verifyToken = async (
    token: string,
    clientType: ClientType,
    userToken: string
): Promise<TokenPayload | null> => {
    try {
        return await verifySession(
            tokenToSessionId(token),
            clientType,
            tokenToSessionId(userToken)
        );
    } catch (error) {
        logger.error("Token verification failed:", error);
        return null;
    }
};

const getClientId = (
    client: Newt | Olm | RemoteExitNode,
    clientType: ClientType
): string => {
    if (clientType === "newt") {
        return (client as Newt).newtId;
    } else if (clientType === "olm") {
        return (client as Olm).olmId;
    } else if (clientType === "remoteExitNode") {
        return (client as RemoteExitNode).remoteExitNodeId;
    }
    throw new Error(`Unknown client type: ${clientType}`);
};

const setupConnection = async (
    ws: AuthenticatedWebSocket,
    client: Newt | Olm | RemoteExitNode,
    clientType: ClientType
): Promise<void> => {
    logger.info("Establishing websocket connection");
    if (!client) {
        logger.error("Connection attempt without client");
        return ws.terminate();
    }

    ws.client = client;
    ws.clientType = clientType;
    ws.isFullyConnected = false;
    ws.pendingMessages = [];

    // Get client ID first
    const clientId = getClientId(client, clientType);

    // Set up message handler FIRST to prevent race condition
    ws.on("message", async (data, isBinary) => {
        if (!ws.isFullyConnected) {
            // Queue message for later processing with limits
            ws.pendingMessages = ws.pendingMessages || [];

            if (ws.pendingMessages.length >= MAX_PENDING_MESSAGES) {
                logger.warn(
                    `Too many pending messages for ${clientType.toUpperCase()} ID: ${clientId}, dropping oldest message`
                );
                ws.pendingMessages.shift(); // Remove oldest message
            }

            logger.debug(
                `Queueing message from ${clientType.toUpperCase()} ID: ${clientId} (connection not fully established)`
            );
            ws.pendingMessages.push({ data: data as Buffer, isBinary });
            return;
        }

        await processMessage(
            ws.client,
            data as Buffer,
            isBinary,
            clientId,
            clientType
        );
    });

    // Set up other event handlers before async operations
    ws.on("close", async () => {
        // Clear any pending messages to prevent memory leaks
        if (ws.pendingMessages) {
            ws.pendingMessages = [];
        }
        await removeClient(clientType, clientId, ws);
        logger.info(
            `Client disconnected - ${clientType.toUpperCase()} ID: ${clientId}`
        );
    });

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

    try {
        await addClient(clientType, clientId, ws);

        // Mark connection as fully established
        ws.isFullyConnected = true;

        logger.info(
            `WebSocket connection fully established and ready - ${clientType.toUpperCase()} ID: ${clientId}`
        );

        // Process any messages that were queued while connection was being established
        await processPendingMessages(ws, clientId, clientType);
    } catch (error) {
        logger.error(
            `Failed to fully establish connection for ${clientType.toUpperCase()} ID: ${clientId}:`,
            error
        );
        // ws.send(JSON.stringify({
        //     type: "connection_error",
        //     data: {
        //         message: "Failed to establish connection"
        //     }
        // }));
        ws.terminate();
        return;
    }
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
                    !["newt", "olm", "remoteExitNode"].includes(clientType)
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
                    logger.debug(
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

// Add periodic connection state sync to handle Redis disconnections/reconnections
const startPeriodicStateSync = (): void => {
    // Lightweight sync every 5 minutes - just restore our own state
    setInterval(
        async () => {
            if (redisManager.isRedisEnabled() && !isRedisRecoveryInProgress) {
                try {
                    await restoreLocalConnectionsToRedis();
                    logger.debug("Periodic connection state sync completed");
                } catch (error) {
                    logger.error(
                        "Error during periodic connection state sync:",
                        error
                    );
                }
            }
        },
        5 * 60 * 1000
    ); // 5 minutes

    // Cleanup stale connections every 15 minutes
    setInterval(
        async () => {
            if (redisManager.isRedisEnabled()) {
                try {
                    await cleanupStaleConnections();
                    logger.debug("Periodic connection cleanup completed");
                } catch (error) {
                    logger.error(
                        "Error during periodic connection cleanup:",
                        error
                    );
                }
            }
        },
        15 * 60 * 1000
    ); // 15 minutes
};

const cleanupStaleConnections = async (): Promise<void> => {
    if (!redisManager.isRedisEnabled()) return;

    try {
        const nodeKeys =
            (await redisManager.getClient()?.keys(`ws:node:${NODE_ID}:*`)) ||
            [];

        for (const nodeKey of nodeKeys) {
            const connections = await redisManager.hgetall(nodeKey);
            const clientId = nodeKey.replace(`ws:node:${NODE_ID}:`, "");
            const localClients = connectedClients.get(clientId) || [];
            const localConnectionIds = localClients
                .filter((client) => client.readyState === WebSocket.OPEN)
                .map((client) => client.connectionId)
                .filter(Boolean);

            // Remove Redis entries for connections that no longer exist locally
            for (const [connectionId, timestamp] of Object.entries(
                connections
            )) {
                if (!localConnectionIds.includes(connectionId)) {
                    await redisManager.hdel(nodeKey, connectionId);
                    logger.debug(
                        `Cleaned up stale connection: ${connectionId} for client: ${clientId}`
                    );
                }
            }

            // If no connections remain for this client, remove from Redis entirely
            const remainingConnections = await redisManager.hgetall(nodeKey);
            if (Object.keys(remainingConnections).length === 0) {
                await redisManager.srem(getConnectionsKey(clientId), NODE_ID);
                await redisManager.del(nodeKey);
                logger.debug(
                    `Cleaned up empty connection tracking for client: ${clientId}`
                );
            }
        }
    } catch (error) {
        logger.error("Error cleaning up stale connections:", error);
    }
};

const gatewayClientKey = (clientType: ClientType, clientId: string) =>
    `${clientType}:${clientId}`;

const loadGatewayClients = async (
    clientType: ClientType,
    clientIds: string[]
): Promise<void> => {
    if (clientType === "newt") {
        const rows = await db
            .select()
            .from(newts)
            .where(inArray(newts.newtId, clientIds));
        rows.forEach((row) =>
            gatewayClients.set(gatewayClientKey(clientType, row.newtId), row)
        );
    } else if (clientType === "olm") {
        const rows = await db
            .select()
            .from(olms)
            .where(inArray(olms.olmId, clientIds));
        rows.forEach((row) =>
            gatewayClients.set(gatewayClientKey(clientType, row.olmId), row)
        );
    } else if (clientType === "remoteExitNode") {
        const rows = await db
            .select()
            .from(remoteExitNodes)
            .where(inArray(remoteExitNodes.remoteExitNodeId, clientIds));
        rows.forEach((row) =>
            gatewayClients.set(
                gatewayClientKey(clientType, row.remoteExitNodeId),
                row
            )
        );
    }
};

const authenticateGatewayClient = async (
    request: AuthRequest
): Promise<AuthResult> => {
    const { clientType, sessionId, userSessionId } = request;

    const payload = await verifySession(sessionId, clientType, userSessionId);
    if (!payload) {
        return { ok: false };
    }

    const clientId = getClientId(payload.client, clientType);
    gatewayClients.set(gatewayClientKey(clientType, clientId), payload.client);
    await initClientConfigVersion(clientId);

    return {
        ok: true,
        clientId,
        siteId:
            clientType === "newt" ? (payload.client as Newt).siteId : undefined
    };
};

const gatewayHandlers: BridgeHandlers = {
    authenticate: authenticateGatewayClient,

    prepareFrames: async (frames) => {
        const missing = new Map<ClientType, Set<string>>();
        for (const { clientType, clientId } of frames) {
            if (!gatewayClients.has(gatewayClientKey(clientType, clientId))) {
                const ids = missing.get(clientType) ?? new Set();
                ids.add(clientId);
                missing.set(clientType, ids);
            }
        }
        await Promise.all(
            Array.from(missing, ([clientType, ids]) =>
                loadGatewayClients(clientType, Array.from(ids))
            )
        );
    },

    handleFrame: async ({ clientId, clientType, data, isBinary }) => {
        const key = gatewayClientKey(clientType, clientId);
        if (!gatewayClients.has(key)) {
            await loadGatewayClients(clientType, [clientId]);
        }
        const client = gatewayClients.get(key);
        if (!client) {
            logger.debug(
                `Ignoring gateway frame from unknown ${clientType} ${clientId}`
            );
            return;
        }
        await processMessage(client, data, isBinary, clientId, clientType);
    },

    handleSiteLiveness: (siteIds) => {
        for (const siteId of siteIds) {
            recordSitePing(siteId);
        }
    }
};

// Initialize Redis subscription when the module is loaded
if (redisManager.isRedisEnabled()) {
    initializeRedisSubscription().catch((error) => {
        logger.error("Failed to initialize Redis subscription:", error);
    });

    // Register recovery callback with Redis manager
    // When Redis reconnects, each node simply restores its own local state
    redisManager.onReconnection(async () => {
        logger.info("Redis reconnected, starting WebSocket state recovery...");
        await recoverConnectionState();
    });

    // Start periodic state synchronization
    startPeriodicStateSync();

    logger.info(
        `WebSocket handler initialized with Redis support - Node ID: ${NODE_ID}`
    );
} else {
    logger.debug("WebSocket handler initialized in local mode");
}

if (privateConfig.getRawPrivateConfig().flags.enable_ws_gateway) {
    const redis = regionalRedisManager.getClient();
    if (!redis) {
        throw new Error(
            "flags.enable_ws_gateway needs flags.enable_redis and redis.regional_redis"
        );
    }

    gatewayBridge = new WsGatewayBridge({
        redis,
        nodeId: NODE_ID,
        handlers: gatewayHandlers,
        logger
    });
    gatewayBridge.start();
    logger.info("WebSocket gateway bridge started");
}

// Stops taking frames from the gateways, and finishes the ones already started
const stopGatewayBridge = async (): Promise<void> => {
    await gatewayBridge?.stop();
};

// Disconnect a specific client on every node and force them to reconnect
const disconnectClient = async (clientId: string): Promise<boolean> => {
    const localDisconnected = disconnectClientLocal(clientId);

    // Claimed here so the other Pangolins in this region don't disconnect the
    // client a second time, possibly after it has reconnected
    const id = uuidv4();
    if (await claimGatewayForward(id)) {
        try {
            await gatewayBridge!.disconnect(clientId);
        } catch (error) {
            logger.error(
                `Failed to disconnect client ID ${clientId} from the gateways:`,
                error
            );
        }
    }

    if (!redisManager.isRedisEnabled()) {
        return localDisconnected;
    }

    try {
        // Flush queued direct messages first so anything sent to this client
        // just before (e.g. olm/terminate) reaches the other nodes ahead of
        // the disconnect on the same channel.
        await flushPendingRedisDirectMessages();

        const redisMessage: RedisMessage = {
            type: "disconnect",
            id,
            targetClientId: clientId,
            fromNodeId: NODE_ID
        };
        await redisManager.publish(REDIS_CHANNEL, JSON.stringify(redisMessage));
        return true;
    } catch (error) {
        logger.error(
            `Failed to publish disconnect for client ID ${clientId} via Redis:`,
            error
        );
        return localDisconnected;
    }
};

// Disconnect a specific client's connections on this node only
const disconnectClientLocal = (clientId: string): boolean => {
    const mapKey = getClientMapKey(clientId);
    const clients = connectedClients.get(mapKey);

    if (!clients || clients.length === 0) {
        logger.debug(`No local connections found for client ID: ${clientId}`);
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

    // Eagerly remove client — close event may not fire if socket is already
    // CLOSING, leaving zombie entries.
    connectedClients.delete(mapKey);
    clientConfigVersions.delete(clientId);

    return true;
};

// Cleanup function for graceful shutdown
const cleanup = async (): Promise<void> => {
    try {
        await flushPendingRedisDirectMessages();

        // Close all WebSocket connections
        connectedClients.forEach((clients) => {
            clients.forEach((client) => {
                if (client.readyState === WebSocket.OPEN) {
                    client.terminate();
                }
            });
        });

        // Clean up Redis tracking for this node
        if (redisManager.isRedisEnabled()) {
            const keys =
                (await redisManager
                    .getClient()
                    ?.keys(`ws:node:${NODE_ID}:*`)) || [];
            if (keys.length > 0) {
                await Promise.all(keys.map((key) => redisManager.del(key)));
            }
        }

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
    stopGatewayBridge,
    getClientConfigVersion
};
