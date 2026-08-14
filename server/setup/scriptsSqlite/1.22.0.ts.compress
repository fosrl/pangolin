import { APP_PATH } from "@server/lib/consts";
import Database from "better-sqlite3";
import path from "path";

const version = "1.22.0";

export default async function migration() {
    console.log(`Running setup script ${version}...`);

    const location = path.join(APP_PATH, "db", "db.sqlite");
    const db = new Database(location);

    try {
        db.pragma("foreign_keys = OFF");

        db.transaction(() => {
            db.prepare(
                `
            ALTER TABLE 'resources' ADD 'enableCompress' integer DEFAULT false NOT NULL;
                `
            ).run();

            db.prepare(
                `
            ALTER TABLE 'resources' ADD 'compressExcludedContentTypes' text;
                `
            ).run();
        })();

        db.pragma("foreign_keys = ON");

        console.log(`${version} migration complete`);
    } catch (e) {
        console.log("Unable to migrate database");
        console.log(e);
        throw e;
    } finally {
        db.close();
    }
}
