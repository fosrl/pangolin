import { db } from "@server/db/pg/driver";
import { sql } from "drizzle-orm";

const version = "1.25.0";

export default async function migration() {
    console.log(`Running setup script ${version}...`);

    try {
        await db.execute(sql`
            ALTER TABLE "resources"
            ADD COLUMN "verifyUpstreamTls" boolean NOT NULL DEFAULT false;
        `);

        console.log("Migrated database");
    } catch (e) {
        console.log("Unable to migrate database");
        console.log(e);
        throw e;
    }

    console.log(`${version} migration complete`);
}
