import { db } from "@server/db/pg/driver";
import { sql } from "drizzle-orm";

const version = "1.25.0";

export default async function migration() {
    console.log(`Running setup script ${version}...`);

    try {
        await db.execute(sql`BEGIN`);

        await db.execute(sql`
            CREATE TABLE "resourceMtlsCertificates" (
                "mtlsCertificateId" serial PRIMARY KEY NOT NULL,
                "resourceId" integer NOT NULL,
                "name" varchar,
                "certificate" text NOT NULL,
                "subject" varchar,
                "issuer" varchar,
                "serialNumber" varchar,
                "fingerprint" varchar,
                "notBefore" bigint,
                "notAfter" bigint,
                "createdAt" bigint NOT NULL
            );
        `);
        await db.execute(sql`
            CREATE TABLE "clientOrgRoles" (
                "clientId" integer NOT NULL,
                "orgId" varchar NOT NULL,
                "roleId" integer NOT NULL,
                CONSTRAINT "clientOrgRoles_clientId_orgId_roleId_unique" UNIQUE("clientId","orgId","roleId")
            );
        `);
        await db.execute(sql`
            CREATE TABLE "redirects" (
                "redirectId" serial PRIMARY KEY NOT NULL,
                "orgId" varchar NOT NULL,
                "resourceId" integer,
                "domainId" varchar,
                "niceId" text NOT NULL,
                "name" varchar NOT NULL,
                "subdomain" varchar,
                "destinationHost" varchar NOT NULL,
                "pathMatchType" varchar DEFAULT 'regex' NOT NULL,
                "matchPath" varchar,
                "rewritePath" varchar,
                "rewritePathType" varchar,
                "priority" integer DEFAULT 100,
                "permanent" boolean DEFAULT false NOT NULL,
                "ssl" boolean DEFAULT true NOT NULL,
                "enabled" boolean DEFAULT true NOT NULL
            );
        `);
        await db.execute(
            sql`ALTER TABLE "exitNodes" ADD COLUMN "relayPort" integer DEFAULT 21820 NOT NULL;`
        );
        await db.execute(
            sql`ALTER TABLE "resources" ADD COLUMN "loadBalancingStrategy" varchar(32) DEFAULT 'wrr' NOT NULL;`
        );
        await db.execute(
            sql`ALTER TABLE "resources" ADD COLUMN "mtlsEnabled" boolean DEFAULT false NOT NULL;`
        );
        await db.execute(
            sql`ALTER TABLE "resourceMtlsCertificates" ADD CONSTRAINT "resourceMtlsCertificates_resourceId_resources_resourceId_fk" FOREIGN KEY ("resourceId") REFERENCES "public"."resources"("resourceId") ON DELETE cascade ON UPDATE no action;`
        );
        await db.execute(
            sql`ALTER TABLE "clientOrgRoles" ADD CONSTRAINT "clientOrgRoles_clientId_clients_clientId_fk" FOREIGN KEY ("clientId") REFERENCES "public"."clients"("clientId") ON DELETE cascade ON UPDATE no action;`
        );
        await db.execute(
            sql`ALTER TABLE "clientOrgRoles" ADD CONSTRAINT "clientOrgRoles_orgId_orgs_orgId_fk" FOREIGN KEY ("orgId") REFERENCES "public"."orgs"("orgId") ON DELETE cascade ON UPDATE no action;`
        );
        await db.execute(
            sql`ALTER TABLE "clientOrgRoles" ADD CONSTRAINT "clientOrgRoles_roleId_roles_roleId_fk" FOREIGN KEY ("roleId") REFERENCES "public"."roles"("roleId") ON DELETE cascade ON UPDATE no action;`
        );
        await db.execute(
            sql`ALTER TABLE "redirects" ADD CONSTRAINT "redirects_orgId_orgs_orgId_fk" FOREIGN KEY ("orgId") REFERENCES "public"."orgs"("orgId") ON DELETE cascade ON UPDATE no action;`
        );
        await db.execute(
            sql`ALTER TABLE "redirects" ADD CONSTRAINT "redirects_resourceId_resources_resourceId_fk" FOREIGN KEY ("resourceId") REFERENCES "public"."resources"("resourceId") ON DELETE cascade ON UPDATE no action;`
        );
        await db.execute(
            sql`ALTER TABLE "redirects" ADD CONSTRAINT "redirects_domainId_domains_domainId_fk" FOREIGN KEY ("domainId") REFERENCES "public"."domains"("domainId") ON DELETE cascade ON UPDATE no action;`
        );
        await db.execute(
            sql`CREATE INDEX "idx_clientorgroles_roleid" ON "clientOrgRoles" USING btree ("roleId");`
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
