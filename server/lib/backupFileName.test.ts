import { formatBackupFileName, formatBackupTimestamp } from "./backupFileName";
import { assertEquals } from "@test/assert";

// Local-time constructors are used throughout, matching formatBackupTimestamp,
// so these cases do not depend on the machine's timezone.

function testMonthIsOneIndexed() {
    console.log("Running month indexing tests...");

    // The case from the report: a backup taken on 12 September 2026 was named
    // db_2026-8-12_... because Date#getMonth is zero-indexed.
    {
        const result = formatBackupTimestamp(new Date(2026, 8, 12, 20, 35, 56));
        assertEquals(
            result,
            "2026-09-12_20-35-56",
            "September must render as 09, not 8"
        );
    }

    // The other reported name, db_2026-0-23_..., was a January backup.
    {
        const result = formatBackupTimestamp(new Date(2026, 0, 23, 20, 25, 49));
        assertEquals(
            result,
            "2026-01-23_20-25-49",
            "January must render as 01, not 0"
        );
    }

    {
        const result = formatBackupTimestamp(
            new Date(2026, 11, 31, 23, 59, 59)
        );
        assertEquals(
            result,
            "2026-12-31_23-59-59",
            "December must render as 12"
        );
    }
}

function testEveryFieldIsZeroPadded() {
    console.log("Running zero padding tests...");

    // db_2026-8-12_20-36-2 in the report: a single-digit second was not padded.
    {
        const result = formatBackupTimestamp(new Date(2026, 8, 12, 20, 36, 2));
        assertEquals(
            result,
            "2026-09-12_20-36-02",
            "Single-digit seconds must be padded"
        );
    }

    {
        const result = formatBackupTimestamp(new Date(2026, 0, 1, 0, 0, 0));
        assertEquals(
            result,
            "2026-01-01_00-00-00",
            "Midnight on the first of the month must pad every field"
        );
    }
}

function testNamesSortChronologically() {
    console.log("Running sort order tests...");

    // Zero padding means a plain lexicographic sort of the backups directory
    // lists the backups in the order they were taken.
    const taken = [
        new Date(2026, 8, 12, 20, 36, 2),
        new Date(2026, 0, 23, 20, 25, 49),
        new Date(2026, 8, 12, 20, 35, 56),
        new Date(2026, 11, 31, 23, 59, 59)
    ];

    const sorted = taken.map((date) => formatBackupTimestamp(date)).sort();

    assertEquals(
        sorted.join(","),
        [
            "2026-01-23_20-25-49",
            "2026-09-12_20-35-56",
            "2026-09-12_20-36-02",
            "2026-12-31_23-59-59"
        ].join(","),
        "Backup names must sort into the order the backups were taken"
    );
}

function testFormatBackupFileName() {
    console.log("Running backup file name formatting tests...");

    const date = new Date(2026, 8, 12, 20, 35, 56);

    // With semver version string without leading 'v'
    assertEquals(
        formatBackupFileName("1.22.0", date),
        "db_2026-09-12_20-35-56_v1.22.0.sqlite",
        "Filename must include timestamp and prefixed version tag"
    );

    // With version string already containing 'v'
    assertEquals(
        formatBackupFileName("v1.22.0", date),
        "db_2026-09-12_20-35-56_v1.22.0.sqlite",
        "Filename must not duplicate 'v' prefix if already present"
    );

    // Without version (fallback/default)
    assertEquals(
        formatBackupFileName(undefined, date),
        "db_2026-09-12_20-35-56.sqlite",
        "Filename without version must match default timestamped format"
    );

    // Distinct versions within the exact same second do not collide
    const sameSecondFile1 = formatBackupFileName("1.21.0", date);
    const sameSecondFile2 = formatBackupFileName("1.22.0", date);
    if (sameSecondFile1 === sameSecondFile2) {
        throw new Error(
            "Backup file names for different versions in the same second must not collide"
        );
    }
}

// Run all tests
try {
    testMonthIsOneIndexed();
    testEveryFieldIsZeroPadded();
    testNamesSortChronologically();
    testFormatBackupFileName();
    console.log("All tests passed successfully!");
} catch (error) {
    console.error("Test failed:", error);
    process.exit(1);
}
