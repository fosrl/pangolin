import { db } from "@server/db/pg/driver";
import { sql } from "drizzle-orm";

const version = "1.17.0";

export default async function migration() {
    console.log(`Running setup script ${version}...`);

    try {
        await db.execute(sql`BEGIN`);

        await db.execute(sql`
            CREATE TABLE "resourceGroups" (
                "groupId" serial PRIMARY KEY NOT NULL,
                "orgId" varchar NOT NULL REFERENCES "orgs"("orgId") ON DELETE cascade,
                "name" varchar NOT NULL,
                "sortOrder" integer NOT NULL DEFAULT 0
            );
        `);

        await db.execute(
            sql`ALTER TABLE "resources" ADD COLUMN "groupId" integer;`
        );

        await db.execute(sql`
            ALTER TABLE "resources"
            ADD CONSTRAINT "resources_groupId_fk"
            FOREIGN KEY ("groupId") REFERENCES "resourceGroups"("groupId") ON DELETE set null;
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
