import { APP_PATH } from "@server/lib/consts";
import Database from "better-sqlite3";
import path from "path";

const version = "1.16.1";

export default async function migration() {
    console.log(`Running setup script ${version}...`);

    const location = path.join(APP_PATH, "db", "db.sqlite");
    const db = new Database(location);

    try {
        db.pragma("foreign_keys = OFF");

        // Helper to check if a column exists in a table
        const columnExists = (table: string, column: string): boolean => {
            const cols = db
                .prepare(`PRAGMA table_info('${table}')`)
                .all() as { name: string }[];
            return cols.some((c) => c.name === column);
        };

        db.transaction(() => {
            // Add DNS authority columns to sites table
            if (!columnExists("sites", "publicIp")) {
                db.prepare(
                    `ALTER TABLE 'sites' ADD 'publicIp' text;`
                ).run();
            }

            if (!columnExists("sites", "dnsAuthorityEnabled")) {
                db.prepare(
                    `ALTER TABLE 'sites' ADD 'dnsAuthorityEnabled' integer DEFAULT false NOT NULL;`
                ).run();
            }

            if (!columnExists("sites", "dnsStatus")) {
                db.prepare(
                    `ALTER TABLE 'sites' ADD 'dnsStatus' text;`
                ).run();
            }

            if (!columnExists("sites", "dnsError")) {
                db.prepare(
                    `ALTER TABLE 'sites' ADD 'dnsError' text;`
                ).run();
            }

            // Add DNS authority columns to resources table
            if (!columnExists("resources", "dnsAuthorityEnabled")) {
                db.prepare(
                    `ALTER TABLE 'resources' ADD 'dnsAuthorityEnabled' integer DEFAULT false NOT NULL;`
                ).run();
            }

            if (!columnExists("resources", "dnsAuthorityTtl")) {
                db.prepare(
                    `ALTER TABLE 'resources' ADD 'dnsAuthorityTtl' integer DEFAULT 60;`
                ).run();
            }

            if (!columnExists("resources", "dnsAuthorityRoutingPolicy")) {
                db.prepare(
                    `ALTER TABLE 'resources' ADD 'dnsAuthorityRoutingPolicy' text DEFAULT 'failover';`
                ).run();
            }

            // Add health check latency column used by intelligent DNS scoring
            if (!columnExists("targetHealthCheck", "hcLatencyMs")) {
                db.prepare(
                    `ALTER TABLE 'targetHealthCheck' ADD 'hcLatencyMs' integer;`
                ).run();
            }

            db.prepare(
                `
                UPDATE "resources"
                SET "dnsAuthorityRoutingPolicy" = 'failover'
                WHERE "dnsAuthorityRoutingPolicy" IS NULL
                   OR "dnsAuthorityRoutingPolicy" NOT IN ('failover', 'roundrobin', 'priority', 'intelligent');
                `
            ).run();
        })();

        db.pragma("foreign_keys = ON");

        console.log(`Migrated database`);
    } catch (e) {
        console.log("Failed to migrate db:", e);
        throw e;
    }

    console.log(`${version} migration complete`);
}
