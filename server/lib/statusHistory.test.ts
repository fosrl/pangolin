import { computeBuckets } from "./statusHistory";
import { assertEquals } from "@test/assert";

function event(id: number, timestamp: number, status: string) {
    return {
        entityType: "resource",
        entityId: 1,
        orgId: "org",
        status,
        timestamp,
        id
    };
}

// Regression test for https://github.com/fosrl/pangolin/issues/3994
function testSameSecondEventsUseInsertionOrder() {
    console.log("Running computeBuckets same-second ordering tests...");

    // Two days ago the resource went unhealthy and recovered within the same
    // second. The database may return the two rows in either order.
    const nowSec = Math.floor(Date.now() / 1000);
    const flap = nowSec - 2 * 86400;
    const unhealthy = event(1, flap, "unhealthy");
    const healthy = event(2, flap, "healthy");

    for (const events of [
        [unhealthy, healthy],
        [healthy, unhealthy]
    ]) {
        const { buckets, totalDowntime } = computeBuckets(
            events,
            5,
            "healthy",
            0
        );
        const order = events.map((e) => e.id).join(",");
        assertEquals(
            totalDowntime,
            0,
            `No downtime when the later event is healthy (rows ${order})`
        );
        assertEquals(
            buckets.at(-1)!.status,
            "good",
            `Today should be good (rows ${order})`
        );
    }

    console.log("All computeBuckets same-second ordering tests passed!");
}

try {
    testSameSecondEventsUseInsertionOrder();
    console.log("All tests passed successfully!");
} catch (error) {
    console.error("Test failed:", error);
    process.exit(1);
}
