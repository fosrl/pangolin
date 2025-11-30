import { APP_PATH } from "@server/lib/consts";
import Database from "better-sqlite3";
import path from "path";

const version = "1.11.1";

export default async function migration() {
    console.log(`Running setup script ${version}...`);

    const location = path.join(APP_PATH, "db", "db.sqlite");
    const db = new Database(location);

    db.transaction(() => {
        db.prepare(`UPDATE exitNodes SET online = 1`).run(); // mark exit nodes as online
    })();

    console.log(`${version} migration complete`);
}
