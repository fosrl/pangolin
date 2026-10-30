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

import Redis from "ioredis";
import {
    AUTH_STREAM,
    AUTH_TIMEOUT_MS,
    AuthRequest,
    AuthResult,
    CONSUMER_GROUP,
    decodeAuthRequest,
    decodeInbound,
    encodeAuthResultFields,
    encodeBroadcastFields,
    encodeDirectFields,
    encodeDisconnectFields,
    FORWARD_CLAIM_TTL_SECONDS,
    forwardClaimKey,
    GatewayClientType,
    INBOUND_STREAM,
    InboundKind,
    MAX_INBOUND_AGE_MS,
    OUTBOUND_RETENTION_MS,
    OUTBOUND_STREAM,
    presenceKey,
    RawFields
} from "./protocol";

export interface BridgeLogger {
    info(message: string): void;
    warn(message: string): void;
    error(message: string, error?: unknown): void;
}

export interface GatewayFrame {
    clientId: string;
    clientType: GatewayClientType;
    data: Buffer;
    isBinary: boolean;
}

export interface BridgeHandlers {
    authenticate(request: AuthRequest): Promise<AuthResult>;
    // Called with every frame in a batch before any of them is handled, so the
    // clients can be loaded with one query instead of one per frame
    prepareFrames(frames: GatewayFrame[]): Promise<void>;
    handleFrame(frame: GatewayFrame): Promise<void>;
    handleSiteLiveness(siteIds: number[]): void;
}

export interface BridgeOptions {
    // The regional Redis primary. Stream consumers open their own connections
    // from this one, since a blocking read would stall everything else on it.
    redis: Redis;
    nodeId: string;
    handlers: BridgeHandlers;
    logger: BridgeLogger;
    // Exposed for tests, which can't wait a minute for a claim
    claimMinIdleMs?: number;
    claimIntervalMs?: number;
}

export interface OutboundDelivery {
    clientId: string;
    data: string | Buffer;
    isBinary: boolean;
}

type StreamEntry = [Buffer, Buffer[]];

class ConcurrencyLimit {
    active = 0;
    private waiter: (() => void) | null = null;

    constructor(private readonly max: number) {}

    get available(): number {
        return this.max - this.active;
    }

    async waitForRoom(isRunning: () => boolean): Promise<void> {
        while (isRunning() && this.available <= 0) {
            await new Promise<void>((resolve) => {
                this.waiter = resolve;
            });
        }
    }

    release(): void {
        this.active--;
        this.wake();
    }

    wake(): void {
        const waiter = this.waiter;
        this.waiter = null;
        waiter?.();
    }
}

// Frames being handled at once by one Pangolin, and so its share of the backlog
const FRAME_CONCURRENCY = 256;
const AUTH_CONCURRENCY = 64;
const READ_BLOCK_MS = 2000;
const ACK_FLUSH_INTERVAL_MS = 20;
const ERROR_RETRY_DELAY_MS = 1000;
// A frame unacknowledged for this long belonged to a Pangolin that died. Live
// ones refresh the frames they're still handling every CLAIM_INTERVAL_MS, so a
// slow handler isn't mistaken for a dead one and run twice.
const CLAIM_MIN_IDLE_MS = 45_000;
const CLAIM_INTERVAL_MS = 15_000;
const CLAIM_BATCH_SIZE = 256;
const CONSUMER_CLEANUP_INTERVAL_MS = 10 * 60 * 1000;
const CONSUMER_MAX_IDLE_MS = 60 * 60 * 1000;
const SHUTDOWN_TIMEOUT_MS = 10_000;

// Checks and appends in one step, so the common case costs one round trip
const DELIVER_SCRIPT = `
if redis.call('EXISTS', KEYS[1]) == 0 then
    return 0
end
redis.call('XADD', KEYS[2], 'MINID', '~', ARGV[1], '*', unpack(ARGV, 2))
return 1
`;

/**
 * The Pangolin end of the gateway. Takes device frames off the regional Redis,
 * hands them to the handlers, and acknowledges them only once handled, so a
 * Pangolin that dies part way through leaves its frames for another to claim.
 */
export class WsGatewayBridge {
    private readonly redis: Redis;
    private readonly nodeId: string;
    private readonly handlers: BridgeHandlers;
    private readonly logger: BridgeLogger;
    private readonly claimMinIdleMs: number;
    private readonly claimIntervalMs: number;

    private running = false;
    private frameConnection: Redis | null = null;
    private authConnection: Redis | null = null;
    private loops: Promise<void>[] = [];
    private claimTimer: NodeJS.Timeout | null = null;
    private lastConsumerCleanup = 0;

    private readonly frameLimit = new ConcurrencyLimit(FRAME_CONCURRENCY);
    private readonly authLimit = new ConcurrencyLimit(AUTH_CONCURRENCY);
    private readonly inFlightIds = new Set<string>();
    private idleWaiter: (() => void) | null = null;

    private ackIds: string[] = [];
    private ackTimer: NodeJS.Timeout | null = null;

    constructor(options: BridgeOptions) {
        this.redis = options.redis;
        this.nodeId = options.nodeId;
        this.handlers = options.handlers;
        this.logger = options.logger;
        this.claimMinIdleMs = options.claimMinIdleMs ?? CLAIM_MIN_IDLE_MS;
        this.claimIntervalMs = options.claimIntervalMs ?? CLAIM_INTERVAL_MS;

        this.redis.defineCommand("wsGatewayDeliver", {
            numberOfKeys: 2,
            lua: DELIVER_SCRIPT
        });
    }

    start(): void {
        this.running = true;

        // The shared connection has a command timeout, which would cut off
        // blocking reads, and it gives up retrying, which these loops must not
        const consumerOptions = {
            commandTimeout: undefined,
            maxRetriesPerRequest: null
        };
        this.frameConnection = this.redis.duplicate(consumerOptions);
        this.authConnection = this.redis.duplicate(consumerOptions);
        for (const connection of [this.frameConnection, this.authConnection]) {
            connection.on("error", (error) => {
                this.logger.error("Gateway stream connection error", error);
            });
        }

        this.loops = [
            this.consume(
                this.frameConnection,
                INBOUND_STREAM,
                this.frameLimit,
                (entries) => this.startFrames(entries)
            ),
            this.consume(
                this.authConnection,
                AUTH_STREAM,
                this.authLimit,
                (entries) => this.startAuth(entries)
            )
        ];

        this.claimTimer = setInterval(() => {
            this.maintainPendingFrames().catch((error) => {
                this.logger.error("Failed to maintain gateway frames", error);
            });
        }, this.claimIntervalMs);
    }

    async stop(): Promise<void> {
        if (!this.running) {
            return;
        }
        this.running = false;
        if (this.claimTimer) {
            clearInterval(this.claimTimer);
        }
        this.frameLimit.wake();
        this.authLimit.wake();
        await Promise.all(this.loops);

        // Whatever doesn't finish in time stays unacknowledged for another
        // Pangolin to claim, so there's no reason to hold up the shutdown
        if (this.frameLimit.active > 0) {
            await Promise.race([
                new Promise<void>((resolve) => {
                    this.idleWaiter = resolve;
                }),
                new Promise((resolve) =>
                    setTimeout(resolve, SHUTDOWN_TIMEOUT_MS)
                )
            ]);
        }
        await this.flushAcks();

        this.frameConnection?.disconnect();
        this.authConnection?.disconnect();
    }

    // Queues messages for the gateways in this region. Returns false for each
    // client with no socket here, for the caller to try the other regions.
    async deliver(deliveries: OutboundDelivery[]): Promise<boolean[]> {
        if (deliveries.length === 0) {
            return [];
        }
        const minId = Date.now() - OUTBOUND_RETENTION_MS;
        const pipeline = this.redis.pipeline();
        for (const { clientId, data, isBinary } of deliveries) {
            (pipeline as any).wsGatewayDeliver(
                presenceKey(clientId),
                OUTBOUND_STREAM,
                minId,
                ...encodeDirectFields(clientId, isBinary, data)
            );
        }
        const results = (await pipeline.exec()) ?? [];
        return deliveries.map((_, index) => {
            const [error, delivered] = results[index] ?? [];
            if (error) {
                this.logger.error("Failed to queue gateway delivery", error);
            }
            return delivered === 1;
        });
    }

    async broadcast(
        excludeClientId: string | undefined,
        data: string | Buffer,
        isBinary: boolean
    ): Promise<void> {
        await this.addOutbound(
            encodeBroadcastFields(excludeClientId, isBinary, data)
        );
    }

    async disconnect(clientId: string): Promise<void> {
        await this.addOutbound(encodeDisconnectFields(clientId));
    }

    // Every Pangolin in the region receives a cross-region message, and this
    // is what lets just one of them pass it on to the gateways
    async claimForward(id: string): Promise<boolean> {
        const claimed = await this.redis.set(
            forwardClaimKey(id),
            "1",
            "EX",
            FORWARD_CLAIM_TTL_SECONDS,
            "NX"
        );
        return claimed === "OK";
    }

    private addOutbound(fields: RawFields) {
        return this.redis.xadd(
            OUTBOUND_STREAM,
            "MINID",
            "~",
            Date.now() - OUTBOUND_RETENTION_MS,
            "*",
            ...fields
        );
    }

    private async ensureGroup(
        connection: Redis,
        stream: string
    ): Promise<void> {
        try {
            await connection.xgroup(
                "CREATE",
                stream,
                CONSUMER_GROUP,
                "0",
                "MKSTREAM"
            );
        } catch (error) {
            if (!(error as Error).message?.includes("BUSYGROUP")) {
                throw error;
            }
        }
    }

    private async consume(
        connection: Redis,
        stream: string,
        limit: ConcurrencyLimit,
        onEntries: (entries: StreamEntry[]) => Promise<void>
    ): Promise<void> {
        let groupReady = false;

        while (this.running) {
            try {
                if (!groupReady) {
                    await this.ensureGroup(connection, stream);
                    groupReady = true;
                }

                await limit.waitForRoom(() => this.running);
                if (!this.running) {
                    return;
                }

                const result = await connection.xreadgroupBuffer(
                    "GROUP",
                    CONSUMER_GROUP,
                    this.nodeId,
                    "COUNT",
                    limit.available,
                    "BLOCK",
                    READ_BLOCK_MS,
                    "STREAMS",
                    stream,
                    ">"
                );
                if (!result) {
                    continue;
                }
                for (const [, entries] of result as [Buffer, StreamEntry[]][]) {
                    await onEntries(entries);
                }
            } catch (error) {
                if (!this.running) {
                    return;
                }
                // Redis restarted without its data
                if ((error as Error).message?.includes("NOGROUP")) {
                    groupReady = false;
                    continue;
                }
                this.logger.error(`Failed to read ${stream}`, error);
                await new Promise((resolve) =>
                    setTimeout(resolve, ERROR_RETRY_DELAY_MS)
                );
            }
        }
    }

    private async startFrames(entries: StreamEntry[]): Promise<void> {
        const frames: { id: string; frame: GatewayFrame }[] = [];
        const now = Date.now();
        let expired = 0;

        for (const [rawId, fields] of entries) {
            const id = rawId.toString();
            let entry;
            try {
                entry = decodeInbound(fields);
            } catch (error) {
                this.logger.error("Dropping malformed gateway entry", error);
                this.ack(id);
                continue;
            }

            if (!entry) {
                this.ack(id);
            } else if (now - entry.timestamp > MAX_INBOUND_AGE_MS) {
                expired++;
                this.ack(id);
            } else if (entry.kind === InboundKind.SiteLiveness) {
                this.handlers.handleSiteLiveness(entry.siteIds);
                this.ack(id);
            } else {
                frames.push({ id, frame: entry });
            }
        }

        if (expired > 0) {
            this.logger.warn(
                `Dropped ${expired} gateway frames older than ${MAX_INBOUND_AGE_MS / 1000}s`
            );
        }

        this.frameLimit.active += frames.length;
        frames.forEach(({ id }) => this.inFlightIds.add(id));
        try {
            await this.handlers.prepareFrames(frames.map(({ frame }) => frame));
        } catch (error) {
            // The frames can still be handled, just less efficiently
            this.logger.error("Failed to prepare gateway frames", error);
        }

        for (const { id, frame } of frames) {
            this.handlers
                .handleFrame(frame)
                .then(
                    () => this.ack(id),
                    (error) => {
                        // Same as a handler throwing on a direct socket: the
                        // frame is spent. Retrying it would only repeat this.
                        this.logger.error(
                            "Failed to handle gateway frame",
                            error
                        );
                        this.ack(id);
                    }
                )
                .finally(() => {
                    this.inFlightIds.delete(id);
                    this.frameLimit.release();
                    if (this.frameLimit.active === 0) {
                        this.idleWaiter?.();
                    }
                });
        }
    }

    private ack(id: string): void {
        this.ackIds.push(id);
        if (!this.ackTimer) {
            this.ackTimer = setTimeout(() => {
                this.ackTimer = null;
                this.flushAcks().catch((error) => {
                    this.logger.error("Failed to ack gateway frames", error);
                });
            }, ACK_FLUSH_INTERVAL_MS);
        }
    }

    private async flushAcks(): Promise<void> {
        if (this.ackTimer) {
            clearTimeout(this.ackTimer);
            this.ackTimer = null;
        }
        if (this.ackIds.length === 0) {
            return;
        }
        const ids = this.ackIds;
        this.ackIds = [];
        await this.redis
            .pipeline()
            .xack(INBOUND_STREAM, CONSUMER_GROUP, ...ids)
            .xdel(INBOUND_STREAM, ...ids)
            .exec();
    }

    private async startAuth(entries: StreamEntry[]): Promise<void> {
        for (const [rawId, fields] of entries) {
            const id = rawId.toString();
            // Acknowledged right away: if this fails the device just tries
            // again, and a stale request is no use to another Pangolin
            this.redis
                .pipeline()
                .xack(AUTH_STREAM, CONSUMER_GROUP, id)
                .xdel(AUTH_STREAM, id)
                .exec()
                .catch((error) => {
                    this.logger.error("Failed to ack auth request", error);
                });

            this.authLimit.active++;
            this.handleAuth(fields)
                .catch((error) => {
                    this.logger.error("Failed to answer auth request", error);
                })
                .finally(() => this.authLimit.release());
        }
    }

    private async handleAuth(fields: Buffer[]): Promise<void> {
        let request: AuthRequest;
        try {
            request = decodeAuthRequest(fields);
        } catch (error) {
            this.logger.error("Dropping malformed auth request", error);
            return;
        }

        // The gateway has already told this device to retry
        if (Date.now() - request.timestamp > AUTH_TIMEOUT_MS) {
            return;
        }

        let result: AuthResult;
        try {
            result = await this.handlers.authenticate(request);
        } catch (error) {
            // No reply makes the gateway answer 503. Answering "denied" for a
            // database hiccup would look like bad credentials to the device.
            this.logger.error("Failed to authenticate gateway client", error);
            return;
        }

        await this.addOutbound(
            encodeAuthResultFields(request.gatewayId, request.requestId, result)
        );
    }

    private async maintainPendingFrames(): Promise<void> {
        if (!this.running) {
            return;
        }

        // Claiming with an idle time of zero changes nothing but resets the
        // idle clock, which is how a frame still being handled stays ours
        if (this.inFlightIds.size > 0) {
            await this.redis.xclaim(
                INBOUND_STREAM,
                CONSUMER_GROUP,
                this.nodeId,
                0,
                ...this.inFlightIds,
                "JUSTID"
            );
        }

        const room = Math.min(this.frameLimit.available, CLAIM_BATCH_SIZE);
        if (room > 0) {
            const claimed = (await this.redis.callBuffer(
                "XAUTOCLAIM",
                INBOUND_STREAM,
                CONSUMER_GROUP,
                this.nodeId,
                this.claimMinIdleMs,
                "0-0",
                "COUNT",
                room
            )) as [Buffer, StreamEntry[]];
            const entries = claimed[1];
            if (entries.length > 0) {
                this.logger.warn(
                    `Claimed ${entries.length} gateway frames abandoned by another Pangolin`
                );
                await this.startFrames(entries);
            }
        }

        if (
            Date.now() - this.lastConsumerCleanup >
            CONSUMER_CLEANUP_INTERVAL_MS
        ) {
            this.lastConsumerCleanup = Date.now();
            await this.removeDeadConsumers();
        }
    }

    // Each Pangolin process is a new consumer, so these pile up with restarts.
    // One with pending frames is left until they've been claimed from it.
    private async removeDeadConsumers(): Promise<void> {
        for (const stream of [INBOUND_STREAM, AUTH_STREAM]) {
            const consumers = (await this.redis.xinfo(
                "CONSUMERS",
                stream,
                CONSUMER_GROUP
            )) as unknown[][];
            for (const fields of consumers) {
                const info = new Map<string, unknown>();
                for (let i = 0; i + 1 < fields.length; i += 2) {
                    info.set(String(fields[i]), fields[i + 1]);
                }
                if (
                    info.get("name") !== this.nodeId &&
                    info.get("pending") === 0 &&
                    Number(info.get("idle")) > CONSUMER_MAX_IDLE_MS
                ) {
                    await this.redis.xgroup(
                        "DELCONSUMER",
                        stream,
                        CONSUMER_GROUP,
                        String(info.get("name"))
                    );
                }
            }
        }
    }
}
