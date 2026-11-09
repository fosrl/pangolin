import { execFileSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";
import { assertEquals } from "@test/assert";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..", "..");

function tsconfigPath(): string {
    const tsconfig = ["tsconfig.json", "tsconfig.oss.json"]
        .map((file) => path.join(repoRoot, file))
        .find((file) => fs.existsSync(file));
    if (!tsconfig) {
        throw new Error("No tsconfig found for @server path aliases");
    }
    return tsconfig;
}

function runTsx(workdir: string, script: string): string {
    const tsxCli = path.join(
        repoRoot,
        "node_modules",
        "tsx",
        "dist",
        "cli.mjs"
    );
    if (!fs.existsSync(tsxCli)) {
        throw new Error("tsx is not installed; run npm ci first");
    }
    return execFileSync(
        process.execPath,
        [tsxCli, "--tsconfig", tsconfigPath(), script],
        {
            cwd: workdir,
            timeout: 120000,
            encoding: "utf8",
            env: { ...process.env, NODE_ENV: "test" }
        }
    );
}

function createTestEnvironment(): string {
    for (const generated of ["server/build.ts", "server/db/index.ts"]) {
        if (!fs.existsSync(path.join(repoRoot, generated))) {
            throw new Error(
                `Missing ${generated}; run npm run set:oss && npm run set:sqlite first`
            );
        }
    }
    const workdir = fs.mkdtempSync(
        path.join(os.tmpdir(), "pangolin-ai-budget-")
    );
    fs.mkdirSync(path.join(workdir, "config", "db"), { recursive: true });
    fs.copyFileSync(
        path.join(repoRoot, "config", "config.example.yml"),
        path.join(workdir, "config", "config.yml")
    );
    for (const linked of ["server", "test", "node_modules"]) {
        fs.symlinkSync(
            path.join(repoRoot, linked),
            path.join(workdir, linked),
            process.platform === "win32" ? "junction" : "dir"
        );
    }
    return workdir;
}

function testBudgetsUseRecordedUsageWindows() {
    console.log("Running AI budget window tests...");
    const workdir = createTestEnvironment();
    runTsx(workdir, path.join(repoRoot, "server", "db", "migrate.ts"));

    const output = runTsx(
        workdir,
        path.join(repoRoot, "server", "lib", "aiBudgetEnforcement.childTest.ts")
    );
    const match = output.match(/OBSERVATIONS (.*)/);
    if (!match) {
        throw new Error("child did not print observations: " + output);
    }
    const o = JSON.parse(match[1]);

    // Rolling windows over usage stored by recordUsage. These all summed to 0
    // while the lower bound was in ms and createdAt was in seconds.
    assertEquals(o.providerHourlyUsd, 3, "hourly budget must count last hour");
    assertEquals(o.providerDailyUsd, 7, "daily budget must count last 24h");
    assertEquals(o.providerWeeklyUsd, 17, "weekly budget must count last 7d");
    assertEquals(o.providerLifetimeUsd, 17, "lifetime budget must count all");
    assertEquals(o.providerDailyTokens, 750, "token budgets must use tokens");

    // Model budgets match the requested model in JS, and a request with no
    // known price must add 0 rather than poisoning the sum.
    assertEquals(o.wildcardHourlyUsd, 2, "wildcard model hourly usd");
    assertEquals(o.wildcardDailyUsd, 6, "wildcard model daily usd");
    assertEquals(o.wildcardDailyTokens, 650, "wildcard model daily tokens");
    assertEquals(o.exactModelDailyUsd, 1, "exact model daily usd");

    assertEquals(
        o.boundaryDailyUsd,
        1,
        "the window must include its cutoff and exclude the second before it"
    );

    // checkBudgets end to end.
    assertEquals(o.overHardBlocked, true, "over a hard budget must block");
    assertEquals(
        o.overHardBlockingBudgetMatches,
        true,
        "the blocking budget must be the breached one"
    );
    assertEquals(o.overHardBlockedAgain, true, "must keep blocking while over");
    assertEquals(
        o.overHardBreachRows,
        1,
        "a sustained breach must write one event (breach events are in ms)"
    );
    assertEquals(o.underHardBlocked, false, "under budget must not block");
    assertEquals(o.overSoftBlocked, false, "soft budgets must never block");
    assertEquals(o.overSoftBreachRows, 1, "soft breaches must be recorded");
    assertEquals(
        o.expiredBlocked,
        false,
        "usage older than the window must not count"
    );

    console.log("AI budget window tests passed");
}

function main() {
    try {
        testBudgetsUseRecordedUsageWindows();
    } catch (error) {
        console.error(`FAIL: ${(error as Error).message}`);
        process.exit(1);
    }
    console.log("aiBudgetEnforcement tests complete");
}

main();
