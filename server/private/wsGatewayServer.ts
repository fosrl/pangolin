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

// Standalone entry point for the WebSocket gateway (see Dockerfile.ws). It
// holds the device connections and passes everything to Pangolin over the
// regional Redis, so it has no database and doesn't load the Pangolin config
// or logger, both of which would pull the server in behind them.

import fs from "fs";
import { RedisOptions } from "ioredis";
import * as yaml from "js-yaml";
import { WsGateway } from "./wsGateway/gateway";

const CONFIG_PATH = "config/privateConfig.yml";
const DEFAULT_PORT = 3010;

const logger = {
    info: (message: string) => {
        console.log(`${new Date().toISOString()} [info]: ${message}`);
    },
    warn: (message: string) => {
        console.warn(`${new Date().toISOString()} [warn]: ${message}`);
    },
    error: (message: string, error?: unknown) => {
        console.error(
            `${new Date().toISOString()} [error]: ${message}`,
            error ?? ""
        );
    }
};

function loadRedisOptions(): RedisOptions {
    const config = fs.existsSync(CONFIG_PATH)
        ? (yaml.load(fs.readFileSync(CONFIG_PATH, "utf8")) as any)
        : undefined;
    const regional = config?.redis?.regional_redis;

    const host = process.env.REGIONAL_REDIS_HOST || regional?.host;
    if (!host) {
        throw new Error(
            `Regional Redis is not configured - set redis.regional_redis in ${CONFIG_PATH} or REGIONAL_REDIS_HOST`
        );
    }

    const options: RedisOptions = {
        host,
        port: Number(process.env.REGIONAL_REDIS_PORT || regional?.port || 6379),
        password: process.env.REGIONAL_REDIS_PASSWORD || regional?.password,
        db: Number(process.env.REGIONAL_REDIS_DB || regional?.db || 0)
    };
    if (regional?.tls) {
        options.tls = {
            rejectUnauthorized: regional.tls.rejectUnauthorized ?? true
        };
    }
    return options;
}

async function start() {
    const gateway = new WsGateway({
        port: Number(process.env.WS_GATEWAY_PORT || DEFAULT_PORT),
        redis: loadRedisOptions(),
        drainMs: process.env.WS_GATEWAY_DRAIN_MS
            ? Number(process.env.WS_GATEWAY_DRAIN_MS)
            : undefined,
        logger
    });
    await gateway.start();

    const shutdown = async () => {
        logger.info(`Draining ${gateway.connectionCount} connections`);
        try {
            await gateway.stop();
        } catch (error) {
            logger.error("Error during shutdown", error);
        }
        process.exit(0);
    };

    process.on("SIGTERM", shutdown);
    process.on("SIGINT", shutdown);
}

start().catch((error) => {
    logger.error("Failed to start WebSocket gateway", error);
    process.exit(1);
});
