import { execFileSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";
import * as yaml from "js-yaml";
import { assertEquals } from "@test/assert";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..", "..", "..");

const CHILD_SCRIPT_PATH = path.join(
    repoRoot,
    "server",
    "routers",
    "badger",
    "exchangeSession.childTest.ts"
);

function runChild(workdir: string): {
    exitCode: number;
    observations: any;
    output: string;
} {
    const tsconfig = ["tsconfig.json", "tsconfig.oss.json"]
        .map((file) => path.join(repoRoot, file))
        .find((file) => fs.existsSync(file));
    if (!tsconfig) {
        throw new Error("No tsconfig found for @server path aliases");
    }
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
    try {
        const output = execFileSync(
            process.execPath,
            [tsxCli, "--tsconfig", tsconfig, CHILD_SCRIPT_PATH],
            {
                cwd: workdir,
                timeout: 120000,
                encoding: "utf8",
                env: { ...process.env, NODE_ENV: "test" }
            }
        );
        const m = output.match(/OBSERVATIONS (.*)/);
        if (!m) {
            throw new Error("child did not print observations: " + output);
        }
        return { exitCode: 0, observations: JSON.parse(m[1]), output };
    } catch (error: any) {
        const output = String(error?.stdout ?? "");
        return { exitCode: 1, observations: null, output };
    }
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
        path.join(os.tmpdir(), "pangolin-badger-cookie-")
    );
    fs.mkdirSync(path.join(workdir, "config", "db"), { recursive: true });

    // The dashboard and resource session lengths must differ, or the bug
    // pinned here is invisible: with equal lengths the wrong constant
    // still produces the right expiry. Write a config that makes the two
    // values unambiguous (24 h dashboard vs 720 h resource), matching the
    // configuration reported in issue #3904.
    const parsed: any = yaml.load(
        fs.readFileSync(
            path.join(repoRoot, "config", "config.example.yml"),
            "utf8"
        )
    );
    parsed.server = parsed.server ?? {};
    parsed.server.dashboard_session_length_hours = 24;
    parsed.server.resource_session_length_hours = 720;
    fs.writeFileSync(
        path.join(workdir, "config", "config.yml"),
        yaml.dump(parsed)
    );

    fs.symlinkSync(
        path.join(repoRoot, "server"),
        path.join(workdir, "server"),
        process.platform === "win32" ? "junction" : "dir"
    );
    fs.symlinkSync(
        path.join(repoRoot, "test"),
        path.join(workdir, "test"),
        process.platform === "win32" ? "junction" : "dir"
    );
    fs.symlinkSync(
        path.join(repoRoot, "node_modules"),
        path.join(workdir, "node_modules"),
        process.platform === "win32" ? "junction" : "dir"
    );
    return workdir;
}

function applyMigrations(workdir: string) {
    const tsconfig = ["tsconfig.json", "tsconfig.oss.json"]
        .map((file) => path.join(repoRoot, file))
        .find((file) => fs.existsSync(file));
    if (!tsconfig) {
        throw new Error("No tsconfig found for @server path aliases");
    }
    const tsxCli = path.join(
        repoRoot,
        "node_modules",
        "tsx",
        "dist",
        "cli.mjs"
    );
    // CI applies migrations with `npm run db:push` before booting the app;
    // server/db/migrate.ts is the drizzle migrator that script invokes.
    const migrationsScript = path.join(repoRoot, "server", "db", "migrate.ts");
    execFileSync(
        process.execPath,
        [tsxCli, "--tsconfig", tsconfig, migrationsScript],
        {
            cwd: workdir,
            timeout: 120000,
            encoding: "utf8",
            env: { ...process.env, NODE_ENV: "test" }
        }
    );
}

function testResourceCookieExpiryFollowsResourceSessionLength() {
    console.log("Running exchangeSession cookie expiry test...");
    const workdir = createTestEnvironment();
    applyMigrations(workdir);

    const { exitCode, observations, output } = runChild(workdir);
    if (exitCode !== 0) {
        throw new Error("exchangeSession child run failed: " + output);
    }
    if (!observations.valid) {
        throw new Error("exchangeSession child did not complete the exchange");
    }

    const HOUR = 3600 * 1000;
    const expectedMs = observations.resourceHours * HOUR;
    const sessionDeltaMs = observations.sessionExpiresAt - observations.startMs;
    const cookieDeltaMs = observations.cookieExpiresMs - observations.startMs;

    // The exact bug from issue #3904: the password/pincode/email-whitelist
    // exchange computes the new session's expiry from the dashboard session
    // length instead of the resource session length, so the browser cookie
    // dies after dashboard_session_length_hours while the database row
    // extends to the full resource window. With 24 h vs 720 h the row and
    // the cookie must both expire ~720 h out.
    assertEquals(
        Math.abs(sessionDeltaMs - expectedMs) < 5 * 60 * 1000,
        true,
        `resource session row must expire ~${observations.resourceHours}h after the exchange (got ${(sessionDeltaMs / HOUR).toFixed(2)}h)`
    );
    assertEquals(
        Math.abs(cookieDeltaMs - expectedMs) < 5 * 60 * 1000,
        true,
        `cookie Expires must be ~${observations.resourceHours}h after the exchange (got ${(cookieDeltaMs / HOUR).toFixed(2)}h)`
    );
    assertEquals(
        observations.sessionSessionLength,
        expectedMs,
        `sessionLength must be the resource session length (${observations.resourceHours}h) exactly`
    );
    console.log("exchangeSession cookie expiry test passed");
}

function main() {
    let failed = 0;
    for (const test of [testResourceCookieExpiryFollowsResourceSessionLength]) {
        try {
            test();
        } catch (error) {
            failed++;
            console.error(`FAIL: ${(error as Error).message}`);
        }
    }
    if (failed > 0) {
        process.exit(1);
    }
    console.log("exchangeSession tests complete");
}

main();
