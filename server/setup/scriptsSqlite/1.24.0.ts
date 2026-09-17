import { APP_PATH } from "@server/lib/consts";
import Database from "better-sqlite3";
import path from "path";

const version = "1.24.0";

export default async function migration() {
    console.log(`Running setup script ${version}...`);

    const location = path.join(APP_PATH, "db", "db.sqlite");
    const db = new Database(location);

    try {
        db.pragma("foreign_keys = OFF");

        db.transaction(() => {
            const columns = db
                .prepare(`PRAGMA table_info('resources')`)
                .all() as { name: string }[];
            if (!columns.some((column) => column.name === "createdAt")) {
                db.prepare(
                    `ALTER TABLE 'resources' ADD COLUMN 'createdAt' text;`
                ).run();
            }
        })();

        db.pragma("foreign_keys = ON");

        console.log("Migrated database");
    } catch (e) {
        console.log("Failed to migrate db:", e);
        throw e;
    }

    console.log(`${version} migration complete`);
}
