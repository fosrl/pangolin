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

import { privateConfig as config } from "#private/lib/config";
import logger from "@server/logger";
import { redis } from "../redis";
// Caps outgoing ACME API calls to a fixed budget per wall-clock second,
// shared across all pops workers via Redis (mirrors the lockManager pattern
// in @lib/lock) - a per-process limiter wouldn't be enough since multiple
// workers issue certificates against the same Let's Encrypt account.
const ACQUIRE_SCRIPT = `
local key = KEYS[1]
local limit = tonumber(ARGV[1])
local current = redis.call('INCR', key)
if current == 1 then
    redis.call('PEXPIRE', key, 2000)
end
if current > limit then
    return 0
else
    return 1
end
`;

class AcmeRateLimiter {
    async acquire(): Promise<void> {
        const limit =
            config.getRawConfig().acme?.acme_requests_per_second ?? 15;

        for (;;) {
            const bucket = Math.floor(Date.now() / 1000);
            const key = `acme_rate_limit:${bucket}`;

            let allowed: number;
            try {
                allowed = (await redis.eval(
                    ACQUIRE_SCRIPT,
                    1,
                    key,
                    limit.toString()
                )) as number;
            } catch (error) {
                logger.error(
                    "ACME rate limiter check failed, proceeding without throttling:",
                    error
                );
                return;
            }

            if (allowed === 1) {
                return;
            }

            // Budget for this second is spent - wait for the next window.
            const waitMs = 1000 - (Date.now() % 1000) + 10;
            await new Promise((resolve) => setTimeout(resolve, waitMs));
        }
    }
}

export const acmeRateLimiter = new AcmeRateLimiter();
