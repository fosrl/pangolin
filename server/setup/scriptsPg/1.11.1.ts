import { db } from "@server/db/pg/driver";
import { sql } from "drizzle-orm";

const version = "1.11.1";

export default async function migration() {
    console.log(`Running setup script ${version}...`);

    try {
        await db.execute(sql`BEGIN`);

        await db.execute(sql`UPDATE "exitNodes" SET "online" = true`); // Mark exit nodes as online

        await db.execute(sql`COMMIT`);
        console.log(`Updated sites with exit node`);
    } catch (e) {
        await db.execute(sql`ROLLBACK`);
        console.log("Unable to update sites with exit node");
        console.log(e);
        throw e;
    }

    console.log(`${version} migration complete`);
}
