import { assertEquals, assertEqualsObj } from "@test/assert";
import { computeBuckets } from "./statusHistory";

// computeBuckets walks the (timestamp-ascending) event list with a single
// forward cursor rather than rescanning it once per day. These tests pin the
// behaviour that cursor has to preserve - in particular that the status
// carried into each day is the newest event *before* that day, including
// events from the immediately preceding day.

type Ev = {
    entityType: string;
    entityId: number;
    orgId: string;
    status: string;
    timestamp: number;
    id: number;
};

let nextId = 1;
function ev(timestamp: number, status: string): Ev {
    return {
        entityType: "site",
        entityId: 1,
        orgId: "org",
        status,
        timestamp,
        id: nextId++
    };
}

// UTC midnight of the current day, matching tzOffsetMinutes = 0.
function todayMidnight(): number {
    const nowSec = Math.floor(Date.now() / 1000);
    return Math.floor(nowSec / 86400) * 86400;
}

function runTests() {
    console.log("Running computeBuckets tests...");

    const midnight = todayMidnight();
    const dayStart = (daysAgo: number) => midnight - daysAgo * 86400;

    // No events at all: every bucket is no_data and nothing is downtime.
    {
        const { buckets, totalDowntime } = computeBuckets([], 3, null, 0);
        assertEquals(buckets.length, 3, "Should emit one bucket per day");
        assertEquals(totalDowntime, 0, "No events means no downtime");
        assertEquals(
            buckets.every((b) => b.status === "no_data"),
            true,
            "Every bucket should be no_data with no events and no prior status"
        );
    }

    // A prior status with no events still colours the buckets.
    {
        const { buckets } = computeBuckets([], 2, "online", 0);
        assertEquals(
            buckets.every((b) => b.status === "good"),
            true,
            "A healthy prior status should mark days good even with no events"
        );
    }

    // The key property of the forward cursor: an event on an earlier day must
    // still be the carried-in status for every later day.
    {
        // Goes offline early on day 3 (of a 3 day window) and never recovers.
        const events = [ev(dayStart(2) + 60, "offline")];
        const { buckets } = computeBuckets(events, 3, null, 0);

        assertEquals(
            buckets[0].status,
            "bad",
            "The day the outage starts should be bad"
        );
        assertEquals(
            buckets[1].status,
            "bad",
            "The following day inherits the offline status from the previous day"
        );
        assertEquals(
            buckets[1].totalDowntimeSeconds,
            86400,
            "A full inherited-offline day counts a whole day of downtime"
        );
    }

    // Recovery mid-window: downtime stops accruing once the status flips back.
    {
        const events = [
            ev(dayStart(2) + 60, "offline"),
            ev(dayStart(1) + 60, "online")
        ];
        const { buckets } = computeBuckets(events, 3, null, 0);
        assertEquals(
            buckets[1].totalDowntimeSeconds,
            60,
            "Downtime on the recovery day stops at the recovery event"
        );
        assertEquals(
            buckets[2].totalDowntimeSeconds,
            0,
            "The day after recovery has no downtime"
        );
    }

    // "unknown" is distinct from no_data and must survive being carried forward.
    {
        const events = [ev(dayStart(1) + 60, "unknown")];
        const { buckets } = computeBuckets(events, 2, null, 0);
        assertEquals(
            buckets[1].status,
            "unknown",
            "A day whose only observed status is unknown is reported unknown"
        );
    }

    // A day with a mix of unknown and a real status is not "unknown".
    {
        const events = [
            ev(dayStart(1) + 60, "unknown"),
            ev(dayStart(1) + 120, "online")
        ];
        const { buckets } = computeBuckets(events, 2, null, 0);
        assertEquals(
            buckets[1].status,
            "good",
            "A day containing a non-unknown status should not be reported unknown"
        );
    }

    // Bucket dates are contiguous, ascending calendar days.
    {
        const { buckets } = computeBuckets([], 5, null, 0);
        const dates = buckets.map((b) => b.date);
        const sorted = [...dates].sort();
        assertEqualsObj(
            dates,
            sorted,
            "Buckets should be emitted in ascending date order"
        );
        assertEquals(
            new Set(dates).size,
            5,
            "Each bucket should be a distinct calendar day"
        );
    }

    console.log("All computeBuckets tests passed!");
}

try {
    runTests();
    console.log("\nAll tests passed successfully!");
} catch (error) {
    console.error("computeBuckets test failed:", error);
    process.exit(1);
}
