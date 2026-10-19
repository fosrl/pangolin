import { execFileSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";
import Database from "better-sqlite3";
import { assertEquals } from "@test/assert";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..", "..");
const migrationsScript = path.join(here, "migrationsSqlite.ts");

const SEED_STATEMENTS = [
    `CREATE TABLE versionMigrations (version TEXT PRIMARY KEY, executedAt INTEGER NOT NULL)`,
    `INSERT INTO versionMigrations (version, executedAt) VALUES ('1.21.0', 1750000000000)`,
    `CREATE TABLE sites (siteId INTEGER PRIMARY KEY AUTOINCREMENT, subnet TEXT)`,
    `INSERT INTO sites (subnet) VALUES ('10.0.0.0/24')`,
    `CREATE TABLE roles (roleId INTEGER PRIMARY KEY AUTOINCREMENT, orgId TEXT, isAdmin INTEGER DEFAULT 0, sshSudoMode TEXT DEFAULT 'none')`,
    `INSERT INTO roles (orgId, isAdmin, sshSudoMode) VALUES ('org1', 0, 'none')`,
    `CREATE TABLE licenseKey (licenseKeyId INTEGER PRIMARY KEY AUTOINCREMENT)`,
    `CREATE TABLE targets (targetId INTEGER PRIMARY KEY AUTOINCREMENT, resourceId INTEGER, siteId INTEGER NOT NULL, ip TEXT NOT NULL, method TEXT, port INTEGER NOT NULL, internalPort INTEGER, enabled INTEGER DEFAULT 1, path TEXT, pathMatchType TEXT, rewritePath TEXT, rewritePathType TEXT, priority INTEGER DEFAULT 100, mode TEXT DEFAULT 'http', authToken TEXT)`,
    `CREATE TABLE subscriptions (subscriptionId INTEGER PRIMARY KEY AUTOINCREMENT)`,
    `CREATE TABLE clients (clientId INTEGER PRIMARY KEY AUTOINCREMENT)`,
    `CREATE TABLE orgs (orgId TEXT PRIMARY KEY)`,
    `INSERT INTO orgs (orgId) VALUES ('org1')`,
    `CREATE TABLE siteResources (siteResourceId INTEGER PRIMARY KEY AUTOINCREMENT)`,
    `CREATE TABLE eventStreamingDestinations (destinationId INTEGER PRIMARY KEY AUTOINCREMENT)`,
    `CREATE TABLE roleActions (roleId INTEGER, actionId TEXT, orgId TEXT)`,
    `CREATE TABLE newt (newtId INTEGER PRIMARY KEY AUTOINCREMENT)`
];

function seedDatabase(dbPath: string) {
    const db = new Database(dbPath);
    try {
        for (const statement of SEED_STATEMENTS) {
            db.exec(statement);
        }
    } finally {
        db.close();
    }
}

function tableColumns(dbPath: string, tableName: string): string[] {
    const db = new Database(dbPath, { readonly: true });
    try {
        return (
            db.prepare(`PRAGMA table_info(${tableName})`).all() as Array<{
                name: unknown;
            }>
        ).map((row) => String(row.name));
    } finally {
        db.close();
    }
}

function executedMigrationVersions(dbPath: string): string[] {
    const db = new Database(dbPath, { readonly: true });
    try {
        return (
            db.prepare(`SELECT version FROM versionMigrations`).all() as Array<{
                version: unknown;
            }>
        ).map((row) => String(row.version));
    } finally {
        db.close();
    }
}

function runMigrations(
    workdir: string,
    env: Record<string, string> = {}
): {
    exitCode: number;
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
            [tsxCli, "--tsconfig", tsconfig, migrationsScript],
            {
                cwd: workdir,
                timeout: 120000,
                encoding: "utf8",
                env: { ...process.env, NODE_ENV: "test", ...env }
            }
        );
        return { exitCode: 0, output };
    } catch (error) {
        const output =
            error instanceof Error
                ? (error as Error & { stdout?: unknown }).stdout
                : "";
        return { exitCode: 1, output: String(output ?? "") };
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
        path.join(os.tmpdir(), "pangolin-backup-test-")
    );
    fs.mkdirSync(path.join(workdir, "config", "db"), { recursive: true });
    fs.copyFileSync(
        path.join(repoRoot, "config", "config.example.yml"),
        path.join(workdir, "config", "config.yml")
    );
    const traefikSrc = path.join(repoRoot, "config", "traefik");
    if (fs.existsSync(traefikSrc)) {
        fs.cpSync(traefikSrc, path.join(workdir, "config", "traefik"), {
            recursive: true
        });
    }
    fs.symlinkSync(
        path.join(repoRoot, "server"),
        path.join(workdir, "server"),
        process.platform === "win32" ? "junction" : "dir"
    );
    return workdir;
}

function testMultipleSequentialMigrations() {
    console.log("Running multiple sequential migrations test...");
    const workdir = createTestEnvironment();
    try {
        seedDatabase(path.join(workdir, "config", "db", "db.sqlite"));
        const result = runMigrations(workdir);
        assertEquals(result.exitCode, 0, "Seeded migrations must run cleanly");
        if (!result.output.includes("All migrations completed successfully")) {
            throw new Error(
                "Seeded migrations did not complete; the backup assertions below would be vacuous"
            );
        }

        const backupsDir = path.join(workdir, "config", "db", "backups");
        const backups = fs.existsSync(backupsDir)
            ? fs
                  .readdirSync(backupsDir)
                  .filter((file) => file.endsWith(".sqlite"))
            : [];

        // Upgrading from 1.21.0 runs 1.22.0 and 1.23.0 -> produces 2 distinct backups
        assertEquals(
            backups.length,
            2,
            "Each migration must have its own distinct backup snapshot"
        );

        const v122Backup = backups.find((file) =>
            file.includes("_v1.22.0.sqlite")
        );
        const v123Backup = backups.find((file) =>
            file.includes("_v1.23.0.sqlite")
        );

        if (!v122Backup || !v123Backup) {
            throw new Error(
                `Expected backups for v1.22.0 and v1.23.0, found: ${backups.join(", ")}`
            );
        }

        // Verify pre-1.22.0 snapshot state: sites has 'subnet' (not exitNodeSubnet), versions = [1.21.0]
        const v122Columns = tableColumns(
            path.join(backupsDir, v122Backup),
            "sites"
        );
        assertEquals(
            v122Columns.includes("subnet") &&
                !v122Columns.includes("exitNodeSubnet"),
            true,
            "Backup before 1.22.0 must retain pre-1.22.0 schema (sites.subnet)"
        );
        const v122Versions = executedMigrationVersions(
            path.join(backupsDir, v122Backup)
        );
        assertEquals(
            v122Versions.includes("1.21.0") && !v122Versions.includes("1.22.0"),
            true,
            "Backup before 1.22.0 must only record version 1.21.0"
        );

        // Verify pre-1.23.0 snapshot state: sites has 'exitNodeSubnet' (1.22.0 applied), newt has no agent
        const v123Columns = tableColumns(
            path.join(backupsDir, v123Backup),
            "sites"
        );
        assertEquals(
            v123Columns.includes("exitNodeSubnet"),
            true,
            "Backup before 1.23.0 must contain successfully applied 1.22.0 schema (sites.exitNodeSubnet)"
        );
        const v123NewtCols = tableColumns(
            path.join(backupsDir, v123Backup),
            "newt"
        );
        assertEquals(
            !v123NewtCols.includes("agent"),
            true,
            "Backup before 1.23.0 must not contain 1.23.0 schema changes yet"
        );
        const v123Versions = executedMigrationVersions(
            path.join(backupsDir, v123Backup)
        );
        assertEquals(
            v123Versions.includes("1.21.0") && v123Versions.includes("1.22.0"),
            true,
            "Backup before 1.23.0 must record both 1.21.0 and 1.22.0"
        );
    } finally {
        fs.rmSync(workdir, { recursive: true, force: true });
    }
}

function testFailureInLaterMigrationPreservesRestorePoints() {
    console.log("Running failure in later migration test...");
    const workdir = createTestEnvironment();
    try {
        const dbPath = path.join(workdir, "config", "db", "db.sqlite");
        seedDatabase(dbPath);

        // Intentionally drop table 'newt' so migration 1.23.0 fails on ALTER TABLE newt ADD COLUMN agent
        const db = new Database(dbPath);
        db.exec("DROP TABLE newt;");
        db.close();

        const result = runMigrations(workdir);
        assertEquals(
            result.exitCode,
            1,
            "Migration suite must fail when 1.23.0 errors"
        );

        const backupsDir = path.join(workdir, "config", "db", "backups");
        const backups = fs.existsSync(backupsDir)
            ? fs
                  .readdirSync(backupsDir)
                  .filter((file) => file.endsWith(".sqlite"))
            : [];

        // Both pre-1.22.0 and pre-1.23.0 backups must exist
        assertEquals(
            backups.length,
            2,
            "Backups for earlier successful migration and the failed migration must both exist"
        );

        const v122Backup = backups.find((file) =>
            file.includes("_v1.22.0.sqlite")
        );
        const v123Backup = backups.find((file) =>
            file.includes("_v1.23.0.sqlite")
        );

        if (!v122Backup || !v123Backup) {
            throw new Error(
                `Expected restore points for v1.22.0 and v1.23.0, found: ${backups.join(", ")}`
            );
        }

        // Verify pre-1.23.0 backup is a valid restore point with 1.22.0 changes applied
        const v123SitesCols = tableColumns(
            path.join(backupsDir, v123Backup),
            "sites"
        );
        assertEquals(
            v123SitesCols.includes("exitNodeSubnet"),
            true,
            "Pre-failure restore point must have 1.22.0 changes intact"
        );
        const v123Versions = executedMigrationVersions(
            path.join(backupsDir, v123Backup)
        );
        assertEquals(
            v123Versions.includes("1.22.0"),
            true,
            "Pre-failure restore point must record successful 1.22.0 migration"
        );
    } finally {
        fs.rmSync(workdir, { recursive: true, force: true });
    }
}

function testDisableBackupOnMigration() {
    console.log("Running DISABLE_BACKUP_ON_MIGRATION test...");
    const workdir = createTestEnvironment();
    try {
        seedDatabase(path.join(workdir, "config", "db", "db.sqlite"));
        const result = runMigrations(workdir, {
            DISABLE_BACKUP_ON_MIGRATION: "1"
        });
        assertEquals(
            result.exitCode,
            0,
            "Migrations must succeed with backups disabled"
        );

        const backupsDir = path.join(workdir, "config", "db", "backups");
        const backups = fs.existsSync(backupsDir)
            ? fs
                  .readdirSync(backupsDir)
                  .filter((file) => file.endsWith(".sqlite"))
            : [];
        assertEquals(
            backups.length,
            0,
            "No backup files should be created when DISABLE_BACKUP_ON_MIGRATION is set"
        );
    } finally {
        fs.rmSync(workdir, { recursive: true, force: true });
    }
}

try {
    testMultipleSequentialMigrations();
    testFailureInLaterMigrationPreservesRestorePoints();
    testDisableBackupOnMigration();
    console.log("All backup migration regression tests passed successfully!");
} catch (error) {
    console.error("Test failed:", error);
    process.exit(1);
}
