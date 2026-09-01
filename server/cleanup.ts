import { flushBandwidthToDb } from "@server/routers/newt/handleReceiveBandwidthMessage";
import { flushConnectionLogToDb } from "#dynamic/routers/newt";
import { flushSiteBandwidthToDb } from "@server/routers/gerbil/receiveBandwidth";
import { stopPingAccumulator } from "@server/routers/newt/pingAccumulator";
import { cleanup as wsCleanup } from "#dynamic/routers/ws";
import { shutdownUsageRecorder } from "@server/lib/aiBudgetEnforcement";
import { shutdownAiSessionLogger } from "@server/routers/aiGateway/logAiSession";

async function cleanup() {
    await stopPingAccumulator();
    await flushBandwidthToDb();
    await flushConnectionLogToDb();
    await flushSiteBandwidthToDb();
    await shutdownUsageRecorder();
    await shutdownAiSessionLogger();
    await wsCleanup();

    process.exit(0);
}

export async function initCleanup() {
    // Handle process termination
    process.on("SIGTERM", () => cleanup());
    process.on("SIGINT", () => cleanup());
}
