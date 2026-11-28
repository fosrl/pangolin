import fs from "fs";
import os from "os";
import path from "path";
import {
    getMigrationBackupRetention,
    pruneMigrationBackups
} from "./backupRetention";
import { assertEquals, assertEqualsObj } from "@test/assert";

function makeDir(): string {
    return fs.mkdtempSync(path.join(os.tmpdir(), "pangolin-backup-retention-"));
}

// Creates the files in order, oldest first, each one minute apart.
function writeBackups(dir: string, names: string[]) {
    const start = Date.now() - names.length * 60_000;
    names.forEach((name, i) => {
        const file = path.join(dir, name);
        fs.writeFileSync(file, "x");
        const time = new Date(start + i * 60_000);
        fs.utimesSync(file, time, time);
    });
}

function remaining(dir: string): string[] {
    return fs.readdirSync(dir).sort();
}

function testKeepsNewestAndCurrentRun() {
    console.log("Running keep-newest test...");
    const dir = makeDir();
    try {
        writeBackups(dir, [
            "db_2026-0-11_3-42-57.sqlite", // old 0-based month name
            "db_2026-10-01_22-28-14_v1.24.0.sqlite",
            "db_2026-10-21_21-56-53_v1.25.0.sqlite",
            "db_2026-11-04_21-57-35_v1.26.0.sqlite",
            "db_2026-11-20_07-00-16_v1.27.0.sqlite",
            // made by the current run
            "db_2026-11-21_12-23-04_v1.27.1.sqlite",
            "db_2026-11-21_12-23-05_v1.28.0.sqlite"
        ]);

        const deleted = pruneMigrationBackups(dir, 2, [
            "db_2026-11-21_12-23-04_v1.27.1.sqlite",
            "db_2026-11-21_12-23-05_v1.28.0.sqlite"
        ]);

        assertEqualsObj(
            deleted.sort(),
            [
                "db_2026-0-11_3-42-57.sqlite",
                "db_2026-10-01_22-28-14_v1.24.0.sqlite",
                "db_2026-10-21_21-56-53_v1.25.0.sqlite"
            ],
            "Only the oldest backups beyond the retention count are deleted"
        );
        assertEqualsObj(
            remaining(dir),
            [
                "db_2026-11-04_21-57-35_v1.26.0.sqlite",
                "db_2026-11-20_07-00-16_v1.27.0.sqlite",
                "db_2026-11-21_12-23-04_v1.27.1.sqlite",
                "db_2026-11-21_12-23-05_v1.28.0.sqlite"
            ],
            "The current run's backups plus the 2 newest older ones remain"
        );
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
}

function testCurrentRunIsKeptEvenWhenItIsOld() {
    console.log("Running current-run protection test...");
    const dir = makeDir();
    try {
        // The protected file is the oldest by mtime; it must still survive.
        writeBackups(dir, [
            "db_2026-11-21_12-23-04_v1.27.1.sqlite",
            "db_2026-11-22_10-00-00_v1.27.2.sqlite",
            "db_2026-11-23_10-00-00_v1.27.3.sqlite"
        ]);
        pruneMigrationBackups(dir, 1, [
            "db_2026-11-21_12-23-04_v1.27.1.sqlite"
        ]);
        assertEqualsObj(
            remaining(dir),
            [
                "db_2026-11-21_12-23-04_v1.27.1.sqlite",
                "db_2026-11-23_10-00-00_v1.27.3.sqlite"
            ],
            "A backup made by the current run is never deleted"
        );
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
}

function testLeavesOtherFilesAlone() {
    console.log("Running unrelated-files test...");
    const dir = makeDir();
    try {
        writeBackups(dir, [
            "db_manual_cleanup_1776733505.sqlite",
            "notes.txt",
            "db.sqlite",
            "db_2026-11-20_07-00-16_v1.27.0.sqlite",
            "db_2026-11-21_12-23-04_v1.27.1.sqlite"
        ]);
        fs.mkdirSync(path.join(dir, "db_2026-11-01_00-00-00_v1.0.0.sqlite"));

        const deleted = pruneMigrationBackups(dir, 1);
        assertEqualsObj(
            deleted,
            ["db_2026-11-20_07-00-16_v1.27.0.sqlite"],
            "Only files named like migration backups are pruned"
        );
        assertEquals(
            fs.existsSync(
                path.join(dir, "db_manual_cleanup_1776733505.sqlite")
            ),
            true,
            "Manually named copies are kept"
        );
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
}

function testRetentionDisabled() {
    console.log("Running disabled-retention test...");
    const dir = makeDir();
    try {
        writeBackups(dir, [
            "db_2026-11-20_07-00-16_v1.27.0.sqlite",
            "db_2026-11-21_12-23-04_v1.27.1.sqlite"
        ]);
        assertEqualsObj(
            pruneMigrationBackups(dir, 0),
            [],
            "keep = 0 deletes nothing"
        );
        assertEquals(remaining(dir).length, 2, "Both backups remain");
        assertEqualsObj(
            pruneMigrationBackups(path.join(dir, "missing"), 3),
            [],
            "A missing folder is not an error"
        );
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
}

function testReadRetentionFromEnv() {
    console.log("Running env parsing test...");
    const cases: Array<[string | undefined, number]> = [
        [undefined, 0],
        ["", 0],
        ["  ", 0],
        ["5", 5],
        [" 3 ", 3],
        ["0", 0],
        ["-2", 0],
        ["2.5", 0],
        ["ten", 0]
    ];
    for (const [raw, expected] of cases) {
        const env: Record<string, string | undefined> =
            raw === undefined ? {} : { MIGRATION_BACKUP_RETENTION: raw };
        assertEquals(
            getMigrationBackupRetention(env),
            expected,
            `MIGRATION_BACKUP_RETENTION=${JSON.stringify(raw)}`
        );
    }
}

try {
    testKeepsNewestAndCurrentRun();
    testCurrentRunIsKeptEvenWhenItIsOld();
    testLeavesOtherFilesAlone();
    testRetentionDisabled();
    testReadRetentionFromEnv();
    console.log("All tests passed successfully!");
} catch (error) {
    console.error("Test failed:", error);
    process.exit(1);
}
