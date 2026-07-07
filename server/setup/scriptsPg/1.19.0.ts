import { db } from "@server/db/pg/driver";
import { APP_PATH, __DIRNAME } from "@server/lib/consts";
import { sql } from "drizzle-orm";
import fs from "fs";
import yaml from "js-yaml";
import path, { join } from "path";
import z from "zod";
import { fromZodError } from "zod-validation-error";

const version = "1.19.0";

const dev = process.env.ENVIRONMENT !== "prod";
let namesFile;
if (!dev) {
    namesFile = join(__DIRNAME, "names.json");
} else {
    namesFile = join("server/db/names.json");
}
export const names = JSON.parse(fs.readFileSync(namesFile, "utf-8"));

export function generateName(): string {
    const name = (
        names.descriptors[
            Math.floor(Math.random() * names.descriptors.length)
        ] +
        "-" +
        names.animals[Math.floor(Math.random() * names.animals.length)]
    )
        .toLowerCase()
        .replace(/\s/g, "-");

    // Clean out non-alphanumeric characters except dashes.
    return name.replace(/[^a-z0-9-]/g, "");
}

export default async function migration() {
    console.log(`Running setup script ${version}...`);

    try {
        await db.execute(sql`BEGIN`);

        await db.execute(sql`
            CREATE TABLE "clientLabels" (
                "clientLabelId" serial PRIMARY KEY NOT NULL,
                "clientId" integer NOT NULL,
                "labelId" integer NOT NULL,
                CONSTRAINT "client_label_uniq" UNIQUE("clientId","labelId")
            );
        `);

        await db.execute(sql`
            CREATE TABLE "labels" (
                "labelId" serial PRIMARY KEY NOT NULL,
                "name" varchar NOT NULL,
                "color" varchar NOT NULL,
                "orgId" varchar NOT NULL
            );
        `);

        await db.execute(sql`
            CREATE TABLE "resourceLabels" (
                "resourceLabelId" serial PRIMARY KEY NOT NULL,
                "resourceId" integer NOT NULL,
                "labelId" integer NOT NULL,
                CONSTRAINT "resource_label_uniq" UNIQUE("resourceId","labelId")
            );
        `);

        await db.execute(sql`
            CREATE TABLE "resourcePolicies" (
                "resourcePolicyId" serial PRIMARY KEY NOT NULL,
                "sso" boolean DEFAULT true NOT NULL,
                "applyRules" boolean DEFAULT false NOT NULL,
                "scope" varchar DEFAULT 'global' NOT NULL,
                "emailWhitelistEnabled" boolean DEFAULT false NOT NULL,
                "idpId" integer,
                "niceId" text NOT NULL,
                "name" varchar NOT NULL,
                "orgId" varchar NOT NULL
            );
        `);

        await db.execute(sql`
            CREATE TABLE "resourcePolicyHeaderAuth" (
                "headerAuthId" serial PRIMARY KEY NOT NULL,
                "headerAuthHash" varchar NOT NULL,
                "extendedCompatibility" boolean DEFAULT true NOT NULL,
                "resourcePolicyId" integer NOT NULL
            );
        `);

        await db.execute(sql`
            CREATE TABLE "resourcePolicyPassword" (
                "passwordId" serial PRIMARY KEY NOT NULL,
                "passwordHash" varchar NOT NULL,
                "resourcePolicyId" integer NOT NULL
            );
        `);

        await db.execute(sql`
            CREATE TABLE "resourcePolicyPincode" (
                "pincodeId" serial PRIMARY KEY NOT NULL,
                "pincodeHash" varchar NOT NULL,
                "digitLength" integer NOT NULL,
                "resourcePolicyId" integer NOT NULL
            );
        `);

        await db.execute(sql`
            CREATE TABLE "resourcePolicyRules" (
                "ruleId" serial PRIMARY KEY NOT NULL,
                "resourcePolicyId" integer NOT NULL,
                "enabled" boolean DEFAULT true NOT NULL,
                "priority" integer NOT NULL,
                "action" varchar NOT NULL,
                "match" varchar NOT NULL,
                "value" varchar NOT NULL
            );
        `);

        await db.execute(sql`
            CREATE TABLE "resourcePolicyWhitelist" (
                "id" serial PRIMARY KEY NOT NULL,
                "email" varchar NOT NULL,
                "resourcePolicyId" integer NOT NULL
            );
        `);

        await db.execute(sql`
            CREATE TABLE "rolePolicies" (
                "roleId" integer NOT NULL,
                "resourcePolicyId" integer NOT NULL
            );
        `);

        await db.execute(sql`
            CREATE TABLE "siteLabels" (
                "siteLabelId" serial PRIMARY KEY NOT NULL,
                "siteId" integer NOT NULL,
                "labelId" integer NOT NULL,
                CONSTRAINT "site_label_uniq" UNIQUE("siteId","labelId")
            );
        `);

        await db.execute(sql`
            CREATE TABLE "siteResourceLabels" (
                "siteResourceLabelId" serial PRIMARY KEY NOT NULL,
                "siteResourceId" integer NOT NULL,
                "labelId" integer NOT NULL,
                CONSTRAINT "site_resource_label_uniq" UNIQUE("siteResourceId","labelId")
            );
        `);

        await db.execute(sql`
            CREATE TABLE "userPolicies" (
                "userId" varchar NOT NULL,
                "resourcePolicyId" integer NOT NULL
            );
        `);

        await db.execute(
            sql`ALTER TABLE "siteResources" ALTER COLUMN "destination" DROP NOT NULL;`
        );
        await db.execute(
            sql`ALTER TABLE "orgs" ADD COLUMN "settingsEnableGlobalNewtAutoUpdate" boolean DEFAULT false NOT NULL;`
        );
        await db.execute(
            sql`ALTER TABLE "resourceAccessToken" ADD COLUMN "path" varchar;`
        );
        await db.execute(
            sql`ALTER TABLE "resources" ADD COLUMN "resourcePolicyId" integer;`
        );
        await db.execute(
            sql`ALTER TABLE "resources" ADD COLUMN "defaultResourcePolicyId" integer;`
        );
        await db.execute(
            sql`ALTER TABLE "resources" ADD COLUMN "mode" text DEFAULT 'http' NOT NULL;`
        );
        await db.execute(sql`
            UPDATE "resources"
            SET "mode" = CASE
                WHEN COALESCE("http", true) = true THEN 'http'
                WHEN COALESCE("http", false) = false AND LOWER(COALESCE("protocol", '')) = 'tcp' THEN 'tcp'
                WHEN COALESCE("http", false) = false AND LOWER(COALESCE("protocol", '')) = 'udp' THEN 'udp'
                ELSE 'http'
            END;
        `);
        await db.execute(
            sql`ALTER TABLE "resources" ADD COLUMN "pamMode" varchar(32) DEFAULT 'passthrough';`
        );
        await db.execute(
            sql`ALTER TABLE "resources" ADD COLUMN "authDaemonMode" varchar(32) DEFAULT 'site';`
        );
        await db.execute(
            sql`ALTER TABLE "resources" ADD COLUMN "authDaemonPort" integer DEFAULT 22123;`
        );
        await db.execute(
            sql`ALTER TABLE "siteResources" ADD COLUMN "pamMode" varchar(32) DEFAULT 'passthrough';`
        );
        await db.execute(sql`
            UPDATE "siteResources"
            SET "pamMode" = 'push'
            WHERE LOWER(COALESCE("mode", '')) = 'host';
        `);
        await db.execute(
            sql`ALTER TABLE "sites" ADD COLUMN "autoUpdateEnabled" boolean DEFAULT false NOT NULL;`
        );
        await db.execute(
            sql`ALTER TABLE "sites" ADD COLUMN "autoUpdateOverrideOrg" boolean DEFAULT false NOT NULL;`
        );
        await db.execute(
            sql`ALTER TABLE "clientLabels" ADD CONSTRAINT "clientLabels_clientId_clients_clientId_fk" FOREIGN KEY ("clientId") REFERENCES "public"."clients"("clientId") ON DELETE cascade ON UPDATE no action;`
        );
        await db.execute(
            sql`ALTER TABLE "clientLabels" ADD CONSTRAINT "clientLabels_labelId_labels_labelId_fk" FOREIGN KEY ("labelId") REFERENCES "public"."labels"("labelId") ON DELETE cascade ON UPDATE no action;`
        );
        await db.execute(
            sql`ALTER TABLE "labels" ADD CONSTRAINT "labels_orgId_orgs_orgId_fk" FOREIGN KEY ("orgId") REFERENCES "public"."orgs"("orgId") ON DELETE cascade ON UPDATE no action;`
        );
        await db.execute(
            sql`ALTER TABLE "resourceLabels" ADD CONSTRAINT "resourceLabels_resourceId_resources_resourceId_fk" FOREIGN KEY ("resourceId") REFERENCES "public"."resources"("resourceId") ON DELETE cascade ON UPDATE no action;`
        );
        await db.execute(
            sql`ALTER TABLE "resourceLabels" ADD CONSTRAINT "resourceLabels_labelId_labels_labelId_fk" FOREIGN KEY ("labelId") REFERENCES "public"."labels"("labelId") ON DELETE cascade ON UPDATE no action;`
        );
        await db.execute(
            sql`ALTER TABLE "resourcePolicies" ADD CONSTRAINT "resourcePolicies_idpId_idp_idpId_fk" FOREIGN KEY ("idpId") REFERENCES "public"."idp"("idpId") ON DELETE set null ON UPDATE no action;`
        );
        await db.execute(
            sql`ALTER TABLE "resourcePolicies" ADD CONSTRAINT "resourcePolicies_orgId_orgs_orgId_fk" FOREIGN KEY ("orgId") REFERENCES "public"."orgs"("orgId") ON DELETE cascade ON UPDATE no action;`
        );
        await db.execute(
            sql`ALTER TABLE "resourcePolicyHeaderAuth" ADD CONSTRAINT "resourcePolicyHeaderAuth_resourcePolicyId_resourcePolicies_resourcePolicyId_fk" FOREIGN KEY ("resourcePolicyId") REFERENCES "public"."resourcePolicies"("resourcePolicyId") ON DELETE cascade ON UPDATE no action;`
        );
        await db.execute(
            sql`ALTER TABLE "resourcePolicyPassword" ADD CONSTRAINT "resourcePolicyPassword_resourcePolicyId_resourcePolicies_resourcePolicyId_fk" FOREIGN KEY ("resourcePolicyId") REFERENCES "public"."resourcePolicies"("resourcePolicyId") ON DELETE cascade ON UPDATE no action;`
        );
        await db.execute(
            sql`ALTER TABLE "resourcePolicyPincode" ADD CONSTRAINT "resourcePolicyPincode_resourcePolicyId_resourcePolicies_resourcePolicyId_fk" FOREIGN KEY ("resourcePolicyId") REFERENCES "public"."resourcePolicies"("resourcePolicyId") ON DELETE cascade ON UPDATE no action;`
        );
        await db.execute(
            sql`ALTER TABLE "resourcePolicyRules" ADD CONSTRAINT "resourcePolicyRules_resourcePolicyId_resourcePolicies_resourcePolicyId_fk" FOREIGN KEY ("resourcePolicyId") REFERENCES "public"."resourcePolicies"("resourcePolicyId") ON DELETE cascade ON UPDATE no action;`
        );
        await db.execute(
            sql`ALTER TABLE "resourcePolicyWhitelist" ADD CONSTRAINT "resourcePolicyWhitelist_resourcePolicyId_resourcePolicies_resourcePolicyId_fk" FOREIGN KEY ("resourcePolicyId") REFERENCES "public"."resourcePolicies"("resourcePolicyId") ON DELETE cascade ON UPDATE no action;`
        );
        await db.execute(
            sql`ALTER TABLE "rolePolicies" ADD CONSTRAINT "rolePolicies_roleId_roles_roleId_fk" FOREIGN KEY ("roleId") REFERENCES "public"."roles"("roleId") ON DELETE cascade ON UPDATE no action;`
        );
        await db.execute(
            sql`ALTER TABLE "rolePolicies" ADD CONSTRAINT "rolePolicies_resourcePolicyId_resourcePolicies_resourcePolicyId_fk" FOREIGN KEY ("resourcePolicyId") REFERENCES "public"."resourcePolicies"("resourcePolicyId") ON DELETE cascade ON UPDATE no action;`
        );
        await db.execute(
            sql`ALTER TABLE "siteLabels" ADD CONSTRAINT "siteLabels_siteId_sites_siteId_fk" FOREIGN KEY ("siteId") REFERENCES "public"."sites"("siteId") ON DELETE cascade ON UPDATE no action;`
        );
        await db.execute(
            sql`ALTER TABLE "siteLabels" ADD CONSTRAINT "siteLabels_labelId_labels_labelId_fk" FOREIGN KEY ("labelId") REFERENCES "public"."labels"("labelId") ON DELETE cascade ON UPDATE no action;`
        );
        await db.execute(
            sql`ALTER TABLE "siteResourceLabels" ADD CONSTRAINT "siteResourceLabels_siteResourceId_siteResources_siteResourceId_fk" FOREIGN KEY ("siteResourceId") REFERENCES "public"."siteResources"("siteResourceId") ON DELETE cascade ON UPDATE no action;`
        );
        await db.execute(
            sql`ALTER TABLE "siteResourceLabels" ADD CONSTRAINT "siteResourceLabels_labelId_labels_labelId_fk" FOREIGN KEY ("labelId") REFERENCES "public"."labels"("labelId") ON DELETE cascade ON UPDATE no action;`
        );
        await db.execute(
            sql`ALTER TABLE "userPolicies" ADD CONSTRAINT "userPolicies_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;`
        );
        await db.execute(
            sql`ALTER TABLE "userPolicies" ADD CONSTRAINT "userPolicies_resourcePolicyId_resourcePolicies_resourcePolicyId_fk" FOREIGN KEY ("resourcePolicyId") REFERENCES "public"."resourcePolicies"("resourcePolicyId") ON DELETE cascade ON UPDATE no action;`
        );
        await db.execute(
            sql`ALTER TABLE "resources" ADD CONSTRAINT "resources_resourcePolicyId_resourcePolicies_resourcePolicyId_fk" FOREIGN KEY ("resourcePolicyId") REFERENCES "public"."resourcePolicies"("resourcePolicyId") ON DELETE set null ON UPDATE no action;`
        );
        await db.execute(
            sql`ALTER TABLE "resources" ADD CONSTRAINT "resources_defaultResourcePolicyId_resourcePolicies_resourcePolicyId_fk" FOREIGN KEY ("defaultResourcePolicyId") REFERENCES "public"."resourcePolicies"("resourcePolicyId") ON DELETE restrict ON UPDATE no action;`
        );
        await db.execute(sql`ALTER TABLE "resources" DROP COLUMN "http";`);
        await db.execute(sql`ALTER TABLE "resources" DROP COLUMN "protocol";`);
        await db.execute(
            sql`ALTER TABLE "targets" ADD "mode" text DEFAULT 'http' NOT NULL;`
        );
        await db.execute(sql`
            UPDATE "targets"
            SET "mode" = "resources"."mode"
            FROM "resources"
            WHERE "resources"."resourceId" = "targets"."resourceId";
        `);
        await db.execute(sql`ALTER TABLE "targets" ADD "authToken" text;`);
        await db.execute(sql`
            ALTER TABLE "resourceSessions" ADD COLUMN "policyPasswordId" integer;
        `);
        await db.execute(sql`
            ALTER TABLE "resourceSessions" ADD COLUMN "policyPincodeId" integer;
        `);
        await db.execute(sql`
            ALTER TABLE "resourceSessions" ADD COLUMN "policyWhitelistId" integer;
        `);
        await db.execute(sql`
            ALTER TABLE "resourceSessions" ADD CONSTRAINT "resourceSessions_policyPasswordId_resourcePolicyPassword_passwordId_fk" FOREIGN KEY ("policyPasswordId") REFERENCES "public"."resourcePolicyPassword"("passwordId") ON DELETE cascade ON UPDATE no action;
        `);
        await db.execute(sql`
            ALTER TABLE "resourceSessions" ADD CONSTRAINT "resourceSessions_policyPincodeId_resourcePolicyPincode_pincodeId_fk" FOREIGN KEY ("policyPincodeId") REFERENCES "public"."resourcePolicyPincode"("pincodeId") ON DELETE cascade ON UPDATE no action;
        `);
        await db.execute(sql`
            ALTER TABLE "resourceSessions" ADD CONSTRAINT "resourceSessions_policyWhitelistId_resourcePolicyWhitelist_id_fk" FOREIGN KEY ("policyWhitelistId") REFERENCES "public"."resourcePolicyWhitelist"("id") ON DELETE cascade ON UPDATE no action;
        `);
        // remove not null/default from sso, applyRules, and emailWhitelistEnabled in preparation for resource policies
        await db.execute(
            sql`ALTER TABLE "resources" ALTER COLUMN "sso" DROP NOT NULL;`
        );
        await db.execute(
            sql`ALTER TABLE "resources" ALTER COLUMN "sso" DROP DEFAULT;`
        );
        await db.execute(
            sql`ALTER TABLE "resources" ALTER COLUMN "applyRules" DROP NOT NULL;`
        );
        await db.execute(
            sql`ALTER TABLE "resources" ALTER COLUMN "applyRules" DROP DEFAULT;`
        );
        await db.execute(
            sql`ALTER TABLE "resources" ALTER COLUMN "emailWhitelistEnabled" DROP NOT NULL;`
        );
        await db.execute(
            sql`ALTER TABLE "resources" ALTER COLUMN "emailWhitelistEnabled" DROP DEFAULT;`
        );

        await db.execute(sql`COMMIT`);
        console.log("Migrated database");
    } catch (e) {
        await db.execute(sql`ROLLBACK`);
        console.log("Unable to migrate database");
        console.log(e);
        throw e;
    }

    try {
        const existingResourcesQuery = await db.execute(sql`
            SELECT
                "resourceId",
                "orgId",
                "niceId",
                COALESCE("sso", true) AS "sso",
                COALESCE("applyRules", false) AS "applyRules",
                COALESCE("emailWhitelistEnabled", false) AS "emailWhitelistEnabled",
                "skipToIdpId"
            FROM "resources"
        `);
        const existingResources = existingResourcesQuery.rows as {
            resourceId: number;
            orgId: string;
            niceId: string;
            sso: boolean;
            applyRules: boolean;
            emailWhitelistEnabled: boolean;
            skipToIdpId: number | null;
        }[];

        if (existingResources.length > 0) {
            const usedPolicyNiceIds = new Set<string>();

            await db.execute(sql`BEGIN`);
            try {
                for (const resource of existingResources) {
                    let policyNiceId = "";
                    let loops = 0;
                    while (true) {
                        if (loops > 100) {
                            throw new Error(
                                `Could not generate a unique policy name for resource ${resource.resourceId}`
                            );
                        }

                        const candidate = generateName();
                        const existingPolicy = await db.execute(sql`
                            SELECT 1
                            FROM "resourcePolicies"
                            WHERE "orgId" = ${resource.orgId}
                            AND "niceId" = ${candidate}
                            LIMIT 1
                        `);

                        if (
                            !usedPolicyNiceIds.has(candidate) &&
                            existingPolicy.rows.length === 0
                        ) {
                            usedPolicyNiceIds.add(candidate);
                            policyNiceId = candidate;
                            break;
                        }

                        loops++;
                    }

                    const policyName = `default policy for ${resource.niceId}`;

                    const insertedPolicy = await db.execute(sql`
                        INSERT INTO "resourcePolicies" (
                            "sso",
                            "applyRules",
                            "scope",
                            "emailWhitelistEnabled",
                            "niceId",
                            "idpId",
                            "name",
                            "orgId"
                        ) VALUES (
                            ${resource.sso},
                            ${resource.applyRules},
                            'resource',
                            ${resource.emailWhitelistEnabled},
                            ${policyNiceId},
                            ${resource.skipToIdpId},
                            ${policyName},
                            ${resource.orgId}
                        )
                        RETURNING "resourcePolicyId"
                    `);
                    const resourcePolicyId = (
                        insertedPolicy.rows[0] as { resourcePolicyId: number }
                    ).resourcePolicyId;

                    await db.execute(sql`
                        UPDATE "resources"
                        SET
                            "defaultResourcePolicyId" = ${resourcePolicyId}
                        WHERE "resourceId" = ${resource.resourceId}
                    `);

                    const existingPincodes = await db.execute(sql`
                        SELECT "pincodeHash", "digitLength"
                        FROM "resourcePincode"
                        WHERE "resourceId" = ${resource.resourceId}
                    `);
                    for (const pincode of existingPincodes.rows as {
                        pincodeHash: string;
                        digitLength: number;
                    }[]) {
                        await db.execute(sql`
                            INSERT INTO "resourcePolicyPincode" (
                                "pincodeHash",
                                "digitLength",
                                "resourcePolicyId"
                            ) VALUES (
                                ${pincode.pincodeHash},
                                ${pincode.digitLength},
                                ${resourcePolicyId}
                            )
                        `);
                    }

                    const existingPasswords = await db.execute(sql`
                        SELECT "passwordHash"
                        FROM "resourcePassword"
                        WHERE "resourceId" = ${resource.resourceId}
                    `);
                    for (const password of existingPasswords.rows as {
                        passwordHash: string;
                    }[]) {
                        await db.execute(sql`
                            INSERT INTO "resourcePolicyPassword" (
                                "passwordHash",
                                "resourcePolicyId"
                            ) VALUES (
                                ${password.passwordHash},
                                ${resourcePolicyId}
                            )
                        `);
                    }

                    const headerCompatibilityQuery = await db.execute(sql`
                        SELECT COALESCE("extendedCompatibilityIsActivated", true) AS "extendedCompatibility"
                        FROM "resourceHeaderAuthExtendedCompatibility"
                        WHERE "resourceId" = ${resource.resourceId}
                        LIMIT 1
                    `);
                    const extendedCompatibility =
                        headerCompatibilityQuery.rows.length > 0
                            ? (
                                  headerCompatibilityQuery.rows[0] as {
                                      extendedCompatibility: boolean;
                                  }
                              ).extendedCompatibility
                            : true;

                    const existingHeaderAuth = await db.execute(sql`
                        SELECT "headerAuthHash"
                        FROM "resourceHeaderAuth"
                        WHERE "resourceId" = ${resource.resourceId}
                    `);
                    for (const headerAuth of existingHeaderAuth.rows as {
                        headerAuthHash: string;
                    }[]) {
                        await db.execute(sql`
                            INSERT INTO "resourcePolicyHeaderAuth" (
                                "headerAuthHash",
                                "extendedCompatibility",
                                "resourcePolicyId"
                            ) VALUES (
                                ${headerAuth.headerAuthHash},
                                ${extendedCompatibility},
                                ${resourcePolicyId}
                            )
                        `);
                    }

                    const existingRules = await db.execute(sql`
                        SELECT "enabled", "priority", "action", "match", "value"
                        FROM "resourceRules"
                        WHERE "resourceId" = ${resource.resourceId}
                    `);
                    for (const rule of existingRules.rows as {
                        enabled: boolean;
                        priority: number;
                        action: string;
                        match: string;
                        value: string;
                    }[]) {
                        await db.execute(sql`
                            INSERT INTO "resourcePolicyRules" (
                                "resourcePolicyId",
                                "enabled",
                                "priority",
                                "action",
                                "match",
                                "value"
                            ) VALUES (
                                ${resourcePolicyId},
                                ${rule.enabled},
                                ${rule.priority},
                                ${rule.action},
                                ${rule.match},
                                ${rule.value}
                            )
                        `);
                    }

                    const existingWhitelist = await db.execute(sql`
                        SELECT "email"
                        FROM "resourceWhitelist"
                        WHERE "resourceId" = ${resource.resourceId}
                    `);
                    for (const whitelistRow of existingWhitelist.rows as {
                        email: string;
                    }[]) {
                        await db.execute(sql`
                            INSERT INTO "resourcePolicyWhitelist" (
                                "email",
                                "resourcePolicyId"
                            ) VALUES (
                                ${whitelistRow.email},
                                ${resourcePolicyId}
                            )
                        `);
                    }

                    const existingRoleResources = await db.execute(sql`
                        SELECT "roleId"
                        FROM "roleResources"
                        WHERE "resourceId" = ${resource.resourceId}
                    `);
                    for (const roleRow of existingRoleResources.rows as {
                        roleId: number;
                    }[]) {
                        await db.execute(sql`
                            INSERT INTO "rolePolicies" ("roleId", "resourcePolicyId")
                            SELECT ${roleRow.roleId}, ${resourcePolicyId}
                            WHERE NOT EXISTS (
                                SELECT 1
                                FROM "rolePolicies"
                                WHERE "roleId" = ${roleRow.roleId}
                                  AND "resourcePolicyId" = ${resourcePolicyId}
                            )
                        `);
                    }

                    const existingUserResources = await db.execute(sql`
                        SELECT "userId"
                        FROM "userResources"
                        WHERE "resourceId" = ${resource.resourceId}
                    `);
                    for (const userRow of existingUserResources.rows as {
                        userId: string;
                    }[]) {
                        await db.execute(sql`
                            INSERT INTO "userPolicies" ("userId", "resourcePolicyId")
                            SELECT ${userRow.userId}, ${resourcePolicyId}
                            WHERE NOT EXISTS (
                                SELECT 1
                                FROM "userPolicies"
                                WHERE "userId" = ${userRow.userId}
                                  AND "resourcePolicyId" = ${resourcePolicyId}
                            )
                        `);
                    }

                    await db.execute(sql`
                        DELETE FROM "resourcePincode"
                        WHERE "resourceId" = ${resource.resourceId}
                    `);
                    await db.execute(sql`
                        DELETE FROM "resourcePassword"
                        WHERE "resourceId" = ${resource.resourceId}
                    `);
                    await db.execute(sql`
                        DELETE FROM "resourceHeaderAuth"
                        WHERE "resourceId" = ${resource.resourceId}
                    `);
                    await db.execute(sql`
                        DELETE FROM "resourceHeaderAuthExtendedCompatibility"
                        WHERE "resourceId" = ${resource.resourceId}
                    `);
                    await db.execute(sql`
                        DELETE FROM "resourceRules"
                        WHERE "resourceId" = ${resource.resourceId}
                    `);
                    await db.execute(sql`
                        DELETE FROM "resourceWhitelist"
                        WHERE "resourceId" = ${resource.resourceId}
                    `);
                }

                // clear the sso, applyRules, and emailWhitelistEnabled columns on all resources since that information is now in the resource policies
                await db.execute(sql`
                    UPDATE "resources"
                    SET "sso" = null,
                        "applyRules" = null,
                        "emailWhitelistEnabled" = null
                `);

                await db.execute(sql`COMMIT`);
                console.log(
                    `Migrated inline resource policies for ${existingResources.length} resource(s)`
                );
            } catch (e) {
                await db.execute(sql`ROLLBACK`);
                throw e;
            }
        }
    } catch (e) {
        console.log("Unable to migrate inline resource policies");
        console.log(e);
        throw e;
    }

    try {
        const traefikPath = path.join(
            APP_PATH,
            "traefik",
            "traefik_config.yml"
        );

        const schema = z.object({
            experimental: z.object({
                plugins: z.object({
                    badger: z.object({
                        moduleName: z.string(),
                        version: z.string()
                    })
                })
            })
        });

        const traefikFileContents = fs.readFileSync(traefikPath, "utf8");
        const traefikConfig = yaml.load(traefikFileContents) as any;

        const parsedConfig = schema.safeParse(traefikConfig);

        if (!parsedConfig.success) {
            throw new Error(fromZodError(parsedConfig.error).toString());
        }

        traefikConfig.experimental.plugins.badger.version = "v1.4.1";

        const updatedTraefikYaml = yaml.dump(traefikConfig);

        fs.writeFileSync(traefikPath, updatedTraefikYaml, "utf8");

        console.log(
            "Updated the version of Badger in your Traefik configuration to v1.4.1"
        );
    } catch (e) {
        console.log(
            "We were unable to update the version of Badger in your Traefik configuration. Please update it manually. Check the release notes for this version for more information."
        );
        console.error(e);
    }

    console.log(`${version} migration complete`);
}
