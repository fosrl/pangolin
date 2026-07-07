import { APP_PATH, __DIRNAME } from "@server/lib/consts";
import Database from "better-sqlite3";
import path from "path";

const version = "1.19.1";

export default async function migration() {
    console.log(`Running setup script ${version}...`);

    const location = path.join(APP_PATH, "db", "db.sqlite");
    const db = new Database(location);

    try {
        db.transaction(() => {
            // remove not null/default from sso, applyRules, and emailWhitelistEnabled in preparation for resource policies
            db.prepare(
                `ALTER TABLE 'resources' ADD COLUMN 'sso2' integer;`
            ).run();
            db.prepare(`UPDATE 'resources' SET "sso2" = "sso";`).run();
            db.prepare(`ALTER TABLE 'resources' DROP COLUMN 'sso';`).run();
            db.prepare(
                `ALTER TABLE 'resources' RENAME COLUMN 'sso2' TO 'sso';`
            ).run();

            db.prepare(
                `ALTER TABLE 'resources' ADD COLUMN 'applyRules2' integer;`
            ).run();
            db.prepare(
                `UPDATE 'resources' SET "applyRules2" = "applyRules";`
            ).run();
            db.prepare(
                `ALTER TABLE 'resources' DROP COLUMN 'applyRules';`
            ).run();
            db.prepare(
                `ALTER TABLE 'resources' RENAME COLUMN 'applyRules2' TO 'applyRules';`
            ).run();

            db.prepare(
                `ALTER TABLE 'resources' ADD COLUMN 'emailWhitelistEnabled2' integer;`
            ).run();
            db.prepare(
                `UPDATE 'resources' SET "emailWhitelistEnabled2" = "emailWhitelistEnabled";`
            ).run();
            db.prepare(
                `ALTER TABLE 'resources' DROP COLUMN 'emailWhitelistEnabled';`
            ).run();
            db.prepare(
                `ALTER TABLE 'resources' RENAME COLUMN 'emailWhitelistEnabled2' TO 'emailWhitelistEnabled';`
            ).run();
        })();

        console.log("Migrated database");
    } catch (e) {
        console.log("Failed to migrate db:", e);
        throw e;
    }

    console.log(`${version} migration complete`);
}
