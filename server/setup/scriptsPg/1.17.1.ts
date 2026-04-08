import { db } from "@server/db/pg/driver";
import { sql } from "drizzle-orm";

const version = "1.17.1";

export default async function migration() {
    console.log(`Running setup script ${version}...`);

    try {
        // Helper to check if a column exists
        const columnExists = async (
            table: string,
            column: string
        ): Promise<boolean> => {
            const result = await db.execute(sql`
                SELECT 1 FROM information_schema.columns
                WHERE table_name = ${table} AND column_name = ${column}
                LIMIT 1
            `);
            return (result as any).rows?.length > 0 || (result as any).length > 0;
        };

        await db.execute(sql`BEGIN`);

        // Add DNS authority columns to sites table
        if (!(await columnExists("sites", "publicIp"))) {
            await db.execute(
                sql`ALTER TABLE "sites" ADD COLUMN "publicIp" varchar;`
            );
        }

        if (!(await columnExists("sites", "dnsAuthorityEnabled"))) {
            await db.execute(
                sql`ALTER TABLE "sites" ADD COLUMN "dnsAuthorityEnabled" boolean DEFAULT false NOT NULL;`
            );
        }

        if (!(await columnExists("sites", "dnsStatus"))) {
            await db.execute(
                sql`ALTER TABLE "sites" ADD COLUMN "dnsStatus" varchar;`
            );
        }

        if (!(await columnExists("sites", "dnsError"))) {
            await db.execute(
                sql`ALTER TABLE "sites" ADD COLUMN "dnsError" text;`
            );
        }

        // Add DNS authority columns to resources table
        if (!(await columnExists("resources", "dnsAuthorityEnabled"))) {
            await db.execute(
                sql`ALTER TABLE "resources" ADD COLUMN "dnsAuthorityEnabled" boolean DEFAULT false NOT NULL;`
            );
        }

        if (!(await columnExists("resources", "dnsAuthorityTtl"))) {
            await db.execute(
                sql`ALTER TABLE "resources" ADD COLUMN "dnsAuthorityTtl" integer DEFAULT 60;`
            );
        }

        if (!(await columnExists("resources", "dnsAuthorityRoutingPolicy"))) {
            await db.execute(
                sql`ALTER TABLE "resources" ADD COLUMN "dnsAuthorityRoutingPolicy" text DEFAULT 'failover';`
            );
        }

        // Add health check latency column used by intelligent DNS scoring
        if (!(await columnExists("targetHealthCheck", "hcLatencyMs"))) {
            await db.execute(
                sql`ALTER TABLE "targetHealthCheck" ADD COLUMN "hcLatencyMs" integer;`
            );
        }

        await db.execute(sql`
            UPDATE "resources"
            SET "dnsAuthorityRoutingPolicy" = 'failover'
            WHERE "dnsAuthorityRoutingPolicy" IS NULL
               OR "dnsAuthorityRoutingPolicy" NOT IN ('failover', 'roundrobin', 'priority', 'intelligent')
        `);

        await db.execute(sql`
            ALTER TABLE "resources"
            DROP CONSTRAINT IF EXISTS "resources_dns_authority_routing_policy_check"
        `);

        await db.execute(sql`
            ALTER TABLE "resources"
            ADD CONSTRAINT "resources_dns_authority_routing_policy_check"
            CHECK ("dnsAuthorityRoutingPolicy" IN ('failover', 'roundrobin', 'priority', 'intelligent'))
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
