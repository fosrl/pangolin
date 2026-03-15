import { APP_PATH } from "@server/lib/consts";
import Database from "better-sqlite3";
import path from "path";

const version = "1.17.0";

export default async function migration() {
    console.log(`Running setup script ${version}...`);

    const location = path.join(APP_PATH, "db", "db.sqlite");
    const db = new Database(location);

    try {
        db.pragma("foreign_keys = OFF");

        db.transaction(() => {
            db.prepare(
                `
                CREATE TABLE 'resourceGroups' (
                    'groupId' integer PRIMARY KEY AUTOINCREMENT NOT NULL,
                    'orgId' text NOT NULL REFERENCES 'orgs'('orgId') ON DELETE cascade,
                    'name' text NOT NULL,
                    'sortOrder' integer NOT NULL DEFAULT 0
                );
                `
            ).run();

            db.prepare(
                `ALTER TABLE 'resources' ADD 'groupId' integer REFERENCES 'resourceGroups'('groupId') ON DELETE set null;`
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
