import { execFileSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";
import { assertEquals } from "@test/assert";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..", "..", "..", "..");

const CHILD_SCRIPT_PATH = path.join(
    repoRoot,
    "server",
    "private",
    "lib",
    "traefik",
    "getTraefikConfig.childTest.ts"
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
        path.join(os.tmpdir(), "pangolin-traefik-config-")
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

function serviceWith(
    services: Record<string, string[]>,
    needle: string
): [string, string[]] | null {
    const matches = Object.entries(services).filter(([, servers]) =>
        servers.includes(needle)
    );
    return matches.length === 1 ? matches[0] : null;
}

function testCertificateJoinDoesNotMultiplyBackendServers() {
    console.log(
        "Running traefik-config certificate join row-multiplication test..."
    );
    const workdir = createTestEnvironment();
    applyMigrations(workdir);

    const { exitCode, observations, output } = runChild(workdir);
    if (exitCode !== 0) {
        throw new Error("getTraefikConfig child run failed: " + output);
    }

    // The exact bug from the issue: every target row is repeated once per
    // certificate on the resource's base domain, and the tcp/udp load
    // balancer builder does not deduplicate, so the tcp service for the
    // three-certificate domain lists the same backend three times on main.
    const multiTcp = serviceWith(observations.tcpServices, "10.9.9.9:5432");
    if (!multiTcp) {
        throw new Error(
            "no tcp service routes 10.9.9.9:5432: " +
                JSON.stringify(observations.tcpServices)
        );
    }
    assertEquals(
        JSON.stringify(multiTcp[1]),
        JSON.stringify(["10.9.9.9:5432"]),
        "the tcp service for a domain with three certificates must list each backend once"
    );

    // A domain with a single certificate row was already fine; the fix must
    // not change its output.
    const singleTcp = serviceWith(observations.tcpServices, "10.8.8.8:2222");
    if (!singleTcp) {
        throw new Error(
            "no tcp service routes 10.8.8.8:2222: " +
                JSON.stringify(observations.tcpServices)
        );
    }
    assertEquals(
        JSON.stringify(singleTcp[1]),
        JSON.stringify(["10.8.8.8:2222"]),
        "the tcp service for a single-certificate domain must keep its single backend"
    );

    // HTTP services deduplicate by url, so the http resource on the
    // three-certificate domain must still list its backend exactly once.
    const http = serviceWith(observations.httpServices, "http://10.7.7.7:8080");
    if (!http) {
        throw new Error(
            "no http service routes 10.7.7.7:8080: " +
                JSON.stringify(observations.httpServices)
        );
    }
    assertEquals(
        JSON.stringify(http[1]),
        JSON.stringify(["http://10.7.7.7:8080"]),
        "the http service for a domain with three certificates must list its backend once"
    );

    // Exactly the seeded services carry servers; row multiplication must not
    // invent extra services.
    assertEquals(
        Object.keys(observations.tcpServices).length,
        2,
        "expected exactly two tcp services with servers"
    );
    assertEquals(
        Object.keys(observations.httpServices).length,
        1,
        "expected exactly one http service with servers"
    );

    console.log("traefik-config certificate join test passed");
}

function main() {
    let failed = 0;
    for (const test of [testCertificateJoinDoesNotMultiplyBackendServers]) {
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
    console.log("getTraefikConfig tests complete");
}

main();
