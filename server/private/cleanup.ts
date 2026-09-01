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

import { rateLimitService } from "#private/lib/rateLimit";
import { logStreamingManager } from "#private/lib/logStreaming";
import { cleanup as wsCleanup } from "#private/routers/ws";
import { flushBandwidthToDb } from "@server/routers/newt/handleReceiveBandwidthMessage";
import { flushConnectionLogToDb } from "#private/routers/newt";
import { flushSiteBandwidthToDb } from "@server/routers/gerbil/receiveBandwidth";
import { stopPingAccumulator } from "@server/routers/newt/pingAccumulator";
import { shutdownUsageRecorder } from "@server/lib/aiBudgetEnforcement";
import { shutdownAiSessionLogger } from "@server/routers/aiGateway/logAiSession";

async function cleanup() {
    await stopPingAccumulator();
    await flushBandwidthToDb();
    await flushConnectionLogToDb();
    await flushSiteBandwidthToDb();
    await shutdownUsageRecorder();
    await shutdownAiSessionLogger();
    await rateLimitService.cleanup();
    await wsCleanup();
    await logStreamingManager.shutdown();

    process.exit(0);
}

export async function initCleanup() {
    // Handle process termination
    process.on("SIGTERM", () => cleanup());
    process.on("SIGINT", () => cleanup());
}
