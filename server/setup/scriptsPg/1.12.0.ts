import { db } from "@server/db/pg/driver";
import { sql } from "drizzle-orm";

const version = "1.12.0";

export default async function migration() {
    console.log(`Running setup script ${version}...`);

    try {
        await db.execute(sql`BEGIN`);

        await db.execute(sql`UPDATE "resourceRules" SET "match" = 'COUNTRY' WHERE "match" = 'GEOIP'`);

        await db.execute(sql`
        CREATE TABLE "accessAuditLog" (
            "id" serial PRIMARY KEY NOT NULL,
            "timestamp" bigint NOT NULL,
            "orgId" varchar NOT NULL,
            "actorType" varchar(50),
            "actor" varchar(255),
            "actorId" varchar(255),
            "resourceId" integer,
            "ip" varchar(45),
            "type" varchar(100) NOT NULL,
            "action" boolean NOT NULL,
            "location" text,
            "userAgent" text,
            "metadata" text
        );
        `);

        await db.execute(sql`
        CREATE TABLE "actionAuditLog" (
            "id" serial PRIMARY KEY NOT NULL,
            "timestamp" bigint NOT NULL,
            "orgId" varchar NOT NULL,
            "actorType" varchar(50) NOT NULL,
            "actor" varchar(255) NOT NULL,
            "actorId" varchar(255) NOT NULL,
            "action" varchar(100) NOT NULL,
            "metadata" text
        );
        `);

        await db.execute(sql`
        CREATE TABLE "dnsRecords" (
            "id" serial PRIMARY KEY NOT NULL,
            "domainId" varchar NOT NULL,
            "recordType" varchar NOT NULL,
            "baseDomain" varchar,
            "value" varchar NOT NULL,
            "verified" boolean DEFAULT false NOT NULL
        );
        `);

        await db.execute(sql`
        CREATE TABLE "requestAuditLog" (
            "id" serial PRIMARY KEY NOT NULL,
            "timestamp" integer NOT NULL,
            "orgId" text,
            "action" boolean NOT NULL,
            "reason" integer NOT NULL,
            "actorType" text,
            "actor" text,
            "actorId" text,
            "resourceId" integer,
            "ip" text,
            "location" text,
            "userAgent" text,
            "metadata" text,
            "headers" text,
            "query" text,
            "originalRequestURL" text,
            "scheme" text,
            "host" text,
            "path" text,
            "method" text,
            "tls" boolean
        );
        `);

        await db.execute(sql`
        CREATE TABLE "blueprints" (
                "blueprintId" serial PRIMARY KEY NOT NULL,
                "orgId" text NOT NULL,
                "name" varchar NOT NULL,
                "source" varchar NOT NULL,
                "createdAt" integer NOT NULL,
                "succeeded" boolean NOT NULL,
                "contents" text NOT NULL,
                "message" text
        );
        `);

        await db.execute(sql`ALTER TABLE "blueprints" ADD CONSTRAINT "blueprints_orgId_orgs_orgId_fk" FOREIGN KEY ("orgId") REFERENCES "public"."orgs"("orgId") ON DELETE cascade ON UPDATE no action;`);

        await db.execute(sql`ALTER TABLE "remoteExitNode" ADD COLUMN "secondaryVersion" varchar;`);
        await db.execute(sql`ALTER TABLE "resources" DROP CONSTRAINT "resources_skipToIdpId_idp_idpId_fk";`);
        await db.execute(sql`ALTER TABLE "domains" ADD COLUMN "certResolver" varchar;`);
        await db.execute(sql`ALTER TABLE "domains" ADD COLUMN "customCertResolver" varchar;`);
        await db.execute(sql`ALTER TABLE "domains" ADD COLUMN "preferWildcardCert" boolean;`);
        await db.execute(sql`ALTER TABLE "orgs" ADD COLUMN "requireTwoFactor" boolean;`);
        await db.execute(sql`ALTER TABLE "orgs" ADD COLUMN "maxSessionLengthHours" integer;`);
        await db.execute(sql`ALTER TABLE "orgs" ADD COLUMN "passwordExpiryDays" integer;`);
        await db.execute(sql`ALTER TABLE "orgs" ADD COLUMN "settingsLogRetentionDaysRequest" integer DEFAULT 7 NOT NULL;`);
        await db.execute(sql`ALTER TABLE "orgs" ADD COLUMN "settingsLogRetentionDaysAccess" integer DEFAULT 0 NOT NULL;`);
        await db.execute(sql`ALTER TABLE "orgs" ADD COLUMN "settingsLogRetentionDaysAction" integer DEFAULT 0 NOT NULL;`);
        await db.execute(sql`ALTER TABLE "resourceSessions" ADD COLUMN "issuedAt" bigint;`);
        await db.execute(sql`ALTER TABLE "resources" ADD COLUMN "proxyProtocol" boolean DEFAULT false NOT NULL;`);
        await db.execute(sql`ALTER TABLE "resources" ADD COLUMN "proxyProtocolVersion" integer DEFAULT 1;`);
        await db.execute(sql`ALTER TABLE "session" ADD COLUMN "issuedAt" bigint;`);
        await db.execute(sql`ALTER TABLE "user" ADD COLUMN "lastPasswordChange" bigint;`);
        await db.execute(sql`ALTER TABLE "accessAuditLog" ADD CONSTRAINT "accessAuditLog_orgId_orgs_orgId_fk" FOREIGN KEY ("orgId") REFERENCES "public"."orgs"("orgId") ON DELETE cascade ON UPDATE no action;`);
        await db.execute(sql`ALTER TABLE "actionAuditLog" ADD CONSTRAINT "actionAuditLog_orgId_orgs_orgId_fk" FOREIGN KEY ("orgId") REFERENCES "public"."orgs"("orgId") ON DELETE cascade ON UPDATE no action;`);
        await db.execute(sql`ALTER TABLE "dnsRecords" ADD CONSTRAINT "dnsRecords_domainId_domains_domainId_fk" FOREIGN KEY ("domainId") REFERENCES "public"."domains"("domainId") ON DELETE cascade ON UPDATE no action;`);
        await db.execute(sql`ALTER TABLE "requestAuditLog" ADD CONSTRAINT "requestAuditLog_orgId_orgs_orgId_fk" FOREIGN KEY ("orgId") REFERENCES "public"."orgs"("orgId") ON DELETE cascade ON UPDATE no action;`);
        await db.execute(sql`CREATE INDEX "idx_identityAuditLog_timestamp" ON "accessAuditLog" USING btree ("timestamp");`);
        await db.execute(sql`CREATE INDEX "idx_identityAuditLog_org_timestamp" ON "accessAuditLog" USING btree ("orgId","timestamp");`);
        await db.execute(sql`CREATE INDEX "idx_actionAuditLog_timestamp" ON "actionAuditLog" USING btree ("timestamp");`);
        await db.execute(sql`CREATE INDEX "idx_actionAuditLog_org_timestamp" ON "actionAuditLog" USING btree ("orgId","timestamp");`);
        await db.execute(sql`CREATE INDEX "idx_requestAuditLog_timestamp" ON "requestAuditLog" USING btree ("timestamp");`);
        await db.execute(sql`CREATE INDEX "idx_requestAuditLog_org_timestamp" ON "requestAuditLog" USING btree ("orgId","timestamp");`);
        await db.execute(sql`ALTER TABLE "resources" ADD CONSTRAINT "resources_skipToIdpId_idp_idpId_fk" FOREIGN KEY ("skipToIdpId") REFERENCES "public"."idp"("idpId") ON DELETE set null ON UPDATE no action;`);
        await db.execute(sql`ALTER TABLE "orgs" DROP COLUMN "settings";`);


        // get all of the domains
        const domainsQuery = await db.execute(sql`SELECT "domainId", "baseDomain" FROM "domains"`);
        const domains = domainsQuery.rows as {
            domainId: string;
            baseDomain: string;
        }[];

        for (const domain of domains) {
            // insert two records into the dnsRecords table for each domain
            await db.execute(sql`
                INSERT INTO "dnsRecords" ("domainId", "recordType", "baseDomain", "value", "verified")
                VALUES (${domain.domainId}, 'A', ${`*.${domain.baseDomain}`}, ${'Server IP Address'}, true)
            `);
            await db.execute(sql`
                INSERT INTO "dnsRecords" ("domainId", "recordType", "baseDomain", "value", "verified")
                VALUES (${domain.domainId}, 'A', ${domain.baseDomain}, ${'Server IP Address'}, true)
            `);
        }

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
