// Test runner.
//
// Discovers every *.test.ts file in the repo and runs each one in its own
// child process. The test files are standalone scripts that print their
// progress and exit with a non-zero code on failure (see test/assert.ts),
// so process isolation keeps a process.exit() or thrown error in one file
// from aborting the rest of the suite. Results are aggregated here and the
// runner exits non-zero if any file failed.

import { spawnSync } from "node:child_process";
import { globSync } from "node:fs";

const EXCLUDED_DIRS = ["node_modules", "dist", ".next", "init"];

const testFiles = globSync("**/*.test.ts", {
    exclude: (path) => EXCLUDED_DIRS.some((dir) => path.split(/[\\/]/).includes(dir))
}).sort();

if (testFiles.length === 0) {
    console.error("No *.test.ts files found.");
    process.exit(1);
}

console.log(`Running ${testFiles.length} test file(s)...\n`);

const failed: string[] = [];

for (const file of testFiles) {
    console.log(`\n──────── ${file} ────────`);
    const result = spawnSync(process.execPath, ["--import", "tsx", file], {
        stdio: "inherit"
    });
    if (result.status !== 0) {
        failed.push(file);
    }
}

console.log(`\n────────────────────────────`);
console.log(`Passed: ${testFiles.length - failed.length}/${testFiles.length}`);

if (failed.length > 0) {
    console.error(`\nFailed test files:`);
    for (const file of failed) {
        console.error(`  - ${file}`);
    }
    process.exit(1);
}

console.log("All test files passed.");
