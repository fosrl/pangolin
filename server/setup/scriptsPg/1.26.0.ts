import { db } from "@server/db/pg/driver";
import { sql } from "drizzle-orm";

const version = "1.26.0";

export default async function migration() {
    console.log(`Running setup script ${version}...`);

    try {
        await db.execute(sql`BEGIN`);

        await db.execute(sql`
            ALTER TABLE "resources" ADD "matchBaseDomain" boolean DEFAULT false NOT NULL;
        `);

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
        await db.execute(
            sql`
            CREATE TABLE "customDnsRecords" (
                "customDnsRecordId" serial PRIMARY KEY NOT NULL,
                "domainId" varchar NOT NULL,
                "name" varchar(255) NOT NULL,
                "fullDomain" varchar(255) NOT NULL,
                "type" varchar(10) NOT NULL,
                "values" text NOT NULL,
                "ttl" integer DEFAULT 300 NOT NULL,
                "priority" integer,
                "weight" integer,
                "port" integer,
                "enabled" boolean DEFAULT true NOT NULL,
                "createdAt" bigint NOT NULL,
                "updatedAt" bigint NOT NULL
            );`
        );
        await db.execute(
            sql`
            CREATE TABLE "resourceSessionReauth" (
                "userSessionId" varchar NOT NULL,
                "resourceId" integer NOT NULL,
                "revokedAt" bigint NOT NULL,
                CONSTRAINT "resourceSessionReauth_userSessionId_resourceId_pk" PRIMARY KEY("userSessionId","resourceId")
            );`
        );
        await db.execute(
            sql`
            CREATE TABLE "idpGrants" (
                "grantId" varchar PRIMARY KEY NOT NULL,
                "idpId" integer NOT NULL,
                "refreshToken" text NOT NULL,
                "validatedAt" bigint NOT NULL,
                "attemptedAt" bigint,
                "leaseId" varchar,
                "leaseExpiresAt" bigint,
                "revokedAt" bigint
            );`
        );
        await db.execute(
            sql`
            CREATE TABLE "sessionIdpGrants" (
                "sessionId" varchar PRIMARY KEY NOT NULL,
                "grantId" varchar NOT NULL
            );`
        );
        await db.execute(
            sql`ALTER TABLE "deviceWebAuthCodes" ADD COLUMN "approvingSessionId" varchar;`
        );
        await db.execute(
            sql`ALTER TABLE "idp" ADD COLUMN "sessionRevalidation" boolean DEFAULT false NOT NULL;`
        );
        await db.execute(
            sql`ALTER TABLE "resourceSessions" ADD COLUMN "requestSessionId" varchar;`
        );
        await db.execute(
            sql`ALTER TABLE "customDnsRecords" ADD CONSTRAINT "customDnsRecords_domainId_domains_domainId_fk" FOREIGN KEY ("domainId") REFERENCES "public"."domains"("domainId") ON DELETE cascade ON UPDATE no action;`
        );
        await db.execute(
            sql`ALTER TABLE "resourceSessionReauth" ADD CONSTRAINT "resourceSessionReauth_userSessionId_session_id_fk" FOREIGN KEY ("userSessionId") REFERENCES "public"."session"("id") ON DELETE cascade ON UPDATE no action;`
        );
        await db.execute(
            sql`ALTER TABLE "resourceSessionReauth" ADD CONSTRAINT "resourceSessionReauth_resourceId_resources_resourceId_fk" FOREIGN KEY ("resourceId") REFERENCES "public"."resources"("resourceId") ON DELETE cascade ON UPDATE no action;`
        );
        await db.execute(
            sql`ALTER TABLE "idpGrants" ADD CONSTRAINT "idpGrants_idpId_idp_idpId_fk" FOREIGN KEY ("idpId") REFERENCES "public"."idp"("idpId") ON DELETE cascade ON UPDATE no action;`
        );
        await db.execute(
            sql`ALTER TABLE "sessionIdpGrants" ADD CONSTRAINT "sessionIdpGrants_sessionId_session_id_fk" FOREIGN KEY ("sessionId") REFERENCES "public"."session"("id") ON DELETE cascade ON UPDATE no action;`
        );
        await db.execute(
            sql`ALTER TABLE "sessionIdpGrants" ADD CONSTRAINT "sessionIdpGrants_grantId_idpGrants_grantId_fk" FOREIGN KEY ("grantId") REFERENCES "public"."idpGrants"("grantId") ON DELETE cascade ON UPDATE no action;`
        );
        await db.execute(
            sql`CREATE INDEX "idx_customDnsRecords_fullDomain" ON "customDnsRecords" USING btree ("fullDomain");`
        );
        await db.execute(
            sql`CREATE INDEX "idx_customDnsRecords_domainId" ON "customDnsRecords" USING btree ("domainId");`
        );
        await db.execute(
            sql`ALTER TABLE "idpOrg" ADD COLUMN "autoProvision" boolean DEFAULT false NOT NULL;`
        );
        await db.execute(sql`
            UPDATE "idpOrg"
            SET "autoProvision" = "idp"."autoProvision"
            FROM "idp"
            WHERE "idp"."idpId" = "idpOrg"."idpId";
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
