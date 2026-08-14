import { db } from "@server/db/pg/driver";
import { sql } from "drizzle-orm";

const version = "1.22.0";

export default async function migration() {
    console.log(`Running setup script ${version}...`);

    try {
        await db.execute(sql`BEGIN`);

        await db.execute(sql`
            ALTER TABLE "resources" ADD COLUMN "enableCompress" boolean DEFAULT false NOT NULL;
        `);

        await db.execute(sql`
            ALTER TABLE "resources" ADD COLUMN "compressExcludedContentTypes" text;
        `);

        await db.execute(sql`COMMIT`);
        console.log(`${version} migration complete`);
    } catch (e) {
        await db.execute(sql`ROLLBACK`);
        console.log("Unable to migrate database");
        console.log(e);
        throw e;
    }
}
