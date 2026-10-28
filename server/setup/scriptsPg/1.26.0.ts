import { db } from "@server/db/pg/driver";
import { sql } from "drizzle-orm";

const version = "1.26.0";

export default async function migration() {
    console.log(`Running setup script ${version}...`);

    try {
        await db.execute(sql`BEGIN`);

        await db.execute(sql`
            ALTER TABLE "orgs" ADD COLUMN "settingsLogRetentionDaysSsh" integer DEFAULT 0 NOT NULL;
        `);

        await db.execute(sql`
            CREATE TABLE "sshSessionLog" (
                "id" serial PRIMARY KEY NOT NULL,
                "sessionId" varchar NOT NULL,
                "orgId" varchar NOT NULL,
                "siteId" integer NOT NULL,
                "siteResourceId" integer,
                "resourceId" integer,
                "clientId" integer,
                "userId" varchar,
                "transport" varchar DEFAULT 'ssh' NOT NULL,
                "sourceAddr" varchar NOT NULL,
                "destAddr" varchar NOT NULL,
                "username" varchar NOT NULL,
                "authMethod" varchar,
                "keyFingerprint" varchar,
                "certKeyId" varchar,
                "commandCount" integer DEFAULT 0 NOT NULL,
                "startedAt" bigint NOT NULL,
                "endedAt" bigint
            );
        `);
        await db.execute(sql`
            CREATE TABLE "sshCommandLog" (
                "id" serial PRIMARY KEY NOT NULL,
                "sshSessionLogId" integer NOT NULL,
                "orgId" varchar NOT NULL,
                "command" text NOT NULL,
                "channel" varchar NOT NULL,
                "inexact" boolean DEFAULT false NOT NULL,
                "timestamp" bigint NOT NULL
            );
        `);

        await db.execute(
            sql`ALTER TABLE "sshSessionLog" ADD CONSTRAINT "sshSessionLog_orgId_orgs_orgId_fk" FOREIGN KEY ("orgId") REFERENCES "public"."orgs"("orgId") ON DELETE cascade ON UPDATE no action;`
        );
        await db.execute(
            sql`ALTER TABLE "sshSessionLog" ADD CONSTRAINT "sshSessionLog_siteId_sites_siteId_fk" FOREIGN KEY ("siteId") REFERENCES "public"."sites"("siteId") ON DELETE cascade ON UPDATE no action;`
        );
        await db.execute(
            sql`ALTER TABLE "sshSessionLog" ADD CONSTRAINT "sshSessionLog_siteResourceId_siteResources_siteResourceId_fk" FOREIGN KEY ("siteResourceId") REFERENCES "public"."siteResources"("siteResourceId") ON DELETE set null ON UPDATE no action;`
        );
        await db.execute(
            sql`ALTER TABLE "sshSessionLog" ADD CONSTRAINT "sshSessionLog_resourceId_resources_resourceId_fk" FOREIGN KEY ("resourceId") REFERENCES "public"."resources"("resourceId") ON DELETE set null ON UPDATE no action;`
        );
        await db.execute(
            sql`ALTER TABLE "sshSessionLog" ADD CONSTRAINT "sshSessionLog_clientId_clients_clientId_fk" FOREIGN KEY ("clientId") REFERENCES "public"."clients"("clientId") ON DELETE set null ON UPDATE no action;`
        );
        await db.execute(
            sql`ALTER TABLE "sshSessionLog" ADD CONSTRAINT "sshSessionLog_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;`
        );
        await db.execute(
            sql`ALTER TABLE "sshCommandLog" ADD CONSTRAINT "sshCommandLog_sshSessionLogId_sshSessionLog_id_fk" FOREIGN KEY ("sshSessionLogId") REFERENCES "public"."sshSessionLog"("id") ON DELETE cascade ON UPDATE no action;`
        );
        await db.execute(
            sql`ALTER TABLE "sshCommandLog" ADD CONSTRAINT "sshCommandLog_orgId_orgs_orgId_fk" FOREIGN KEY ("orgId") REFERENCES "public"."orgs"("orgId") ON DELETE cascade ON UPDATE no action;`
        );

        await db.execute(
            sql`CREATE UNIQUE INDEX "idx_ssh_session_log_site_session" ON "sshSessionLog" USING btree ("siteId","sessionId");`
        );
        await db.execute(
            sql`CREATE INDEX "idx_ssh_session_log_org_started" ON "sshSessionLog" USING btree ("orgId","startedAt");`
        );
        await db.execute(
            sql`CREATE INDEX "idx_ssh_session_log_org_site_resource_started" ON "sshSessionLog" USING btree ("orgId","siteResourceId","startedAt");`
        );
        await db.execute(
            sql`CREATE INDEX "idx_ssh_session_log_org_resource_started" ON "sshSessionLog" USING btree ("orgId","resourceId","startedAt");`
        );
        await db.execute(
            sql`CREATE INDEX "idx_ssh_session_log_org_user_started" ON "sshSessionLog" USING btree ("orgId","userId","startedAt");`
        );
        await db.execute(
            sql`CREATE INDEX "idx_ssh_command_log_session_timestamp" ON "sshCommandLog" USING btree ("sshSessionLogId","timestamp");`
        );
        await db.execute(
            sql`CREATE INDEX "idx_ssh_command_log_org_timestamp" ON "sshCommandLog" USING btree ("orgId","timestamp");`
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
