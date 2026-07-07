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
import logger from "@server/logger";

export const ORG_REBUILD_CONCURRENCY_LIMIT = 10;

// Safety-net TTL: slightly longer than the rebuild lock TTL (120 s). If a
// server process dies while holding a rebuild, this ensures the counter key
// eventually expires rather than staying inflated forever.
const ORG_REBUILD_COUNT_TTL_MS = 180000;
const KEY_PREFIX = "rebuild-org-count:";

// In-memory fallback used when Redis is unavailable.
const localFallback = new Map<string, number>();

function isRedisReady(): boolean {
    return !!(redis && redis.status === "ready");
}

export async function incrementOrgRebuildCount(orgId: string): Promise<void> {
    if (!isRedisReady()) {
        localFallback.set(orgId, (localFallback.get(orgId) ?? 0) + 1);
        return;
    }
    try {
        const key = `${KEY_PREFIX}${orgId}`;
        await redis!.incr(key);
        // Always refresh the TTL so the key doesn't expire while rebuilds are
        // still in progress. The TTL is purely a crash-recovery safety net.
        await redis!.pexpire(key, ORG_REBUILD_COUNT_TTL_MS);
    } catch (err) {
        logger.warn(
            `orgRebuildCounter: Redis increment failed for org ${orgId}, falling back to local:`,
            err
        );
        localFallback.set(orgId, (localFallback.get(orgId) ?? 0) + 1);
    }
}

export async function decrementOrgRebuildCount(orgId: string): Promise<void> {
    if (!isRedisReady()) {
        const current = localFallback.get(orgId) ?? 0;
        if (current <= 1) {
            localFallback.delete(orgId);
        } else {
            localFallback.set(orgId, current - 1);
        }
        return;
    }
    try {
        const key = `${KEY_PREFIX}${orgId}`;
        const count = await redis!.decr(key);
        if (count <= 0) {
            await redis!.del(key);
        }
    } catch (err) {
        logger.warn(
            `orgRebuildCounter: Redis decrement failed for org ${orgId}, falling back to local:`,
            err
        );
        const current = localFallback.get(orgId) ?? 0;
        if (current <= 1) {
            localFallback.delete(orgId);
        } else {
            localFallback.set(orgId, current - 1);
        }
    }
}

export async function getOrgActiveRebuildCount(orgId: string): Promise<number> {
    if (!isRedisReady()) {
        return localFallback.get(orgId) ?? 0;
    }
    try {
        const key = `${KEY_PREFIX}${orgId}`;
        const val = await redis!.get(key);
        return val ? parseInt(val, 10) : 0;
    } catch (err) {
        logger.warn(
            `orgRebuildCounter: Redis get failed for org ${orgId}, falling back to local:`,
            err
        );
        return localFallback.get(orgId) ?? 0;
    }
}

export async function checkOrgRebuildRateLimit(
    orgId: string
): Promise<boolean> {
    return (
        (await getOrgActiveRebuildCount(orgId)) >= ORG_REBUILD_CONCURRENCY_LIMIT
    );
}
