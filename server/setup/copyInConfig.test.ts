import { execFileSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";
import { parse, stringify } from "yaml";
import { assertEquals } from "@test/assert";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..", "..");

const CHILD_SCRIPT_PATH = path.join(
    repoRoot,
    "server",
    "setup",
    "copyInConfig.childTest.ts"
);

function createTestEnvironment(): string {
    for (const generated of ["server/build.ts", "server/db/index.ts"]) {
        if (!fs.existsSync(path.join(repoRoot, generated))) {
            throw new Error(
                `Missing ${generated}; run npm run set:oss && npm run set:sqlite first`
            );
        }
    }
    const workdir = fs.mkdtempSync(
        path.join(os.tmpdir(), "pangolin-copy-in-config-")
    );
    fs.mkdirSync(path.join(workdir, "config", "db"), { recursive: true });
    const exampleConfig = parse(
        fs.readFileSync(
            path.join(repoRoot, "config", "config.example.yml"),
            "utf8"
        )
    );
    exampleConfig.flags = {
        ...(exampleConfig.flags ?? {}),
        disable_config_managed_domains: true
    };
    fs.writeFileSync(
        path.join(workdir, "config", "config.yml"),
        stringify(exampleConfig)
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

function getTsxAndConfig(): { tsconfig: string; tsxCli: string } {
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
    return { tsconfig, tsxCli };
}

function applyMigrations(workdir: string) {
    const { tsconfig, tsxCli } = getTsxAndConfig();
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

function runChild(workdir: string): {
    domainIds: string[];
    dnsRecordDomainIds: string[];
} {
    const { tsconfig, tsxCli } = getTsxAndConfig();
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
    const match = output.match(/OBSERVATIONS (.*)/);
    if (!match) {
        throw new Error("child did not print observations: " + output);
    }
    return JSON.parse(match[1]);
}

function testDisableConfigManagedDomainsRemovesExisting() {
    console.log(
        "Running copyInConfig disable_config_managed_domains cleanup test..."
    );
    const workdir = createTestEnvironment();
    try {
        applyMigrations(workdir);
        const observations = runChild(workdir);

        assertEquals(
            JSON.stringify(observations.domainIds),
            JSON.stringify(["ns_domain"]),
            "copyInConfig must remove config-managed domains when disable_config_managed_domains is true while preserving UI-managed domains"
        );
        assertEquals(
            JSON.stringify(observations.dnsRecordDomainIds),
            JSON.stringify(["ns_domain"]),
            "copyInConfig must remove dnsRecords for removed config-managed domains while preserving UI-managed domain records"
        );
        console.log(
            "copyInConfig disable_config_managed_domains cleanup test passed!"
        );
    } finally {
        fs.rmSync(workdir, { recursive: true, force: true });
    }
}

testDisableConfigManagedDomainsRemovesExisting();
