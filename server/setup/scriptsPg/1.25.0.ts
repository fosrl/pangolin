import { db } from "@server/db/pg/driver";
import { APP_PATH } from "@server/lib/consts";
import { sql } from "drizzle-orm";
// import fs from "fs";
// import * as yaml from "js-yaml";
// import path from "path";
// import z from "zod";
// import { fromZodError } from "zod-validation-error";

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
            CREATE TABLE "resourcePolicyMtlsCertificates" (
                "mtlsCertificateId" serial PRIMARY KEY NOT NULL,
                "resourcePolicyId" integer NOT NULL,
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
            sql`ALTER TABLE "resources" ADD COLUMN "forwardIdentityHeaders" boolean DEFAULT true NOT NULL;`
        );
        await db.execute(
            sql`ALTER TABLE "resourcePolicies" ADD COLUMN "mtlsEnabled" boolean DEFAULT false NOT NULL;`
        );
        await db.execute(
            sql`ALTER TABLE "resourcePolicyMtlsCertificates" ADD CONSTRAINT "resourcePolicyMtlsCertificates_resourcePolicyId_resourcePolicies_resourcePolicyId_fk" FOREIGN KEY ("resourcePolicyId") REFERENCES "public"."resourcePolicies"("resourcePolicyId") ON DELETE cascade ON UPDATE no action;`
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

    // try {
    //     const traefikPath = path.join(
    //         APP_PATH,
    //         "traefik",
    //         "traefik_config.yml"
    //     );

    //     const schema = z.object({
    //         experimental: z.object({
    //             plugins: z.object({
    //                 badger: z.object({
    //                     moduleName: z.string(),
    //                     version: z.string()
    //                 })
    //             })
    //         })
    //     });

    //     const traefikFileContents = fs.readFileSync(traefikPath, "utf8");
    //     const traefikConfig = yaml.load(traefikFileContents) as any;

    //     const parsedConfig = schema.safeParse(traefikConfig);

    //     if (!parsedConfig.success) {
    //         throw new Error(fromZodError(parsedConfig.error).toString());
    //     }

    //     traefikConfig.experimental.plugins.badger.version = "v1.8.0";

    //     const updatedTraefikYaml = yaml.dump(traefikConfig);

    //     fs.writeFileSync(traefikPath, updatedTraefikYaml, "utf8");

    //     console.log(
    //         "Updated the version of Badger in your Traefik configuration to v1.8.0"
    //     );
    // } catch (e) {
    //     console.log(
    //         "We were unable to update the version of Badger in your Traefik configuration. Please update it manually. Check the release notes for this version for more information."
    //     );
    //     console.error(e);
    // }

    console.log(`${version} migration complete`);
}
