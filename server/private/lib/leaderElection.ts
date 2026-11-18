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

import { v4 as uuidv4 } from "uuid";
import redisManager from "#private/lib/redis";
import { withTimeout } from "@server/lib/retry";
import logger from "@server/logger";

// How long a lease lasts without being renewed. If the leader dies, the
// role sits empty for at most this long before a follower can take it.
const LEASE_TTL_MS = 30_000;

// How often the leader renews its lease and a follower tries to take it.
const TICK_INTERVAL_MS = 10_000;

// A leader that can't confirm its lease within this time steps down. Even
// when the last successful renewal was just before a tick, it stops within
// TICK_INTERVAL_MS + REDIS_TIMEOUT_MS (15s), well before the lease can run
// out (LEASE_TTL_MS) and another instance can take it.
const REDIS_TIMEOUT_MS = 5_000;

const RENEW_SCRIPT = `
if redis.call('GET', KEYS[1]) == ARGV[1] then
    return redis.call('PEXPIRE', KEYS[1], ARGV[2])
else
    return 0
end
`;

const RELEASE_SCRIPT = `
if redis.call('GET', KEYS[1]) == ARGV[1] then
    return redis.call('DEL', KEYS[1])
else
    return 0
end
`;

type LeaderCallbacks = {
    // Runs once each time this instance becomes leader. If it throws, the
    // lease is given up and the next tick tries again (here or elsewhere).
    onElected: () => Promise<void>;
    // Runs when leadership is lost or given up. Must be safe to call even if
    // onElected only partly finished.
    onDemoted: () => Promise<void>;
};

/**
 * Makes sure only one Pangolin instance sharing a Redis is running a given
 * role at a time.
 *
 * Leadership is a Redis key, set with NX and a TTL, whose value is this
 * instance's token. The leader renews it every tick and steps down as soon
 * as a renewal fails or times out, so it has stopped before the lease
 * can run out and another instance can take over.
 *
 * Talks to the Redis client directly rather than through lockManager:
 * lockManager falls back to in-process locks while Redis is unreachable,
 * which would let every instance become leader during an outage. Here an
 * unreachable Redis means no instance is leader until it comes back.
 *
 * With Redis disabled, the deployment is assumed to be a single instance
 * (Redis is required to run more than one), so this instance is always the
 * leader.
 */
export class LeaderElection {
    private readonly key: string;
    private readonly callbacks: LeaderCallbacks;
    private token: string | null = null;
    private timer: NodeJS.Timeout | null = null;
    private leader = false;
    private running = false;

    constructor(name: string, callbacks: LeaderCallbacks) {
        this.key = `leader:${name}`;
        this.callbacks = callbacks;
    }

    start(): void {
        if (this.running) {
            return;
        }
        this.running = true;

        if (!redisManager.getWriteClient()) {
            logger.info(
                `Redis is disabled - assuming a single instance and taking ${this.key}`
            );
            void this.becomeLeader();
            return;
        }

        logger.info(`Leader election started for ${this.key}`);
        void this.tick();
    }

    async stop(): Promise<void> {
        if (!this.running) {
            return;
        }
        this.running = false;

        if (this.timer) {
            clearTimeout(this.timer);
            this.timer = null;
        }

        await this.stepDown("shutting down");
    }

    isLeader(): boolean {
        return this.leader;
    }

    // Ticks are chained with setTimeout rather than setInterval so a slow
    // acquire/renew can never overlap with the next one.
    private async tick(): Promise<void> {
        if (!this.running) {
            return;
        }

        try {
            if (this.leader) {
                await this.renew();
            } else {
                await this.tryAcquire();
            }
        } catch (error) {
            logger.error(`Leader election error for ${this.key}:`, error);
            await this.stepDown("leader election error");
        }

        if (this.running) {
            this.timer = setTimeout(() => void this.tick(), TICK_INTERVAL_MS);
        }
    }

    private async tryAcquire(): Promise<void> {
        const client = redisManager.getWriteClient()!;
        const token = uuidv4();

        const result = await withTimeout(
            client.set(this.key, token, "PX", LEASE_TTL_MS, "NX"),
            REDIS_TIMEOUT_MS,
            `acquire ${this.key}`
        );

        if (result !== "OK") {
            logger.debug(
                `Not leader for ${this.key} - another instance holds the lease`
            );
            return;
        }

        this.token = token;

        // stop() may have run while the SET was in flight.
        if (!this.running) {
            await this.release();
            return;
        }

        await this.becomeLeader();
    }

    private async renew(): Promise<void> {
        if (!this.token) {
            throw new Error("leader has no lease token");
        }

        const client = redisManager.getWriteClient()!;
        const renewed = (await withTimeout(
            client.eval(
                RENEW_SCRIPT,
                1,
                this.key,
                this.token,
                LEASE_TTL_MS.toString()
            ),
            REDIS_TIMEOUT_MS,
            `renew ${this.key}`
        )) as number;

        if (renewed !== 1) {
            throw new Error("lease is no longer held by this instance");
        }
    }

    private async becomeLeader(): Promise<void> {
        this.leader = true;
        logger.info(`Elected leader for ${this.key}`);

        try {
            await this.callbacks.onElected();
        } catch (error) {
            logger.error(
                `Failed to start ${this.key} after being elected leader:`,
                error
            );
            // Without Redis there's nobody to hand over to and no retry loop,
            // so keep the role, just as it was before leader election.
            if (this.token) {
                await this.stepDown("startup failed");
            }
        }
    }

    private async stepDown(reason: string): Promise<void> {
        const wasLeader = this.leader;
        this.leader = false;

        if (wasLeader) {
            logger.warn(`Stepping down as leader for ${this.key}: ${reason}`);
            try {
                await this.callbacks.onDemoted();
            } catch (error) {
                logger.error(
                    `Error stopping ${this.key} after stepping down:`,
                    error
                );
            }
        }

        // Only after onDemoted has stopped this instance from scheduling more
        // work, so the next leader doesn't overlap with it.
        await this.release();
    }

    // Best effort: if Redis is unreachable the lease just runs out after
    // LEASE_TTL_MS instead.
    private async release(): Promise<void> {
        const token = this.token;
        this.token = null;

        const client = redisManager.getWriteClient();
        if (!token || !client) {
            return;
        }

        try {
            await withTimeout(
                client.eval(RELEASE_SCRIPT, 1, this.key, token),
                REDIS_TIMEOUT_MS,
                `release ${this.key}`
            );
        } catch (error) {
            logger.warn(`Failed to release ${this.key}:`, error);
        }
    }
}
