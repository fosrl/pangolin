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

import { redis } from "#private/lib/redis";
import { lockManager } from "#private/lib/lock";
import logger from "@server/logger";
import { isTransientError } from "@server/lib/dbRetry";

export type RebuildJobType = "site-resource" | "client";

export interface RebuildJob {
    type: RebuildJobType;
    id: number;
    // Number of times this job has already been re-queued after a transient
    // failure. Absent/0 means it has not failed yet.
    attempt?: number;
}

export interface RebuildJobHandlers {
    onSiteResource(siteResourceId: number): Promise<void>;
    onClient(clientId: number): Promise<void>;
}

// Redis list holding pending rebuild jobs (RPUSH to enqueue, LPOP to dequeue — FIFO order).
const QUEUE_KEY = "rebuild-client-associations:queue";
const QUEUED_SET_KEY = "rebuild-client-associations:queued";

// Distributed lock that serialises queue consumption to a single server instance
// at a time. TTL is generous enough to cover a full batch of expensive rebuilds.
const PROCESSOR_LOCK_KEY = "rebuild-client-associations:processor";

// Each rebuild can take up to REBUILD_ASSOCIATIONS_LOCK_TTL_MS (120 s) per
// resource. Allow BATCH_SIZE resources per processor-lock acquisition, plus a
// small buffer.
const BATCH_SIZE = 5;
const PROCESSOR_LOCK_TTL_MS = 120000 * BATCH_SIZE + 30000; // ~630 s

const POLL_INTERVAL_MS = 500;

// A job that fails with a transient DB error gets re-queued with backoff
// instead of being dropped, up to this many times.
const MAX_JOB_ATTEMPTS = 5;
const JOB_RETRY_BASE_DELAY_MS = 1000;

class RedisRebuildQueue {
    private processingStarted = false;

    async isQueued(job: RebuildJob): Promise<boolean> {
        if (!redis || redis.status !== "ready") return false;
        const dedupeKey = `${job.type}:${job.id}`;
        try {
            const member = await redis.sismember(QUEUED_SET_KEY, dedupeKey);
            return member === 1;
        } catch {
            return false;
        }
    }

    async enqueue(job: RebuildJob): Promise<void> {
        if (!redis || redis.status !== "ready") {
            logger.warn(
                `Rebuild queue: Redis not available — rebuild for ${job.type}:${job.id} will not be retried`
            );
            return;
        }

        try {
            const dedupeKey = `${job.type}:${job.id}`;
            const added = await redis.sadd(QUEUED_SET_KEY, dedupeKey);
            if (added === 0) {
                logger.debug(
                    `Rebuild queue: skipped duplicate queued job ${job.type}:${job.id}`
                );
                return;
            }

            await redis.rpush(QUEUE_KEY, JSON.stringify(job));
            logger.debug(
                `Rebuild queue: enqueued ${job.type}:${job.id} (queue position: tail)`
            );
        } catch (err) {
            await redis
                .srem(QUEUED_SET_KEY, `${job.type}:${job.id}`)
                .catch((cleanupErr) =>
                    logger.warn(
                        `Rebuild queue: failed to cleanup dedupe key for ${job.type}:${job.id} after enqueue failure:`,
                        cleanupErr
                    )
                );
            logger.error(
                `Rebuild queue: failed to enqueue ${job.type}:${job.id}:`,
                err
            );
        }
    }

    startProcessing(handlers: RebuildJobHandlers): void {
        if (this.processingStarted) return;
        this.processingStarted = true;

        this.processLoop(handlers).catch((err) => {
            logger.error("Rebuild queue processor loop crashed:", err);
        });

        logger.info("Rebuild queue processor started");
    }

    private async processLoop(handlers: RebuildJobHandlers): Promise<void> {
        while (true) {
            try {
                await this.tryProcessBatch(handlers);
            } catch (err) {
                logger.error(
                    "Rebuild queue: unhandled error in process loop:",
                    err
                );
            }
            await new Promise((resolve) =>
                setTimeout(resolve, POLL_INTERVAL_MS)
            );
        }
    }

    private async tryProcessBatch(handlers: RebuildJobHandlers): Promise<void> {
        if (!redis || redis.status !== "ready") return;

        // Peek before acquiring the processor lock to avoid unnecessary Redis
        // round-trips and lock contention when the queue is idle.
        const queueLength = await redis.llen(QUEUE_KEY).catch(() => 0);
        if (queueLength === 0) return;

        try {
            await lockManager.withLock(
                PROCESSOR_LOCK_KEY,
                async () => {
                    for (let i = 0; i < BATCH_SIZE; i++) {
                        if (!redis || redis.status !== "ready") break;

                        const payload = await redis.lpop(QUEUE_KEY);
                        if (payload === null) break; // queue drained

                        let job: RebuildJob;
                        try {
                            job = JSON.parse(payload) as RebuildJob;
                        } catch {
                            logger.error(
                                `Rebuild queue: could not parse job payload, discarding: ${payload}`
                            );
                            continue;
                        }

                        // Remove from dedupe set once dequeued so the same job
                        // can be re-queued while this one is in progress.
                        await redis
                            .srem(QUEUED_SET_KEY, `${job.type}:${job.id}`)
                            .catch((cleanupErr) =>
                                logger.warn(
                                    `Rebuild queue: failed to remove dedupe key for ${job.type}:${job.id} on dequeue:`,
                                    cleanupErr
                                )
                            );

                        logger.debug(
                            `Rebuild queue: processing ${job.type}:${job.id}`
                        );

                        try {
                            if (job.type === "site-resource") {
                                await handlers.onSiteResource(job.id);
                            } else if (job.type === "client") {
                                await handlers.onClient(job.id);
                            } else {
                                logger.warn(
                                    `Rebuild queue: unknown job type "${(job as any).type}", discarding`
                                );
                            }

                            logger.debug(
                                `Rebuild queue: completed ${job.type}:${job.id}`
                            );
                        } catch (err) {
                            const attempt = (job.attempt ?? 0) + 1;
                            if (
                                isTransientError(err) &&
                                attempt <= MAX_JOB_ATTEMPTS
                            ) {
                                const delay =
                                    JOB_RETRY_BASE_DELAY_MS *
                                    Math.pow(2, attempt - 1);
                                logger.warn(
                                    `Rebuild queue: job ${job.type}:${job.id} hit a transient error (attempt ${attempt}/${MAX_JOB_ATTEMPTS}), re-queuing in ${delay}ms:`,
                                    err
                                );
                                setTimeout(() => {
                                    this.enqueue({ ...job, attempt }).catch(
                                        (enqueueErr) =>
                                            logger.error(
                                                `Rebuild queue: failed to re-queue ${job.type}:${job.id} after transient error:`,
                                                enqueueErr
                                            )
                                    );
                                }, delay);
                            } else {
                                logger.error(
                                    `Rebuild queue: job ${job.type}:${job.id} threw an error:`,
                                    err
                                );
                            }
                        }
                    }
                },
                PROCESSOR_LOCK_TTL_MS
            );
        } catch (err: any) {
            if (
                typeof err?.message === "string" &&
                err.message.startsWith("Failed to acquire lock")
            ) {
                // Another server instance currently holds the processor lock and
                // is consuming the queue — nothing to do this cycle.
                logger.debug(
                    "Rebuild queue: processor lock held by another instance, skipping this cycle"
                );
            } else {
                throw err;
            }
        }
    }
}

export const rebuildQueue: RedisRebuildQueue = new RedisRebuildQueue();
