// Runs against a fresh sqlite database: the test copies the config and links
// the sources into a temp dir, migrates it, then re-runs this file there.
import { execFileSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";
import { assertEquals } from "@test/assert";

const self = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(self), "..", "..");

async function child() {
    await import("@server/extendZod");
    const { db, certificates } = await import("@server/db");
    const { encrypt } = await import("@server/lib/crypto");
    const { default: config } = await import("@server/lib/config");
    const { regionalCache: cache } = await import("#dynamic/lib/cache");
    const { getValidCertificatesForDomains } =
        await import("@server/lib/certificates");

    const secret = config.getRawConfig().server.secret!;
    const now = Math.floor(Date.now() / 1000);
    const past = now - 3600;
    const future = now + 3600;
    const row = (
        domain: string,
        expiresAt: number | null,
        wildcard = false
    ) => ({
        domain,
        expiresAt,
        wildcard,
        status: "valid",
        certFile: encrypt("cert", secret),
        keyFile: encrypt("key", secret),
        createdAt: now,
        updatedAt: now
    });

    await db
        .insert(certificates)
        .values([
            row("fresh.example.com", future),
            row("unknown.example.com", null),
            row("old.example.com", past),
            row("app.example.org", past),
            row("example.org", future, true),
            row("example.net", past, true)
        ]);

    const lookup = async (domain: string, useCache: boolean) =>
        (await getValidCertificatesForDomains(new Set([domain]), useCache))
            .map((c) => c.domain)
            .join(",");

    assertEquals(
        await lookup("fresh.example.com", false),
        "fresh.example.com",
        "unexpired certificate is returned"
    );
    assertEquals(
        await lookup("unknown.example.com", false),
        "unknown.example.com",
        "certificate without expiry is returned"
    );
    assertEquals(
        await lookup("old.example.com", false),
        "",
        "expired exact certificate is not returned"
    );
    assertEquals(
        await lookup("app.example.org", false),
        "example.org",
        "expired exact certificate falls back to the wildcard"
    );
    assertEquals(
        await lookup("app.example.net", false),
        "",
        "expired wildcard certificate is not returned"
    );

    const stale = { id: 1, wildcard: false, expiresAt: past };
    await cache.set("cert:old.example.com", { ...stale, domain: "stale" }, 180);
    assertEquals(
        await lookup("old.example.com", true),
        "",
        "expired exact cache entry is ignored"
    );
    await cache.set("cert:*.example.net", { ...stale, domain: "stale" }, 180);
    assertEquals(
        await lookup("app.example.net", true),
        "",
        "expired wildcard cache entry is ignored"
    );
}

function main() {
    const workdir = fs.mkdtempSync(path.join(os.tmpdir(), "pangolin-certs-"));
    try {
        fs.mkdirSync(path.join(workdir, "config", "db"), { recursive: true });
        fs.copyFileSync(
            path.join(repoRoot, "config", "config.example.yml"),
            path.join(workdir, "config", "config.yml")
        );
        for (const dir of ["server", "test", "node_modules"]) {
            fs.symlinkSync(
                path.join(repoRoot, dir),
                path.join(workdir, dir),
                "junction"
            );
        }
        const tsconfig = ["tsconfig.json", "tsconfig.oss.json"]
            .map((file) => path.join(repoRoot, file))
            .find((file) => fs.existsSync(file))!;
        const run = (...args: string[]) =>
            execFileSync(
                process.execPath,
                [
                    path.join(repoRoot, "node_modules/tsx/dist/cli.mjs"),
                    "--tsconfig",
                    tsconfig,
                    ...args
                ],
                {
                    cwd: workdir,
                    timeout: 120000,
                    stdio: "inherit",
                    env: { ...process.env, NODE_ENV: "test" }
                }
            );
        run(path.join(repoRoot, "server/db/migrate.ts"));
        run(self, "--child");
        console.log("certificate lookup tests passed");
    } finally {
        fs.rmSync(workdir, { recursive: true, force: true });
    }
}

if (process.argv.includes("--child")) {
    child().then(
        () => process.exit(0),
        (error) => {
            console.error(`FAIL: ${error.message}`);
            process.exit(1);
        }
    );
} else {
    main();
}
