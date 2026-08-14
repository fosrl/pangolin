import { APP_PATH } from "@server/lib/consts";
import Database from "better-sqlite3";
import path from "path";

const version = "1.22.0";

export default async function migration() {
    console.log(`Running setup script ${version}...`);

    const location = path.join(APP_PATH, "db", "db.sqlite");
    const db = new Database(location);

    try {
        db.transaction(() => {
            db.prepare(
                `CREATE INDEX IF NOT EXISTS "idx_session_userId" ON "session" ("userId");`
            ).run();
            db.prepare(
                `CREATE INDEX IF NOT EXISTS "idx_userOrgs_userId" ON "userOrgs" ("userId");`
            ).run();
            db.prepare(
                `CREATE INDEX IF NOT EXISTS "idx_resourcePincode_resourceId" ON "resourcePincode" ("resourceId");`
            ).run();
            db.prepare(
                `CREATE INDEX IF NOT EXISTS "idx_resourcePassword_resourceId" ON "resourcePassword" ("resourceId");`
            ).run();
            db.prepare(
                `CREATE INDEX IF NOT EXISTS "idx_resourceHeaderAuth_resourceId" ON "resourceHeaderAuth" ("resourceId");`
            ).run();
            db.prepare(
                `CREATE INDEX IF NOT EXISTS "idx_resourceSessions_resourceId" ON "resourceSessions" ("resourceId");`
            ).run();
            db.prepare(
                `CREATE INDEX IF NOT EXISTS "idx_resourceSessions_userSessionId" ON "resourceSessions" ("userSessionId");`
            ).run();
            db.prepare(
                `CREATE INDEX IF NOT EXISTS "idx_resourceWhitelist_resourceId" ON "resourceWhitelist" ("resourceId");`
            ).run();
            db.prepare(
                `CREATE INDEX IF NOT EXISTS "idx_resourceRules_resourceId" ON "resourceRules" ("resourceId");`
            ).run();
        })();

        console.log(`${version} migration complete`);
    } catch (e) {
        console.log("Unable to migrate database");
        console.log(e);
        throw e;
    } finally {
        db.close();
    }
}
