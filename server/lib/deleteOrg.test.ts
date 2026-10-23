import { execFileSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";
import { assertEquals } from "@test/assert";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..", "..");

const CHILD_SCRIPT_PATH = path.join(
    repoRoot,
    "server",
    "lib",
    "deleteOrg.childTest.ts"
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
        path.join(os.tmpdir(), "pangolin-org-cleanup-")
    );
    fs.mkdirSync(path.join(workdir, "config", "db"), { recursive: true });
    fs.copyFileSync(
        path.join(repoRoot, "config", "config.example.yml"),
        path.join(workdir, "config", "config.yml")
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

function testOrgCleanupCoversEverySite() {
    console.log("Running deleteOrgById per-site cleanup test...");
    const workdir = createTestEnvironment();
    applyMigrations(workdir);

    const { exitCode, observations, output } = runChild(workdir);
    if (exitCode !== 0) {
        throw new Error("deleteOrgById child run failed: " + output);
    }

    // The exact bug from the issue: with a single-row sites fetch, only one
    // of the four sites gets its side effects. All wireguard peers must be
    // removed from the exit node...
    assertEquals(
        JSON.stringify(observations.peerRemovals),
        JSON.stringify(["wgKey1", "wgKey2"]),
        "deleteOrgById must remove every wireguard site's peer from its exit node"
    );
    // ...and every newt connector must be collected for the terminate message.
    assertEquals(
        JSON.stringify(observations.terminatedNewtIds),
        JSON.stringify(["newtId3", "newtId4"]),
        "deleteOrgById must collect every newt id so all connectors get the terminate message"
    );
    // DB rows must still cascade to nothing left.
    assertEquals(observations.sitesLeft, 0, "all site rows must be gone");
    assertEquals(observations.newtsLeft, 0, "all newt rows must be gone");
    assertEquals(
        observations.sessionsLeft,
        0,
        "all newt session rows must be gone"
    );

    // The gap the issue calls out separately: cleanupSiteAssociations must
    // run for newt sites (deleteSite.ts already does this), so the stale
    // association cache rows for these sites must be cleared.
    assertEquals(
        observations.associationRowsLeft,
        0,
        "newt site cleanup must clear clientSitesAssociationsCache rows"
    );

    console.log("deleteOrgById per-site cleanup test passed");
}

function main() {
    let failed = 0;
    for (const test of [testOrgCleanupCoversEverySite]) {
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
    console.log("deleteOrg tests complete");
}

main();
