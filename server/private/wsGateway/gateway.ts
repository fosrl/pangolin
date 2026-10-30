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

import { createHash, randomUUID } from "crypto";
import http from "http";
import { Socket } from "net";
import Redis, { ChainableCommander, RedisOptions } from "ioredis";
import { WebSocket, WebSocketServer } from "ws";
import {
    AUTH_STREAM,
    AUTH_STREAM_MAX_LENGTH,
    AUTH_TIMEOUT_MS,
    AuthResult,
    decodeOutbound,
    encodeAuthRequestFields,
    encodeMessageFields,
    encodeSiteLivenessFields,
    GatewayClientType,
    INBOUND_STREAM,
    INBOUND_STREAM_MAX_LENGTH,
    LIVENESS_INTERVAL_MS,
    OUTBOUND_STREAM,
    OutboundEntry,
    OutboundKind,
    presenceKey,
    PRESENCE_TTL_SECONDS
} from "./protocol";

export interface GatewayLogger {
    info(message: string): void;
    warn(message: string): void;
    error(message: string, error?: unknown): void;
}

export interface GatewayOptions {
    port: number;
    redis: RedisOptions;
    logger: GatewayLogger;
    // How long shutdown spreads closing the sockets over, so the devices don't
    // all reconnect in the same instant
    drainMs?: number;
    // Exposed for tests, which can't wait for a real interval
    livenessIntervalMs?: number;
}

interface GatewaySocket extends WebSocket {
    clientId: string;
    clientType: GatewayClientType;
    connectionId: string;
    siteId?: number | null;
    isAlive: boolean;
    windowStart: number;
    windowCount: number;
}

interface PendingAuth {
    resolve: (result: AuthResult | null) => void;
    timer: NodeJS.Timeout;
}

type QueuedCommand = (pipeline: ChainableCommander) => void;

interface QueueEntry {
    command: QueuedCommand;
    bytes: number;
}

const CLIENT_TYPES: GatewayClientType[] = ["newt", "olm", "remoteExitNode"];

const WRITE_BATCH_SIZE = 500;
const WRITE_FLUSH_INTERVAL_MS = 2;
// Rides out a Redis outage without losing frames, up to this much memory
const MAX_QUEUED_BYTES = 512 * 1024 * 1024;
// Roughly what an entry costs on top of its payload
const QUEUE_ENTRY_OVERHEAD_BYTES = 256;
const OUTBOUND_READ_COUNT = 1000;
const OUTBOUND_BLOCK_MS = 5000;
const REDIS_RETRY_DELAY_MS = 1000;
// Pangolin applies the real per-client limits. This only stops one device from
// filling the shared queue, so it sits above them.
const MAX_FRAMES_PER_MINUTE = 600;
// A socket this far behind is not reading, and buffering more for it would only
// grow the gateway
const MAX_BUFFERED_BYTES = 8 * 1024 * 1024;
const MAX_PAYLOAD_BYTES = 16 * 1024 * 1024;
const DRAIN_BATCH_INTERVAL_MS = 100;
// Devices past this retry, rather than a reconnect storm or a flood of bad
// tokens piling up behind a Pangolin that's already busy
const MAX_PENDING_AUTH = 50_000;

// Only acts if the entry is still this socket's, so one that closes late leaves
// a newer connection alone. ARGV[2] is another socket for the same client on
// this gateway, if there is one, to take over the entry.
const REMOVE_PRESENCE_SCRIPT = `
if redis.call('GET', KEYS[1]) ~= ARGV[1] then
    return 0
end
if ARGV[2] ~= '' then
    return redis.call('SET', KEYS[1], ARGV[2], 'EX', ARGV[3])
end
return redis.call('DEL', KEYS[1])
`;

const hashToken = (token: string) =>
    createHash("sha256").update(token).digest("hex");

/**
 * Terminates device WebSockets and does nothing else. Frames go to Pangolin
 * through a Redis stream and replies come back through another, so Pangolin
 * can restart underneath the open sockets. Nothing here parses a frame.
 */
export class WsGateway {
    readonly gatewayId = randomUUID();

    private readonly logger: GatewayLogger;
    private readonly drainMs: number;
    private readonly livenessIntervalMs: number;
    // Commands and blocking reads can't share a connection
    private readonly writer: Redis;
    private readonly reader: Redis;
    private readonly wss = new WebSocketServer({
        noServer: true,
        maxPayload: MAX_PAYLOAD_BYTES,
        // Frames are forwarded unread, and Pangolin rejects what it can't parse
        skipUTF8Validation: true
    });
    private readonly httpServer: http.Server;
    private readonly port: number;

    private readonly sockets = new Map<string, Set<GatewaySocket>>();
    private readonly pendingAuth = new Map<string, PendingAuth>();

    private queue: QueueEntry[] = [];
    private queuedBytes = 0;
    private flushTimer: NodeJS.Timeout | null = null;
    private flushing = false;
    private droppedCommands = 0;

    private livenessTimer: NodeJS.Timeout | null = null;
    private readingOutbound = false;
    private outboundLoop: Promise<void> | null = null;
    private draining = false;

    constructor(options: GatewayOptions) {
        this.logger = options.logger;
        this.drainMs = options.drainMs ?? 20_000;
        this.livenessIntervalMs =
            options.livenessIntervalMs ?? LIVENESS_INTERVAL_MS;
        this.port = options.port;

        const redisOptions: RedisOptions = {
            ...options.redis,
            // Sockets outlive a Redis outage, so commands wait it out instead
            // of failing, and retries never stop
            maxRetriesPerRequest: null,
            enableReadyCheck: true,
            keepAlive: 10_000,
            retryStrategy: (times) => Math.min(times * 200, 2000)
        };
        this.writer = new Redis(redisOptions);
        this.reader = new Redis(redisOptions);
        this.writer.defineCommand("removePresence", {
            numberOfKeys: 1,
            lua: REMOVE_PRESENCE_SCRIPT
        });
        this.writer.on("error", (error) =>
            this.logger.error("Redis writer error", error)
        );
        this.reader.on("error", (error) =>
            this.logger.error("Redis reader error", error)
        );
        // Anything queued during an outage goes out as soon as Redis is back
        this.writer.on("ready", () => this.scheduleFlush());

        this.httpServer = http.createServer((req, res) =>
            this.handleHttp(req, res)
        );
        this.httpServer.on("upgrade", (request, socket, head) => {
            // Node stops watching the socket once it's an upgrade, and an
            // error with no listener would take the whole process down while
            // this one waits on Pangolin
            socket.on("error", () => {});
            this.handleUpgrade(request, socket as Socket, head).catch(
                (error) => {
                    this.logger.error("WebSocket upgrade error", error);
                    this.rejectUpgrade(
                        socket as Socket,
                        "500 Internal Server Error"
                    );
                }
            );
        });
    }

    async start(): Promise<void> {
        // Replies to our own auth requests arrive on the outbound stream, so
        // the cursor has to exist before the first device can connect. Taken
        // from Redis so a clock difference with this host can't skip entries.
        const [seconds] = await this.writer.time();
        const cursor = `${Number(seconds) * 1000}-0`;

        this.readingOutbound = true;
        this.outboundLoop = this.readOutbound(cursor);

        this.livenessTimer = setInterval(
            () => this.checkLiveness(),
            this.livenessIntervalMs
        );

        await new Promise<void>((resolve) => {
            this.httpServer.listen(this.port, resolve);
        });
        this.logger.info(
            `WebSocket gateway ${this.gatewayId} listening on port ${this.port}`
        );
    }

    get connectionCount(): number {
        let count = 0;
        for (const sockets of this.sockets.values()) {
            count += sockets.size;
        }
        return count;
    }

    private handleHttp(
        req: http.IncomingMessage,
        res: http.ServerResponse
    ): void {
        if (req.url === "/healthz") {
            // Stays healthy through a Redis outage: restarting the gateway
            // wouldn't bring Redis back and would bounce every socket. Failing
            // while draining takes it out of the load balancer.
            res.writeHead(this.draining ? 503 : 200, {
                "Content-Type": "text/plain"
            });
            res.end(this.draining ? "draining" : "OK");
            return;
        }
        res.writeHead(404);
        res.end();
    }

    private rejectUpgrade(socket: Socket, status: string): void {
        socket.write(`HTTP/1.1 ${status}\r\n\r\n`);
        socket.destroy();
    }

    private async handleUpgrade(
        request: http.IncomingMessage,
        socket: Socket,
        head: Buffer
    ): Promise<void> {
        if (this.draining || this.pendingAuth.size >= MAX_PENDING_AUTH) {
            this.rejectUpgrade(socket, "503 Service Unavailable");
            return;
        }

        const url = new URL(
            request.url || "",
            `http://${request.headers.host}`
        );
        const token =
            url.searchParams.get("token") ||
            request.headers["sec-websocket-protocol"] ||
            "";
        const userToken = url.searchParams.get("userToken") || "";
        const clientType = (url.searchParams.get("clientType") ||
            "newt") as GatewayClientType;

        if (!token || !CLIENT_TYPES.includes(clientType)) {
            this.rejectUpgrade(socket, "401 Unauthorized");
            return;
        }

        const result = await this.authenticate(clientType, token, userToken);

        // The device may have given up while Pangolin was answering
        if (socket.destroyed) {
            return;
        }
        if (!result) {
            // Pangolin didn't answer, which says nothing about the credentials
            this.rejectUpgrade(socket, "503 Service Unavailable");
            return;
        }
        if (!result.ok) {
            this.rejectUpgrade(socket, "401 Unauthorized");
            return;
        }

        this.wss.handleUpgrade(request, socket, head, (ws) => {
            this.addSocket(
                ws as GatewaySocket,
                result.clientId,
                clientType,
                result.siteId
            );
        });
    }

    private authenticate(
        clientType: GatewayClientType,
        token: string,
        userToken: string
    ): Promise<AuthResult | null> {
        const requestId = randomUUID();
        return new Promise((resolve) => {
            const timer = setTimeout(() => {
                this.pendingAuth.delete(requestId);
                resolve(null);
            }, AUTH_TIMEOUT_MS);
            this.pendingAuth.set(requestId, { resolve, timer });

            const fields = encodeAuthRequestFields({
                requestId,
                gatewayId: this.gatewayId,
                clientType,
                sessionId: hashToken(token),
                userSessionId: userToken ? hashToken(userToken) : "",
                timestamp: Date.now()
            });
            this.enqueue((pipeline) =>
                pipeline.xadd(
                    AUTH_STREAM,
                    "MAXLEN",
                    "~",
                    AUTH_STREAM_MAX_LENGTH,
                    "*",
                    ...fields
                )
            );
        });
    }

    private addSocket(
        ws: GatewaySocket,
        clientId: string,
        clientType: GatewayClientType,
        siteId?: number | null
    ): void {
        ws.clientId = clientId;
        ws.clientType = clientType;
        ws.connectionId = randomUUID();
        ws.siteId = siteId;
        ws.isAlive = true;
        ws.windowStart = Date.now();
        ws.windowCount = 0;

        const sockets = this.sockets.get(clientId) ?? new Set();
        sockets.add(ws);
        this.sockets.set(clientId, sockets);

        // Queued ahead of any frame from this socket, so Pangolin can already
        // see the client by the time it answers the first one
        this.enqueuePresence(ws);

        ws.on("message", (data: Buffer, isBinary: boolean) =>
            this.handleFrame(ws, data, isBinary)
        );
        ws.on("pong", () => {
            ws.isAlive = true;
        });
        ws.on("ping", () => {
            ws.isAlive = true;
        });
        ws.on("close", () => this.removeSocket(ws));
        ws.on("error", (error) => {
            this.logger.warn(
                `Socket error for ${clientType} ${clientId}: ${error.message}`
            );
        });
    }

    private removeSocket(ws: GatewaySocket): void {
        const sockets = this.sockets.get(ws.clientId);
        if (!sockets) {
            return;
        }
        sockets.delete(ws);
        if (sockets.size === 0) {
            this.sockets.delete(ws.clientId);
        }

        const key = presenceKey(ws.clientId);
        const remaining = sockets.values().next().value;
        this.enqueue((pipeline) =>
            (pipeline as any).removePresence(
                key,
                ws.connectionId,
                remaining?.connectionId ?? "",
                PRESENCE_TTL_SECONDS
            )
        );
    }

    private enqueuePresence(ws: GatewaySocket): void {
        const key = presenceKey(ws.clientId);
        this.enqueue((pipeline) =>
            pipeline.set(key, ws.connectionId, "EX", PRESENCE_TTL_SECONDS)
        );
    }

    private handleFrame(
        ws: GatewaySocket,
        data: Buffer,
        isBinary: boolean
    ): void {
        ws.isAlive = true;

        const now = Date.now();
        if (now - ws.windowStart >= 60_000) {
            ws.windowStart = now;
            ws.windowCount = 0;
        }
        ws.windowCount++;
        if (ws.windowCount > MAX_FRAMES_PER_MINUTE) {
            if (ws.windowCount === MAX_FRAMES_PER_MINUTE + 1) {
                this.logger.warn(
                    `Dropping frames from ${ws.clientType} ${ws.clientId}: over ${MAX_FRAMES_PER_MINUTE} per minute`
                );
            }
            return;
        }

        const fields = encodeMessageFields(
            ws.clientId,
            ws.clientType,
            now,
            isBinary,
            data
        );
        this.enqueue(
            (pipeline) =>
                pipeline.xadd(
                    INBOUND_STREAM,
                    "MAXLEN",
                    "~",
                    INBOUND_STREAM_MAX_LENGTH,
                    "*",
                    ...fields
                ),
            data.length
        );
    }

    private enqueue(command: QueuedCommand, payloadBytes = 0): void {
        const bytes = payloadBytes + QUEUE_ENTRY_OVERHEAD_BYTES;
        if (this.queuedBytes + bytes > MAX_QUEUED_BYTES) {
            if (this.droppedCommands++ % 10_000 === 0) {
                this.logger.error(
                    `Redis write queue is full, dropping new entries (${this.droppedCommands} so far)`
                );
            }
            return;
        }
        this.queue.push({ command, bytes });
        this.queuedBytes += bytes;
        this.scheduleFlush();
    }

    private scheduleFlush(): void {
        if (this.flushTimer || this.flushing) {
            return;
        }
        this.flushTimer = setTimeout(() => {
            this.flushTimer = null;
            this.flush().catch((error) => {
                this.logger.error("Failed to flush to Redis", error);
            });
        }, WRITE_FLUSH_INTERVAL_MS);
    }

    private async flush(): Promise<void> {
        if (this.flushing || this.writer.status !== "ready") {
            return;
        }
        this.flushing = true;
        try {
            while (this.queue.length > 0) {
                const batch = this.queue.splice(0, WRITE_BATCH_SIZE);
                const pipeline = this.writer.pipeline();
                batch.forEach(({ command }) => command(pipeline));
                try {
                    await this.execPipeline(pipeline);
                    for (const { bytes } of batch) {
                        this.queuedBytes -= bytes;
                    }
                } catch (error) {
                    // A retry can repeat commands that did apply, which
                    // Pangolin tolerates. Losing them it can't.
                    this.queue = batch.concat(this.queue);
                    throw error;
                }
            }
        } finally {
            this.flushing = false;
        }
    }

    private async execPipeline(pipeline: ChainableCommander): Promise<void> {
        const results = (await pipeline.exec()) ?? [];
        const failure = results.find(([error]) => error);
        if (failure) {
            throw failure[0];
        }
    }

    private async readOutbound(startCursor: string): Promise<void> {
        let cursor = startCursor;
        while (this.readingOutbound) {
            try {
                const result = await this.reader.xreadBuffer(
                    "COUNT",
                    OUTBOUND_READ_COUNT,
                    "BLOCK",
                    OUTBOUND_BLOCK_MS,
                    "STREAMS",
                    OUTBOUND_STREAM,
                    cursor
                );
                if (!result) {
                    continue;
                }
                for (const [, entries] of result as [
                    Buffer,
                    [Buffer, Buffer[]][]
                ][]) {
                    for (const [id, fields] of entries) {
                        cursor = id.toString();
                        this.handleOutbound(fields);
                    }
                }
            } catch (error) {
                if (!this.readingOutbound) {
                    return;
                }
                this.logger.error("Failed to read outbound stream", error);
                await new Promise((resolve) =>
                    setTimeout(resolve, REDIS_RETRY_DELAY_MS)
                );
            }
        }
    }

    private handleOutbound(fields: Buffer[]): void {
        let decoded: OutboundEntry | null;
        try {
            decoded = decodeOutbound(fields);
        } catch (error) {
            this.logger.error("Dropping malformed outbound entry", error);
            return;
        }
        if (!decoded) {
            return;
        }

        const entry = decoded;
        switch (entry.kind) {
            case OutboundKind.Direct: {
                const sockets = this.sockets.get(entry.clientId);
                sockets?.forEach((ws) =>
                    this.send(ws, entry.data, entry.isBinary)
                );
                break;
            }
            case OutboundKind.Broadcast:
                for (const [clientId, sockets] of this.sockets) {
                    if (clientId === entry.excludeClientId) {
                        continue;
                    }
                    sockets.forEach((ws) =>
                        this.send(ws, entry.data, entry.isBinary)
                    );
                }
                break;
            case OutboundKind.Disconnect:
                this.sockets.get(entry.clientId)?.forEach((ws) => {
                    ws.close(1000, "Disconnected by server");
                });
                break;
            case OutboundKind.AuthResult: {
                if (entry.gatewayId !== this.gatewayId) {
                    break;
                }
                const pending = this.pendingAuth.get(entry.requestId);
                if (pending) {
                    clearTimeout(pending.timer);
                    this.pendingAuth.delete(entry.requestId);
                    pending.resolve(entry.result);
                }
                break;
            }
        }
    }

    private send(ws: GatewaySocket, data: Buffer, isBinary: boolean): void {
        if (ws.readyState !== WebSocket.OPEN) {
            return;
        }
        if (ws.bufferedAmount > MAX_BUFFERED_BYTES) {
            this.logger.warn(
                `Terminating ${ws.clientType} ${ws.clientId}: not reading its socket`
            );
            ws.terminate();
            return;
        }
        ws.send(data, { binary: isBinary });
    }

    // A gateway runs for months, so unlike the sockets Pangolin used to hold,
    // the ones here don't get cleared out by deploys. Anything silent for a
    // whole interval after being pinged is gone. What survives is reported as
    // live, which is what keeps connected sites online.
    private checkLiveness(): void {
        const siteIds: number[] = [];
        const presence: GatewaySocket[] = [];

        for (const sockets of this.sockets.values()) {
            let newest: GatewaySocket | undefined;
            for (const ws of sockets) {
                if (!ws.isAlive) {
                    ws.terminate();
                    continue;
                }
                ws.isAlive = false;
                ws.ping();
                newest = ws;
                if (ws.siteId != null) {
                    siteIds.push(ws.siteId);
                }
            }
            if (newest) {
                presence.push(newest);
            }
        }

        // No point queueing refreshes while Redis is away: they would only
        // crowd out frames, and sockets refresh on the next tick anyway
        if (this.writer.status !== "ready") {
            return;
        }

        const fields = encodeSiteLivenessFields(siteIds, Date.now());
        this.enqueue((pipeline) => {
            for (const ws of presence) {
                pipeline.set(
                    presenceKey(ws.clientId),
                    ws.connectionId,
                    "EX",
                    PRESENCE_TTL_SECONDS
                );
            }
            if (siteIds.length > 0) {
                pipeline.xadd(
                    INBOUND_STREAM,
                    "MAXLEN",
                    "~",
                    INBOUND_STREAM_MAX_LENGTH,
                    "*",
                    ...fields
                );
            }
        });
    }

    async stop(): Promise<void> {
        if (this.draining) {
            return;
        }
        // The HTTP server stays up while draining so the load balancer sees the
        // failing health check and new upgrades get a clean 503
        this.draining = true;
        if (this.livenessTimer) {
            clearInterval(this.livenessTimer);
        }

        const sockets = [...this.sockets.values()].flatMap((set) => [...set]);
        const batches = Math.max(
            1,
            Math.ceil(this.drainMs / DRAIN_BATCH_INTERVAL_MS)
        );
        const batchSize = Math.ceil(sockets.length / batches);
        for (let i = 0; i < sockets.length; i += batchSize) {
            sockets
                .slice(i, i + batchSize)
                .forEach((ws) => ws.close(1001, "Gateway restarting"));
            if (i + batchSize < sockets.length) {
                await new Promise((resolve) =>
                    setTimeout(resolve, DRAIN_BATCH_INTERVAL_MS)
                );
            }
        }

        for (const pending of this.pendingAuth.values()) {
            clearTimeout(pending.timer);
            pending.resolve(null);
        }
        this.pendingAuth.clear();

        // Let the close handshakes finish, then push out what they queued
        await new Promise((resolve) => setTimeout(resolve, 200));
        this.wss.clients.forEach((ws) => ws.terminate());
        await new Promise((resolve) => setTimeout(resolve, 50));
        this.httpServer.close();
        while (this.flushing) {
            await new Promise((resolve) => setTimeout(resolve, 10));
        }
        await this.flush().catch((error) => {
            this.logger.error("Failed to flush during shutdown", error);
        });

        this.readingOutbound = false;
        this.reader.disconnect();
        await this.outboundLoop;
        this.writer.disconnect();
    }
}
