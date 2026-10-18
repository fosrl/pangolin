import { db } from "@server/db/pg/driver";
import { sql } from "drizzle-orm";

const version = "1.25.0";

export default async function migration() {
    console.log(`Running setup script ${version}...`);

    try {
        await db.transaction(async (trx) => {
            await trx.execute(sql`
                ALTER TABLE "resources"
                ADD COLUMN "verifyUpstreamTls" boolean NOT NULL DEFAULT false;
            `);
            await trx.execute(sql`
                CREATE TABLE "resourceUpstreamCa" (
                    "resourceId" integer PRIMARY KEY NOT NULL
                        REFERENCES "resources"("resourceId") ON DELETE CASCADE,
                    "certificatePem" text NOT NULL
                );
            `);
        });

        console.log("Migrated database");
    } catch (e) {
        console.log("Unable to migrate database");
        console.log(e);
        throw e;
    }

    console.log(`${version} migration complete`);
}
