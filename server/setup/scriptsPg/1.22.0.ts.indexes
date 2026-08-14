import { db } from "@server/db/pg/driver";
import { sql } from "drizzle-orm";

const version = "1.22.0";

export default async function migration() {
    console.log(`Running setup script ${version}...`);

    try {
        await db.execute(sql`BEGIN`);

        await db.execute(sql`CREATE INDEX IF NOT EXISTS "idx_session_userId" ON "session" ("userId");`);
        await db.execute(sql`CREATE INDEX IF NOT EXISTS "idx_userOrgs_userId" ON "userOrgs" ("userId");`);
        await db.execute(sql`CREATE INDEX IF NOT EXISTS "idx_resourcePincode_resourceId" ON "resourcePincode" ("resourceId");`);
        await db.execute(sql`CREATE INDEX IF NOT EXISTS "idx_resourcePassword_resourceId" ON "resourcePassword" ("resourceId");`);
        await db.execute(sql`CREATE INDEX IF NOT EXISTS "idx_resourceHeaderAuth_resourceId" ON "resourceHeaderAuth" ("resourceId");`);
        await db.execute(sql`CREATE INDEX IF NOT EXISTS "idx_resourceSessions_resourceId" ON "resourceSessions" ("resourceId");`);
        await db.execute(sql`CREATE INDEX IF NOT EXISTS "idx_resourceSessions_userSessionId" ON "resourceSessions" ("userSessionId");`);
        await db.execute(sql`CREATE INDEX IF NOT EXISTS "idx_resourceWhitelist_resourceId" ON "resourceWhitelist" ("resourceId");`);
        await db.execute(sql`CREATE INDEX IF NOT EXISTS "idx_resourceRules_resourceId" ON "resourceRules" ("resourceId");`);

        await db.execute(sql`COMMIT`);
        console.log(`${version} migration complete`);
    } catch (e) {
        await db.execute(sql`ROLLBACK`);
        console.log("Unable to migrate database");
        console.log(e);
        throw e;
    }
}
