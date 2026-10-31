import { execFileSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";
import { assertEquals } from "@test/assert";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..", "..", "..");

const CHILD_SCRIPT_PATH = path.join(
    repoRoot,
    "server",
    "routers",
    "launcher",
    "launcherResourceAccess.childTest.ts"
);

function resolveTsconfig() {
    const tsconfig = ["tsconfig.json", "tsconfig.oss.json"]
        .map((file) => path.join(repoRoot, file))
        .find((file) => fs.existsSync(file));
    if (!tsconfig) {
        throw new Error("No tsconfig found for @server path aliases");
    }
    return tsconfig;
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
        path.join(os.tmpdir(), "pangolin-launcher-access-")
    );
    fs.mkdirSync(path.join(workdir, "config", "db"), { recursive: true });
    fs.copyFileSync(
        path.join(repoRoot, "config", "config.example.yml"),
        path.join(workdir, "config", "config.yml")
    );
    for (const dir of ["server", "test", "node_modules"]) {
        fs.symlinkSync(
            path.join(repoRoot, dir),
            path.join(workdir, dir),
            process.platform === "win32" ? "junction" : "dir"
        );
    }
    return workdir;
}

function runTsx(workdir: string, script: string) {
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
        [tsxCli, "--tsconfig", resolveTsconfig(), script],
        {
            cwd: workdir,
            timeout: 120000,
            encoding: "utf8",
            env: { ...process.env, NODE_ENV: "test" }
        }
    );
}

function applyMigrations(workdir: string) {
    if (
        !fs.existsSync(
            path.join(repoRoot, "server", "migrations", "meta", "_journal.json")
        )
    ) {
        throw new Error(
            "Missing server/migrations; run npm run db:generate first"
        );
    }
    // CI applies migrations with `npm run db:push` before running the suite;
    // server/db/migrate.ts is the drizzle migrator that script invokes.
    runTsx(workdir, path.join(repoRoot, "server", "db", "migrate.ts"));
}

function testNonSsoResourcesAreListedForMembers() {
    console.log("Running launcher non-SSO visibility test...");
    const workdir = createTestEnvironment();
    applyMigrations(workdir);

    let output: string;
    try {
        output = runTsx(workdir, CHILD_SCRIPT_PATH);
    } catch (error: any) {
        throw new Error(
            "launcher access child run failed: " +
                String(error?.stdout ?? "") +
                String(error?.stderr ?? "")
        );
    }

    const match = output.match(/OBSERVATIONS (.*)/);
    if (!match) {
        throw new Error("child did not print observations: " + output);
    }
    const observations = JSON.parse(match[1]);

    // Every member of the org can reach non-SSO resources, so the launcher must
    // list them without an explicit user, role, or policy assignment. Only the
    // effective policy decides, and access-blocking, disabled, unapproved, and
    // foreign-org resources stay hidden.
    assertEquals(
        JSON.stringify(observations.resourceIds),
        JSON.stringify([1, 2, 5, 10]),
        "launcher must list enabled, approved, non-blocked non-SSO resources"
    );
    assertEquals(
        JSON.stringify(observations.siteResourceIds),
        JSON.stringify([]),
        "no site resources are seeded, so none may be returned"
    );
}

testNonSsoResourcesAreListedForMembers();
console.log("launcherResourceAccess tests passed");
