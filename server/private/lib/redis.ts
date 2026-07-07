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

import Redis, { RedisOptions } from "ioredis";
import logger from "@server/logger";
import privateConfig from "#private/lib/config";
import { build } from "@server/build";

class RedisManager {
    public client: Redis | null = null;
    private writeClient: Redis | null = null; // Master for writes
    private readClient: Redis | null = null; // Replica for reads
    private subscriber: Redis | null = null;
    private publisher: Redis | null = null;
    private isEnabled: boolean = false;
    private isHealthy: boolean = true;
    private isWriteHealthy: boolean = true;
    private isReadHealthy: boolean = true;
    private lastHealthCheck: number = 0;
    private healthCheckInterval: number = 30000; // 30 seconds
    private connectionTimeout: number = 15000; // 15 seconds
    private commandTimeout: number = 15000; // 15 seconds
    private hasReplicas: boolean = false;
    private maxRetries: number = 3;
    private baseRetryDelay: number = 100; // 100ms
    private maxRetryDelay: number = 2000; // 2 seconds
    private backoffMultiplier: number = 2;
    private subscribers: Map<
        string,
        Set<(channel: string, message: string) => void>
    > = new Map();
    private reconnectionCallbacks: Set<() => Promise<void>> = new Set();

    constructor() {
        if (build == "oss") {
            this.isEnabled = false;
            return;
        }
        this.isEnabled =
            privateConfig.getRawPrivateConfig().flags.enable_redis || false;
        if (this.isEnabled) {
            this.initializeClients();
        }
    }

    // Register callback to be called when Redis reconnects
    public onReconnection(callback: () => Promise<void>): void {
        this.reconnectionCallbacks.add(callback);
    }

    // Unregister reconnection callback
    public offReconnection(callback: () => Promise<void>): void {
        this.reconnectionCallbacks.delete(callback);
    }

    private async triggerReconnectionCallbacks(): Promise<void> {
        logger.info(
            `Triggering ${this.reconnectionCallbacks.size} reconnection callbacks`
        );

        const promises = Array.from(this.reconnectionCallbacks).map(
            async (callback) => {
                try {
                    await callback();
                } catch (error) {
                    logger.error("Error in reconnection callback:", error);
                }
            }
        );

        await Promise.allSettled(promises);
    }

    private async resubscribeToChannels(): Promise<void> {
        if (!this.subscriber || this.subscribers.size === 0) return;

        logger.info(
            `Re-subscribing to ${this.subscribers.size} channels after Redis reconnection`
        );

        try {
            const channels = Array.from(this.subscribers.keys());
            if (channels.length > 0) {
                await this.subscriber.subscribe(...channels);
                logger.info(
                    `Successfully re-subscribed to channels: ${channels.join(", ")}`
                );
            }
        } catch (error) {
            logger.error("Failed to re-subscribe to channels:", error);
        }
    }

    private getRedisConfig(): RedisOptions {
        const redisConfig = privateConfig.getRawPrivateConfig().redis!;
        const opts: RedisOptions = {
            host: redisConfig.host!,
            port: redisConfig.port!,
            password: redisConfig.password,
            db: redisConfig.db
        };

        // Enable TLS if configured (required for AWS ElastiCache in-transit encryption)
        if (redisConfig.tls) {
            opts.tls = {
                rejectUnauthorized: redisConfig.tls.rejectUnauthorized ?? true
            };
        }

        return opts;
    }

    private getReplicaRedisConfig(): RedisOptions | null {
        const redisConfig = privateConfig.getRawPrivateConfig().redis!;
        if (!redisConfig.replicas || redisConfig.replicas.length === 0) {
            return null;
        }

        // Use the first replica for simplicity
        // In production, you might want to implement load balancing across replicas
        const replica = redisConfig.replicas[0];
        const opts: RedisOptions = {
            host: replica.host!,
            port: replica.port!,
            password: replica.password,
            db: replica.db || redisConfig.db
        };

        // Enable TLS if configured (required for AWS ElastiCache in-transit encryption)
        if (redisConfig.tls) {
            opts.tls = {
                rejectUnauthorized: redisConfig.tls.rejectUnauthorized ?? true
            };
        }

        return opts;
    }

    // Add reconnection logic in initializeClients
    private initializeClients(): void {
        const masterConfig = this.getRedisConfig();
        const replicaConfig = this.getReplicaRedisConfig();

        this.hasReplicas = replicaConfig !== null;

        try {
            // Initialize master connection for writes
            this.writeClient = new Redis({
                ...masterConfig,
                enableReadyCheck: false,
                maxRetriesPerRequest: 3,
                keepAlive: 30000,
                connectTimeout: this.connectionTimeout,
                commandTimeout: this.commandTimeout
            });

            // Initialize replica connection for reads (if available)
            if (this.hasReplicas) {
                this.readClient = new Redis({
                    ...replicaConfig!,
                    enableReadyCheck: false,
                    maxRetriesPerRequest: 3,
                    keepAlive: 30000,
                    connectTimeout: this.connectionTimeout,
                    commandTimeout: this.commandTimeout
                });
            } else {
                // Fallback to master for reads if no replicas
                this.readClient = this.writeClient;
            }

            // Backward compatibility - point to write client
            this.client = this.writeClient;

            // Publisher uses master (writes)
            this.publisher = new Redis({
                ...masterConfig,
                enableReadyCheck: false,
                maxRetriesPerRequest: 3,
                keepAlive: 30000,
                connectTimeout: this.connectionTimeout,
                commandTimeout: this.commandTimeout
            });

            // Subscriber uses replica if available (reads)
            this.subscriber = new Redis({
                ...(this.hasReplicas ? replicaConfig! : masterConfig),
                enableReadyCheck: false,
                maxRetriesPerRequest: 3,
                keepAlive: 30000,
                connectTimeout: this.connectionTimeout,
                commandTimeout: this.commandTimeout
            });

            // Add reconnection handlers for write client
            this.writeClient.on("error", (err) => {
                logger.error("Redis write client error:", err);
                this.isWriteHealthy = false;
                this.isHealthy = false;
            });

            this.writeClient.on("reconnecting", () => {
                logger.info("Redis write client reconnecting...");
                this.isWriteHealthy = false;
                this.isHealthy = false;
            });

            this.writeClient.on("ready", () => {
                logger.info("Redis write client ready");
                this.isWriteHealthy = true;
                this.updateOverallHealth();

                // Trigger reconnection callbacks when Redis comes back online
                if (this.isHealthy) {
                    this.triggerReconnectionCallbacks().catch((error) => {
                        logger.error(
                            "Error triggering reconnection callbacks:",
                            error
                        );
                    });
                }
            });

            this.writeClient.on("connect", () => {
                logger.info("Redis write client connected");
            });

            // Add reconnection handlers for read client (if different from write)
            if (this.hasReplicas && this.readClient !== this.writeClient) {
                this.readClient.on("error", (err) => {
                    logger.error("Redis read client error:", err);
                    this.isReadHealthy = false;
                    this.updateOverallHealth();
                });

                this.readClient.on("reconnecting", () => {
                    logger.info("Redis read client reconnecting...");
                    this.isReadHealthy = false;
                    this.updateOverallHealth();
                });

                this.readClient.on("ready", () => {
                    logger.info("Redis read client ready");
                    this.isReadHealthy = true;
                    this.updateOverallHealth();

                    // Trigger reconnection callbacks when Redis comes back online
                    if (this.isHealthy) {
                        this.triggerReconnectionCallbacks().catch((error) => {
                            logger.error(
                                "Error triggering reconnection callbacks:",
                                error
                            );
                        });
                    }
                });

                this.readClient.on("connect", () => {
                    logger.info("Redis read client connected");
                });
            } else {
                // If using same client for reads and writes
                this.isReadHealthy = this.isWriteHealthy;
            }

            this.publisher.on("error", (err) => {
                logger.error("Redis publisher error:", err);
            });

            this.publisher.on("ready", () => {
                logger.info("Redis publisher ready");
            });

            this.publisher.on("connect", () => {
                logger.info("Redis publisher connected");
            });

            this.subscriber.on("error", (err) => {
                logger.error("Redis subscriber error:", err);
            });

            this.subscriber.on("ready", () => {
                logger.info("Redis subscriber ready");
                // Re-subscribe to all channels after reconnection
                this.resubscribeToChannels().catch((error: any) => {
                    logger.error("Error re-subscribing to channels:", error);
                });
            });

            this.subscriber.on("connect", () => {
                logger.info("Redis subscriber connected");
            });

            // Set up message handler for subscriber
            this.subscriber.on(
                "message",
                (channel: string, message: string) => {
                    const channelSubscribers = this.subscribers.get(channel);
                    if (channelSubscribers) {
                        channelSubscribers.forEach((callback) => {
                            try {
                                callback(channel, message);
                            } catch (error) {
                                logger.error(
                                    `Error in subscriber callback for channel ${channel}:`,
                                    error
                                );
                            }
                        });
                    }
                }
            );

            const setupMessage = this.hasReplicas
                ? "Redis clients initialized successfully with replica support"
                : "Redis clients initialized successfully (single instance)";
            logger.info(setupMessage);

            // Start periodic health monitoring
            this.startHealthMonitoring();
        } catch (error) {
            logger.error("Failed to initialize Redis clients:", error);
            this.isEnabled = false;
        }
    }

    private updateOverallHealth(): void {
        // Overall health is true if write is healthy and (read is healthy OR we don't have replicas)
        this.isHealthy =
            this.isWriteHealthy && (this.isReadHealthy || !this.hasReplicas);
    }

    private async executeWithRetry<T>(
        operation: () => Promise<T>,
        operationName: string,
        fallbackOperation?: () => Promise<T>
    ): Promise<T> {
        let lastError: Error | null = null;

        for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
            try {
                return await operation();
            } catch (error) {
                lastError = error as Error;

                // If this is the last attempt, try fallback if available
                if (attempt === this.maxRetries && fallbackOperation) {
                    try {
                        logger.warn(
                            `${operationName} primary operation failed, trying fallback`
                        );
                        return await fallbackOperation();
                    } catch (fallbackError) {
                        logger.error(
                            `${operationName} fallback also failed:`,
                            fallbackError
                        );
                        throw lastError;
                    }
                }

                // Don't retry on the last attempt
                if (attempt === this.maxRetries) {
                    break;
                }

                // Calculate delay with exponential backoff
                const delay = Math.min(
                    this.baseRetryDelay *
                        Math.pow(this.backoffMultiplier, attempt),
                    this.maxRetryDelay
                );

                logger.warn(
                    `${operationName} failed (attempt ${attempt + 1}/${this.maxRetries + 1}), retrying in ${delay}ms:`,
                    error
                );

                // Wait before retrying
                await new Promise((resolve) => setTimeout(resolve, delay));
            }
        }

        logger.error(
            `${operationName} failed after ${this.maxRetries + 1} attempts:`,
            lastError
        );
        throw lastError;
    }

    private startHealthMonitoring(): void {
        if (!this.isEnabled) return;

        // Check health every 30 seconds
        setInterval(async () => {
            try {
                await this.checkRedisHealth();
            } catch (error) {
                logger.error("Error during Redis health monitoring:", error);
            }
        }, this.healthCheckInterval);
    }

    public isRedisEnabled(): boolean {
        return this.isEnabled && this.client !== null && this.isHealthy;
    }

    private async checkRedisHealth(): Promise<boolean> {
        const now = Date.now();

        // Only check health every 30 seconds
        if (now - this.lastHealthCheck < this.healthCheckInterval) {
            return this.isHealthy;
        }

        this.lastHealthCheck = now;

        if (!this.writeClient) {
            this.isHealthy = false;
            this.isWriteHealthy = false;
            this.isReadHealthy = false;
            return false;
        }

        try {
            // Check write client (master) health
            await Promise.race([
                this.writeClient.ping(),
                new Promise((_, reject) =>
                    setTimeout(
                        () =>
                            reject(
                                new Error("Write client health check timeout")
                            ),
                        2000
                    )
                )
            ]);
            this.isWriteHealthy = true;

            // Check read client health if it's different from write client
            if (
                this.hasReplicas &&
                this.readClient &&
                this.readClient !== this.writeClient
            ) {
                try {
                    await Promise.race([
                        this.readClient.ping(),
                        new Promise((_, reject) =>
                            setTimeout(
                                () =>
                                    reject(
                                        new Error(
                                            "Read client health check timeout"
                                        )
                                    ),
                                2000
                            )
                        )
                    ]);
                    this.isReadHealthy = true;
                } catch (error) {
                    logger.error(
                        "Redis read client health check failed:",
                        error
                    );
                    this.isReadHealthy = false;
                }
            } else {
                this.isReadHealthy = this.isWriteHealthy;
            }

            this.updateOverallHealth();
            return this.isHealthy;
        } catch (error) {
            logger.error("Redis write client health check failed:", error);
            this.isWriteHealthy = false;
            this.isReadHealthy = false; // If write fails, consider read as failed too for safety
            this.isHealthy = false;
            return false;
        }
    }

    public getClient(): Redis {
        return this.client!;
    }

    public getWriteClient(): Redis | null {
        return this.writeClient;
    }

    public getReadClient(): Redis | null {
        return this.readClient;
    }

    public hasReplicaSupport(): boolean {
        return this.hasReplicas;
    }

    public getHealthStatus(): {
        isEnabled: boolean;
        isHealthy: boolean;
        isWriteHealthy: boolean;
        isReadHealthy: boolean;
        hasReplicas: boolean;
    } {
        return {
            isEnabled: this.isEnabled,
            isHealthy: this.isHealthy,
            isWriteHealthy: this.isWriteHealthy,
            isReadHealthy: this.isReadHealthy,
            hasReplicas: this.hasReplicas
        };
    }

    public async set(
        key: string,
        value: string,
        ttl?: number
    ): Promise<boolean> {
        if (!this.isRedisEnabled() || !this.writeClient) return false;

        try {
            await this.executeWithRetry(async () => {
                if (ttl) {
                    await this.writeClient!.setex(key, ttl, value);
                } else {
                    await this.writeClient!.set(key, value);
                }
            }, "Redis SET");
            return true;
        } catch (error) {
            logger.error("Redis SET error:", error);
            return false;
        }
    }

    public async get(key: string): Promise<string | null> {
        if (!this.isRedisEnabled() || !this.readClient) return null;

        try {
            const fallbackOperation =
                this.hasReplicas && this.writeClient && this.isWriteHealthy
                    ? () => this.writeClient!.get(key)
                    : undefined;

            return await this.executeWithRetry(
                () => this.readClient!.get(key),
                "Redis GET",
                fallbackOperation
            );
        } catch (error) {
            logger.error("Redis GET error:", error);
            return null;
        }
    }

    public async del(key: string): Promise<boolean> {
        if (!this.isRedisEnabled() || !this.writeClient) return false;

        try {
            await this.executeWithRetry(
                () => this.writeClient!.del(key),
                "Redis DEL"
            );
            return true;
        } catch (error) {
            logger.error("Redis DEL error:", error);
            return false;
        }
    }

    public async incr(key: string): Promise<number> {
        if (!this.isRedisEnabled() || !this.writeClient) return 0;

        try {
            return await this.executeWithRetry(
                () => this.writeClient!.incr(key),
                "Redis INCR"
            );
        } catch (error) {
            logger.error("Redis INCR error:", error);
            return 0;
        }
    }

    public async sadd(key: string, member: string): Promise<boolean> {
        if (!this.isRedisEnabled() || !this.writeClient) return false;

        try {
            await this.executeWithRetry(
                () => this.writeClient!.sadd(key, member),
                "Redis SADD"
            );
            return true;
        } catch (error) {
            logger.error("Redis SADD error:", error);
            return false;
        }
    }

    public async srem(key: string, member: string): Promise<boolean> {
        if (!this.isRedisEnabled() || !this.writeClient) return false;

        try {
            await this.executeWithRetry(
                () => this.writeClient!.srem(key, member),
                "Redis SREM"
            );
            return true;
        } catch (error) {
            logger.error("Redis SREM error:", error);
            return false;
        }
    }

    public async smembers(key: string): Promise<string[]> {
        if (!this.isRedisEnabled() || !this.readClient) return [];

        try {
            const fallbackOperation =
                this.hasReplicas && this.writeClient && this.isWriteHealthy
                    ? () => this.writeClient!.smembers(key)
                    : undefined;

            return await this.executeWithRetry(
                () => this.readClient!.smembers(key),
                "Redis SMEMBERS",
                fallbackOperation
            );
        } catch (error) {
            logger.error("Redis SMEMBERS error:", error);
            return [];
        }
    }

    public async hset(
        key: string,
        field: string,
        value: string
    ): Promise<boolean> {
        if (!this.isRedisEnabled() || !this.writeClient) return false;

        try {
            await this.executeWithRetry(
                () => this.writeClient!.hset(key, field, value),
                "Redis HSET"
            );
            return true;
        } catch (error) {
            logger.error("Redis HSET error:", error);
            return false;
        }
    }

    public async hget(key: string, field: string): Promise<string | null> {
        if (!this.isRedisEnabled() || !this.readClient) return null;

        try {
            const fallbackOperation =
                this.hasReplicas && this.writeClient && this.isWriteHealthy
                    ? () => this.writeClient!.hget(key, field)
                    : undefined;

            return await this.executeWithRetry(
                () => this.readClient!.hget(key, field),
                "Redis HGET",
                fallbackOperation
            );
        } catch (error) {
            logger.error("Redis HGET error:", error);
            return null;
        }
    }

    public async hdel(key: string, field: string): Promise<boolean> {
        if (!this.isRedisEnabled() || !this.writeClient) return false;

        try {
            await this.executeWithRetry(
                () => this.writeClient!.hdel(key, field),
                "Redis HDEL"
            );
            return true;
        } catch (error) {
            logger.error("Redis HDEL error:", error);
            return false;
        }
    }

    public async hgetall(key: string): Promise<Record<string, string>> {
        if (!this.isRedisEnabled() || !this.readClient) return {};

        try {
            const fallbackOperation =
                this.hasReplicas && this.writeClient && this.isWriteHealthy
                    ? () => this.writeClient!.hgetall(key)
                    : undefined;

            return await this.executeWithRetry(
                () => this.readClient!.hgetall(key),
                "Redis HGETALL",
                fallbackOperation
            );
        } catch (error) {
            logger.error("Redis HGETALL error:", error);
            return {};
        }
    }

    public async publish(channel: string, message: string): Promise<boolean> {
        if (!this.isRedisEnabled() || !this.publisher) return false;

        // Quick health check before attempting to publish
        const isHealthy = await this.checkRedisHealth();
        if (!isHealthy) {
            logger.warn("Skipping Redis publish due to unhealthy connection");
            return false;
        }

        try {
            await this.executeWithRetry(async () => {
                // Add timeout to prevent hanging
                return Promise.race([
                    this.publisher!.publish(channel, message),
                    new Promise((_, reject) =>
                        setTimeout(
                            () => reject(new Error("Redis publish timeout")),
                            3000
                        )
                    )
                ]);
            }, "Redis PUBLISH");
            return true;
        } catch (error) {
            logger.error("Redis PUBLISH error:", error);
            this.isHealthy = false; // Mark as unhealthy on error
            return false;
        }
    }

    public async subscribe(
        channel: string,
        callback: (channel: string, message: string) => void
    ): Promise<boolean> {
        if (!this.isRedisEnabled() || !this.subscriber) return false;

        try {
            // Add callback to subscribers map
            if (!this.subscribers.has(channel)) {
                this.subscribers.set(channel, new Set());
                // Only subscribe to the channel if it's the first subscriber
                await this.executeWithRetry(async () => {
                    return Promise.race([
                        this.subscriber!.subscribe(channel),
                        new Promise((_, reject) =>
                            setTimeout(
                                () =>
                                    reject(
                                        new Error("Redis subscribe timeout")
                                    ),
                                5000
                            )
                        )
                    ]);
                }, "Redis SUBSCRIBE");
            }

            this.subscribers.get(channel)!.add(callback);
            return true;
        } catch (error) {
            logger.error("Redis SUBSCRIBE error:", error);
            this.isHealthy = false;
            return false;
        }
    }

    public async unsubscribe(
        channel: string,
        callback?: (channel: string, message: string) => void
    ): Promise<boolean> {
        if (!this.isRedisEnabled() || !this.subscriber) return false;

        try {
            const channelSubscribers = this.subscribers.get(channel);
            if (!channelSubscribers) return true;

            if (callback) {
                // Remove specific callback
                channelSubscribers.delete(callback);
                if (channelSubscribers.size === 0) {
                    this.subscribers.delete(channel);
                    await this.executeWithRetry(
                        () => this.subscriber!.unsubscribe(channel),
                        "Redis UNSUBSCRIBE"
                    );
                }
            } else {
                // Remove all callbacks for this channel
                this.subscribers.delete(channel);
                await this.executeWithRetry(
                    () => this.subscriber!.unsubscribe(channel),
                    "Redis UNSUBSCRIBE"
                );
            }

            return true;
        } catch (error) {
            logger.error("Redis UNSUBSCRIBE error:", error);
            return false;
        }
    }

    public async disconnect(): Promise<void> {
        try {
            if (this.client) {
                await this.client.quit();
                this.client = null;
            }
            if (this.writeClient) {
                await this.writeClient.quit();
                this.writeClient = null;
            }
            if (this.readClient && this.readClient !== this.writeClient) {
                await this.readClient.quit();
                this.readClient = null;
            }
            if (this.publisher) {
                await this.publisher.quit();
                this.publisher = null;
            }
            if (this.subscriber) {
                await this.subscriber.quit();
                this.subscriber = null;
            }
            this.subscribers.clear();
            logger.info("Redis clients disconnected");
        } catch (error) {
            logger.error("Error disconnecting Redis clients:", error);
        }
    }
}

export const redisManager = new RedisManager();
export const redis = redisManager.getClient();
export default redisManager;

/**
 * Lightweight Redis manager for the regional (in-cluster) Redis instance.
 * Connects only when `redis.regional_redis` is present in the private config
 * and `flags.enable_redis` is true. No pub/sub — designed for low-latency
 * caching of regionally-scoped data.
 */
class RegionalRedisManager {
    private writeClient: Redis | null = null;
    private readClient: Redis | null = null;
    private isEnabled: boolean = false;
    private isHealthy: boolean = false;
    private connectionTimeout: number = 5000;
    private commandTimeout: number = 5000;

    constructor() {
        if (build === "oss") return;

        const cfg = privateConfig.getRawPrivateConfig();
        if (!cfg.flags.enable_redis || !cfg.redis?.regional_redis) return;

        this.isEnabled = true;
        this.initializeClients();
    }

    private getConfig(): RedisOptions {
        const r = privateConfig.getRawPrivateConfig().redis!.regional_redis!;
        const opts: RedisOptions = {
            host: r.host,
            port: r.port,
            password: r.password,
            db: r.db
        };
        if (r.tls) {
            opts.tls = { rejectUnauthorized: r.tls.rejectUnauthorized ?? true };
        }
        return opts;
    }

    // The regional Redis StatefulSet's "redis" service pins to pod redis-0
    // (primary). The replica (redis-1) is only reachable through the
    // per-pod headless service: <svc>.<namespace>.svc.cluster.local ->
    // redis-1.redis-headless.<namespace>.svc.cluster.local. Returns null
    // if the configured host doesn't match that pattern (e.g. local dev),
    // in which case callers should fall back to the primary for reads.
    private getReplicaHost(primaryHost: string): string | null {
        const match = primaryHost.match(/^redis\.([^.]+)\.svc\.cluster\.local$/);
        if (!match) return null;
        const namespace = match[1];
        return `redis-1.redis-headless.${namespace}.svc.cluster.local`;
    }

    private initializeClients(): void {
        const cfg = this.getConfig();
        const baseOpts = {
            ...cfg,
            enableReadyCheck: false,
            maxRetriesPerRequest: 3,
            keepAlive: 10000,
            connectTimeout: this.connectionTimeout,
            commandTimeout: this.commandTimeout
        };

        try {
            this.writeClient = new Redis(baseOpts);

            const replicaHost = this.getReplicaHost(cfg.host!);
            this.readClient = replicaHost
                ? new Redis({ ...baseOpts, host: replicaHost })
                : this.writeClient;

            this.writeClient.on("ready", () => {
                logger.info("Regional Redis write client ready");
                this.isHealthy = true;
            });
            this.writeClient.on("error", (err) => {
                logger.error("Regional Redis write client error:", err);
                this.isHealthy = false;
            });
            this.writeClient.on("reconnecting", () => {
                logger.info("Regional Redis write client reconnecting...");
                this.isHealthy = false;
            });

            if (this.readClient !== this.writeClient) {
                this.readClient.on("ready", () => {
                    logger.info("Regional Redis read client ready");
                });
                this.readClient.on("error", (err) => {
                    logger.error("Regional Redis read client error:", err);
                });
                this.readClient.on("reconnecting", () => {
                    logger.info("Regional Redis read client reconnecting...");
                });
            }

            logger.info(
                replicaHost
                    ? `Regional Redis client initialized (reads routed to replica ${replicaHost})`
                    : "Regional Redis client initialized (no replica resolvable, reads routed to primary)"
            );
        } catch (error) {
            logger.error("Failed to initialize regional Redis client:", error);
            this.isEnabled = false;
        }
    }

    public isRedisEnabled(): boolean {
        return this.isEnabled && this.writeClient !== null && this.isHealthy;
    }

    public getHealthStatus() {
        return { isEnabled: this.isEnabled, isHealthy: this.isHealthy };
    }

    public async set(
        key: string,
        value: string,
        ttl?: number
    ): Promise<boolean> {
        if (!this.isRedisEnabled() || !this.writeClient) return false;
        try {
            if (ttl) {
                await this.writeClient.setex(key, ttl, value);
            } else {
                await this.writeClient.set(key, value);
            }
            return true;
        } catch (error) {
            logger.error("Regional Redis SET error:", error);
            return false;
        }
    }

    public async get(key: string): Promise<string | null> {
        if (!this.isRedisEnabled() || !this.readClient) return null;
        try {
            return await this.readClient.get(key);
        } catch (error) {
            logger.error("Regional Redis GET error:", error);
            return null;
        }
    }

    public async del(key: string): Promise<boolean> {
        if (!this.isRedisEnabled() || !this.writeClient) return false;
        try {
            await this.writeClient.del(key);
            return true;
        } catch (error) {
            logger.error("Regional Redis DEL error:", error);
            return false;
        }
    }

    public async keys(pattern: string): Promise<string[]> {
        if (!this.isRedisEnabled() || !this.readClient) return [];
        try {
            return await this.readClient.keys(pattern);
        } catch (error) {
            logger.error("Regional Redis KEYS error:", error);
            return [];
        }
    }

    public getClient(): Redis | null {
        return this.writeClient;
    }

    public async hget(key: string, field: string): Promise<string | null> {
        if (!this.isRedisEnabled() || !this.readClient) return null;
        try {
            return await this.readClient.hget(key, field);
        } catch (error) {
            logger.error("Regional Redis HGET error:", error);
            return null;
        }
    }

    public async hset(
        key: string,
        field: string,
        value: string
    ): Promise<boolean> {
        if (!this.isRedisEnabled() || !this.writeClient) return false;
        try {
            await this.writeClient.hset(key, field, value);
            return true;
        } catch (error) {
            logger.error("Regional Redis HSET error:", error);
            return false;
        }
    }

    public async hgetall(key: string): Promise<Record<string, string>> {
        if (!this.isRedisEnabled() || !this.readClient) return {};
        try {
            return await this.readClient.hgetall(key);
        } catch (error) {
            logger.error("Regional Redis HGETALL error:", error);
            return {};
        }
    }

    public async disconnect(): Promise<void> {
        try {
            if (this.readClient && this.readClient !== this.writeClient) {
                await this.readClient.quit();
            }
            this.readClient = null;
            if (this.writeClient) {
                await this.writeClient.quit();
                this.writeClient = null;
            }
            logger.info("Regional Redis client disconnected");
        } catch (error) {
            logger.error("Error disconnecting regional Redis client:", error);
        }
    }
}

export const regionalRedisManager = new RegionalRedisManager();
