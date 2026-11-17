import { db } from "@server/db/pg/driver";
import { sql } from "drizzle-orm";

const version = "1.27.0";

export default async function migration() {
    console.log(`Running setup script ${version}...`);

    try {
        await db.execute(sql`BEGIN`);

        await db.execute(sql`
            CREATE TABLE "alertLabels" (
                "alertRuleId" integer NOT NULL,
                "labelId" integer NOT NULL
            );
        `);

        await db.execute(sql`
            CREATE TABLE "roleClientSettings" (
                "roleId" integer PRIMARY KEY NOT NULL,
                "orgId" varchar(255) NOT NULL,
                "enabled" boolean DEFAULT false NOT NULL,
                "overrideDns" boolean,
                "mtu" integer,
                "tunnelDns" boolean,
                "primaryDns" varchar(255),
                "secondaryDns" varchar(255),
                "exitNodeTakesPrecedence" boolean,
                "exitNodeSiteResourceId" integer,
                "exitNodeLocked" boolean DEFAULT false NOT NULL,
                "matchDomains" text,
                "preferLocalRoutes" boolean
            );
        `);

        await db.execute(
            sql`ALTER TABLE "alertLabels" ADD CONSTRAINT "alertLabels_alertRuleId_alertRules_alertRuleId_fk" FOREIGN KEY ("alertRuleId") REFERENCES "public"."alertRules"("alertRuleId") ON DELETE cascade ON UPDATE no action;`
        );
        await db.execute(
            sql`ALTER TABLE "alertLabels" ADD CONSTRAINT "alertLabels_labelId_labels_labelId_fk" FOREIGN KEY ("labelId") REFERENCES "public"."labels"("labelId") ON DELETE cascade ON UPDATE no action;`
        );
        await db.execute(
            sql`ALTER TABLE "roleClientSettings" ADD CONSTRAINT "roleClientSettings_roleId_roles_roleId_fk" FOREIGN KEY ("roleId") REFERENCES "public"."roles"("roleId") ON DELETE cascade ON UPDATE no action;`
        );
        await db.execute(
            sql`ALTER TABLE "roleClientSettings" ADD CONSTRAINT "roleClientSettings_orgId_orgs_orgId_fk" FOREIGN KEY ("orgId") REFERENCES "public"."orgs"("orgId") ON DELETE cascade ON UPDATE no action;`
        );
        await db.execute(
            sql`ALTER TABLE "roleClientSettings" ADD CONSTRAINT "roleClientSettings_exitNodeSiteResourceId_siteResources_siteResourceId_fk" FOREIGN KEY ("exitNodeSiteResourceId") REFERENCES "public"."siteResources"("siteResourceId") ON DELETE set null ON UPDATE no action;`
        );

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
