import { build } from "@server/build";
import { startPingAccumulator } from "./routers/newt/pingAccumulator";
import { startOlmOfflineChecker } from "./routers/olm";
import { startNewtOfflineChecker } from "./routers/newt";
import { initTelemetryClient } from "@server/lib/telemetry";
import { initLogCleanupInterval } from "@server/lib/cleanupLogs";
import { initAcmeCertSync } from "@server/lib/acmeCertSync";
import { startRebuildQueueProcessor } from "@server/lib/rebuildClientAssociations";

export function startSchedulers() {
    // Start the ping accumulator for all builds - it batches per-site online/lastPing
    // updates into periodic bulk writes, preventing connection pool exhaustion.
    startPingAccumulator();

    if (build != "saas") {
        startOlmOfflineChecker(); // this is to handle the offline check for olms
        startNewtOfflineChecker(); // this is to handle the offline check for newts
    }

    initTelemetryClient();

    initLogCleanupInterval();
    initAcmeCertSync();
    startRebuildQueueProcessor();
}
