import { db } from "@server/db/pg/driver";
import { sql } from "drizzle-orm";

const version = "1.20.0";

export default async function migration() {
    console.log(`Running setup script ${version}...`);

    try {
        await db.execute(sql`BEGIN`);

        await db.execute(sql`
            CREATE TABLE "remoteExitNodePreferenceLabels" (
                "remoteExitNodePreferenceLabelId" serial PRIMARY KEY NOT NULL,
                "remoteExitNodeId" varchar NOT NULL,
                "labelId" integer NOT NULL,
                CONSTRAINT "remote_exit_node_preference_label_uniq" UNIQUE("remoteExitNodeId","labelId")
            );
        `);

        await db.execute(sql`
            CREATE TABLE "remoteExitNodeResources" (
                "remoteExitNodeResourceId" serial PRIMARY KEY NOT NULL,
                "remoteExitNodeId" varchar NOT NULL,
                "destination" varchar NOT NULL
            );
        `);

        await db.execute(sql`
            CREATE TABLE "launcherViews" (
                "viewId" serial PRIMARY KEY NOT NULL,
                "orgId" varchar NOT NULL,
                "userId" varchar,
                "name" varchar NOT NULL,
                "config" text NOT NULL,
                "isDefault" boolean DEFAULT false NOT NULL,
                "createdAt" varchar NOT NULL,
                "updatedAt" varchar NOT NULL
            );
        `);

        await db.execute(
            sql`ALTER TABLE "domains" ADD COLUMN "lastCheckedAt" integer;`
        );

        await db.execute(sql`
            ALTER TABLE "remoteExitNodePreferenceLabels" ADD CONSTRAINT "remoteExitNodePreferenceLabels_remoteExitNodeId_remoteExitNode_id_fk" FOREIGN KEY ("remoteExitNodeId") REFERENCES "public"."remoteExitNode"("id") ON DELETE cascade ON UPDATE no action;
        `);

        await db.execute(sql`
            ALTER TABLE "remoteExitNodePreferenceLabels" ADD CONSTRAINT "remoteExitNodePreferenceLabels_labelId_labels_labelId_fk" FOREIGN KEY ("labelId") REFERENCES "public"."labels"("labelId") ON DELETE cascade ON UPDATE no action;
        `);

        await db.execute(sql`
            ALTER TABLE "remoteExitNodeResources" ADD CONSTRAINT "remoteExitNodeResources_remoteExitNodeId_remoteExitNode_id_fk" FOREIGN KEY ("remoteExitNodeId") REFERENCES "public"."remoteExitNode"("id") ON DELETE cascade ON UPDATE no action;
        `);

        await db.execute(sql`
            ALTER TABLE "launcherViews" ADD CONSTRAINT "launcherViews_orgId_orgs_orgId_fk" FOREIGN KEY ("orgId") REFERENCES "public"."orgs"("orgId") ON DELETE cascade ON UPDATE no action;
        `);

        await db.execute(sql`
            ALTER TABLE "launcherViews" ADD CONSTRAINT "launcherViews_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
        `);

        await db.execute(sql`
            CREATE INDEX "idx_clients_orgid_niceid" ON "clients" USING btree ("orgId","niceId");
        `);

        await db.execute(sql`
            CREATE INDEX "idx_networks_orgid" ON "networks" USING btree ("orgId");
        `);

        await db.execute(sql`
            CREATE INDEX "idx_resourcepolicies_orgid_niceid" ON "resourcePolicies" USING btree ("orgId","niceId");
        `);

        await db.execute(sql`
            CREATE INDEX "idx_resources_niceid" ON "resources" USING btree ("niceId");
        `);

        await db.execute(sql`
            CREATE INDEX "idx_resources_orgid_niceid" ON "resources" USING btree ("orgId","niceId");
        `);

        await db.execute(sql`
            CREATE INDEX "idx_siteresources_orgid_niceid" ON "siteResources" USING btree ("orgId","niceId");
        `);

        await db.execute(sql`
            CREATE INDEX "idx_sites_orgid_niceid" ON "sites" USING btree ("orgId","niceId");
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
