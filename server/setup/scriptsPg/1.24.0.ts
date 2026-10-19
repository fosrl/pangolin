import { db } from "@server/db/pg/driver";
import { sql } from "drizzle-orm";

const version = "1.24.0";

export default async function migration() {
    console.log(`Running setup script ${version}...`);

    try {
        await db.execute(sql`BEGIN`);

        await db.execute(sql`
            ALTER TABLE "resources" RENAME COLUMN "headers" TO "requestHeaders"
        `);

        await db.execute(sql`
            ALTER TABLE "orgs" ADD COLUMN "settingsJitModeLimit" integer DEFAULT 250 NOT NULL;
        `);

        await db.execute(sql`
            ALTER TABLE "resources" ADD COLUMN "responseHeaders" text;
        `);

        await db.execute(sql`COMMIT`);
        console.log("Migrated database");
    } catch (e) {
        await db.execute(sql`ROLLBACK`);
        console.log("Unable to migrate database");
        console.log(e);
        throw e;
    }

    console.log(`${version} migration complete`);
}
