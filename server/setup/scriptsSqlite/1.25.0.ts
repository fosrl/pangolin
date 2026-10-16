import { APP_PATH } from "@server/lib/consts";
import Database from "better-sqlite3";
import path from "path";

const version = "1.25.0";

export default async function migration() {
    console.log(`Running setup script ${version}...`);

    const location = path.join(APP_PATH, "db", "db.sqlite");
    const db = new Database(location);

    try {
        db.transaction(() => {
            db.prepare(
                `
                ALTER TABLE 'resources'
                ADD COLUMN 'verifyUpstreamTls' integer NOT NULL DEFAULT 0;
            `
            ).run();
        })();

        console.log("Migrated database");
    } catch (e) {
        console.log("Failed to migrate db:", e);
        throw e;
    } finally {
        db.close();
    }

    console.log(`${version} migration complete`);
}
