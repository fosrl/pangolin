import { build } from "@server/build";
import { db } from "@server/db/pg/driver";
import { APP_PATH } from "@server/lib/consts";
import { sql } from "drizzle-orm";
import fs from "fs";
import yaml from "js-yaml";
import path from "path";
import z from "zod";
import { fromZodError } from "zod-validation-error";

const version = "1.22.0";

const actionsToGrant = ["getSiteResource", "listSiteResources"] as const;

export default async function migration() {
    console.log(`Running setup script ${version}...`);

    try {
        await db.execute(sql`BEGIN`);

        await db.execute(sql`
            CREATE TABLE "aiBudgetBreachEvents" (
                "id" serial PRIMARY KEY NOT NULL,
                "orgId" varchar NOT NULL,
                "budgetId" integer NOT NULL,
                "enforcement" varchar NOT NULL,
                "unit" varchar NOT NULL,
                "period" varchar NOT NULL,
                "amount" real NOT NULL,
                "usageAmount" real NOT NULL,
                "blocked" boolean NOT NULL,
                "requestUserId" varchar,
                "createdAt" bigint NOT NULL
            );
        `);
        await db.execute(sql`
            CREATE TABLE "aiBudgets" (
                "budgetId" serial PRIMARY KEY NOT NULL,
                "orgId" varchar NOT NULL,
                "providerId" integer,
                "modelId" integer,
                "resourceId" integer,
                "siteResourceId" integer,
                "roleId" integer,
                "virtualApiKeyId" varchar,
                "amount" real NOT NULL,
                "unit" varchar NOT NULL,
                "period" varchar DEFAULT 'monthly' NOT NULL,
                "enforcement" varchar DEFAULT 'hard' NOT NULL,
                "enabled" boolean DEFAULT true NOT NULL,
                "createdAt" bigint NOT NULL,
                "updatedAt" bigint NOT NULL,
                CONSTRAINT "ai_budget_provider_uniq" UNIQUE("providerId","unit","period"),
                CONSTRAINT "ai_budget_model_uniq" UNIQUE("modelId","unit","period"),
                CONSTRAINT "ai_budget_resource_uniq" UNIQUE("resourceId","unit","period"),
                CONSTRAINT "ai_budget_site_resource_uniq" UNIQUE("siteResourceId","unit","period"),
                CONSTRAINT "ai_budget_role_uniq" UNIQUE("roleId","unit","period"),
                CONSTRAINT "ai_budget_virtual_api_key_uniq" UNIQUE("virtualApiKeyId","unit","period")
            );
        `);
        await db.execute(sql`
            CREATE TABLE "aiModels" (
                "modelId" serial PRIMARY KEY NOT NULL,
                "providerId" integer NOT NULL,
                "modelKey" varchar NOT NULL,
                "name" varchar NOT NULL,
                "listType" varchar DEFAULT 'allow' NOT NULL,
                "enabled" boolean DEFAULT true NOT NULL,
                "createdAt" bigint NOT NULL,
                "updatedAt" bigint NOT NULL,
                CONSTRAINT "ai_model_provider_key_uniq" UNIQUE("providerId","modelKey")
            );
        `);
        await db.execute(sql`
            CREATE TABLE "aiProviders" (
                "providerId" serial PRIMARY KEY NOT NULL,
                "orgId" varchar NOT NULL,
                "name" varchar NOT NULL,
                "niceId" varchar NOT NULL,
                "type" varchar NOT NULL,
                "upstreamUrl" text,
                "apiKey" text,
                "apiKeyLastChars" varchar,
                "authType" varchar NOT NULL,
                "routingMode" varchar DEFAULT 'url' NOT NULL,
                "capabilities" text DEFAULT '[]' NOT NULL,
                "headers" text,
                "skipTlsVerification" boolean DEFAULT false NOT NULL,
                "enabled" boolean DEFAULT true NOT NULL,
                "createdAt" bigint NOT NULL,
                "updatedAt" bigint NOT NULL
            );
        `);
        await db.execute(sql`
            CREATE TABLE "aiSessionLog" (
                "id" serial PRIMARY KEY NOT NULL,
                "sessionId" varchar NOT NULL,
                "orgId" varchar,
                "providerId" integer,
                "capability" varchar NOT NULL,
                "resourceId" integer,
                "siteResourceId" integer,
                "userId" varchar,
                "virtualApiKeyId" varchar,
                "requestedModel" varchar,
                "isStream" boolean DEFAULT false NOT NULL,
                "requestBody" text,
                "responseBody" text,
                "normalizedRequest" text,
                "normalizedResponse" text,
                "truncated" boolean DEFAULT false NOT NULL,
                "statusCode" integer,
                "createdAt" bigint NOT NULL
            );
        `);
        await db.execute(sql`
            CREATE TABLE "aiUsageRecords" (
                "id" serial PRIMARY KEY NOT NULL,
                "orgId" varchar NOT NULL,
                "providerId" integer,
                "resourceId" integer,
                "siteResourceId" integer,
                "userId" varchar,
                "virtualApiKeyId" varchar,
                "sessionId" varchar,
                "requestedModel" varchar NOT NULL,
                "promptTokens" integer DEFAULT 0 NOT NULL,
                "cacheReadTokens" integer DEFAULT 0 NOT NULL,
                "cacheWriteTokens" integer DEFAULT 0 NOT NULL,
                "completionTokens" integer DEFAULT 0 NOT NULL,
                "reasoningTokens" integer DEFAULT 0 NOT NULL,
                "totalTokens" integer DEFAULT 0 NOT NULL,
                "costUsd" real,
                "estimated" boolean DEFAULT false NOT NULL,
                "createdAt" bigint NOT NULL
            );
        `);
        await db.execute(sql`
            CREATE TABLE "resourceAiModels" (
                "resourceId" integer NOT NULL,
                "modelId" integer NOT NULL,
                "listType" varchar DEFAULT 'allow' NOT NULL,
                CONSTRAINT "resourceAiModels_resourceId_modelId_pk" PRIMARY KEY("resourceId","modelId")
            );
        `);
        await db.execute(sql`
            CREATE TABLE "resourceAiProviders" (
                "resourceId" integer NOT NULL,
                "providerId" integer NOT NULL,
                "accessMode" varchar DEFAULT 'inherit' NOT NULL,
                "enabled" boolean DEFAULT true NOT NULL,
                CONSTRAINT "resourceAiProviders_resourceId_providerId_pk" PRIMARY KEY("resourceId","providerId")
            );
        `);
        await db.execute(sql`
            CREATE TABLE "siteResourceAiModels" (
                "siteResourceId" integer NOT NULL,
                "modelId" integer NOT NULL,
                "listType" varchar DEFAULT 'allow' NOT NULL,
                CONSTRAINT "siteResourceAiModels_siteResourceId_modelId_pk" PRIMARY KEY("siteResourceId","modelId")
            );
        `);
        await db.execute(sql`
            CREATE TABLE "siteResourceAiProviders" (
                "siteResourceId" integer NOT NULL,
                "providerId" integer NOT NULL,
                "accessMode" varchar DEFAULT 'inherit' NOT NULL,
                "enabled" boolean DEFAULT true NOT NULL,
                CONSTRAINT "siteResourceAiProviders_siteResourceId_providerId_pk" PRIMARY KEY("siteResourceId","providerId")
            );
        `);
        await db.execute(sql`
            CREATE TABLE "virtualApiKeyResources" (
                "virtualApiKeyId" varchar NOT NULL,
                "resourceId" integer NOT NULL,
                CONSTRAINT "virtualApiKeyResources_virtualApiKeyId_resourceId_pk" PRIMARY KEY("virtualApiKeyId","resourceId")
            );
        `);
        await db.execute(sql`
            CREATE TABLE "virtualApiKeys" (
                "virtualApiKeyId" varchar PRIMARY KEY NOT NULL,
                "orgId" varchar NOT NULL,
                "kind" varchar NOT NULL,
                "userId" varchar,
                "name" varchar,
                "description" varchar,
                "token" varchar NOT NULL,
                "lastChars" varchar NOT NULL,
                "allResources" boolean DEFAULT false NOT NULL,
                "expiresAt" bigint,
                "lastUsedAt" bigint,
                "createdAt" bigint NOT NULL,
                "createdByUserId" varchar
            );
        `);
        await db.execute(
            sql`ALTER TABLE "clients" ADD COLUMN "exitNodeSubnet" text;`
        );
        await db.execute(
            sql`ALTER TABLE "roles" ALTER COLUMN "sshSudoMode" SET DEFAULT 'full';`
        );

        const licenseKeyCountQuery = await db.execute(
            sql`SELECT COUNT(*)::int as count FROM "licenseKey";`
        );
        const licenseKeyCount = licenseKeyCountQuery.rows[0] as {
            count: number;
        };

        if (
            build === "oss" ||
            (build === "enterprise" && licenseKeyCount.count === 0)
        ) {
            await db.execute(
                sql`UPDATE "roles" SET "sshSudoMode" = 'full' WHERE "sshSudoMode" = 'none';`
            );
        }

        await db.execute(
            sql`ALTER TABLE "targets" ALTER COLUMN "resourceId" DROP NOT NULL;`
        );
        await db.execute(
            sql`ALTER TABLE "subscriptions" ADD COLUMN "override" boolean DEFAULT false;`
        );
        await db.execute(
            sql`ALTER TABLE "orgs" ADD COLUMN "settingsLogRetentionDaysAISessions" integer DEFAULT 0 NOT NULL;`
        );
        await db.execute(
            sql`ALTER TABLE "siteResources" ADD COLUMN "requiresExitNodeConnection" boolean DEFAULT false NOT NULL;`
        );
        await db.execute(
            sql`ALTER TABLE "sites" RENAME COLUMN "subnet" TO "exitNodeSubnet";`
        );
        await db.execute(
            sql`ALTER TABLE "targets" ADD COLUMN "providerId" integer;`
        );
        await db.execute(
            sql`ALTER TABLE "aiBudgetBreachEvents" ADD CONSTRAINT "aiBudgetBreachEvents_orgId_orgs_orgId_fk" FOREIGN KEY ("orgId") REFERENCES "public"."orgs"("orgId") ON DELETE cascade ON UPDATE no action;`
        );
        await db.execute(
            sql`ALTER TABLE "aiBudgetBreachEvents" ADD CONSTRAINT "aiBudgetBreachEvents_budgetId_aiBudgets_budgetId_fk" FOREIGN KEY ("budgetId") REFERENCES "public"."aiBudgets"("budgetId") ON DELETE cascade ON UPDATE no action;`
        );
        await db.execute(
            sql`ALTER TABLE "aiBudgetBreachEvents" ADD CONSTRAINT "aiBudgetBreachEvents_requestUserId_user_id_fk" FOREIGN KEY ("requestUserId") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;`
        );
        await db.execute(
            sql`ALTER TABLE "aiBudgets" ADD CONSTRAINT "aiBudgets_orgId_orgs_orgId_fk" FOREIGN KEY ("orgId") REFERENCES "public"."orgs"("orgId") ON DELETE cascade ON UPDATE no action;`
        );
        await db.execute(
            sql`ALTER TABLE "aiBudgets" ADD CONSTRAINT "aiBudgets_providerId_aiProviders_providerId_fk" FOREIGN KEY ("providerId") REFERENCES "public"."aiProviders"("providerId") ON DELETE cascade ON UPDATE no action;`
        );
        await db.execute(
            sql`ALTER TABLE "aiBudgets" ADD CONSTRAINT "aiBudgets_modelId_aiModels_modelId_fk" FOREIGN KEY ("modelId") REFERENCES "public"."aiModels"("modelId") ON DELETE cascade ON UPDATE no action;`
        );
        await db.execute(
            sql`ALTER TABLE "aiBudgets" ADD CONSTRAINT "aiBudgets_resourceId_resources_resourceId_fk" FOREIGN KEY ("resourceId") REFERENCES "public"."resources"("resourceId") ON DELETE cascade ON UPDATE no action;`
        );
        await db.execute(
            sql`ALTER TABLE "aiBudgets" ADD CONSTRAINT "aiBudgets_siteResourceId_siteResources_siteResourceId_fk" FOREIGN KEY ("siteResourceId") REFERENCES "public"."siteResources"("siteResourceId") ON DELETE cascade ON UPDATE no action;`
        );
        await db.execute(
            sql`ALTER TABLE "aiBudgets" ADD CONSTRAINT "aiBudgets_roleId_roles_roleId_fk" FOREIGN KEY ("roleId") REFERENCES "public"."roles"("roleId") ON DELETE cascade ON UPDATE no action;`
        );
        await db.execute(
            sql`ALTER TABLE "aiBudgets" ADD CONSTRAINT "aiBudgets_virtualApiKeyId_virtualApiKeys_virtualApiKeyId_fk" FOREIGN KEY ("virtualApiKeyId") REFERENCES "public"."virtualApiKeys"("virtualApiKeyId") ON DELETE cascade ON UPDATE no action;`
        );
        await db.execute(
            sql`ALTER TABLE "aiModels" ADD CONSTRAINT "aiModels_providerId_aiProviders_providerId_fk" FOREIGN KEY ("providerId") REFERENCES "public"."aiProviders"("providerId") ON DELETE cascade ON UPDATE no action;`
        );
        await db.execute(
            sql`ALTER TABLE "aiProviders" ADD CONSTRAINT "aiProviders_orgId_orgs_orgId_fk" FOREIGN KEY ("orgId") REFERENCES "public"."orgs"("orgId") ON DELETE cascade ON UPDATE no action;`
        );
        await db.execute(
            sql`ALTER TABLE "aiSessionLog" ADD CONSTRAINT "aiSessionLog_orgId_orgs_orgId_fk" FOREIGN KEY ("orgId") REFERENCES "public"."orgs"("orgId") ON DELETE cascade ON UPDATE no action;`
        );
        await db.execute(
            sql`ALTER TABLE "aiSessionLog" ADD CONSTRAINT "aiSessionLog_providerId_aiProviders_providerId_fk" FOREIGN KEY ("providerId") REFERENCES "public"."aiProviders"("providerId") ON DELETE set null ON UPDATE no action;`
        );
        await db.execute(
            sql`ALTER TABLE "aiSessionLog" ADD CONSTRAINT "aiSessionLog_resourceId_resources_resourceId_fk" FOREIGN KEY ("resourceId") REFERENCES "public"."resources"("resourceId") ON DELETE set null ON UPDATE no action;`
        );
        await db.execute(
            sql`ALTER TABLE "aiSessionLog" ADD CONSTRAINT "aiSessionLog_siteResourceId_siteResources_siteResourceId_fk" FOREIGN KEY ("siteResourceId") REFERENCES "public"."siteResources"("siteResourceId") ON DELETE set null ON UPDATE no action;`
        );
        await db.execute(
            sql`ALTER TABLE "aiSessionLog" ADD CONSTRAINT "aiSessionLog_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;`
        );
        await db.execute(
            sql`ALTER TABLE "aiSessionLog" ADD CONSTRAINT "aiSessionLog_virtualApiKeyId_virtualApiKeys_virtualApiKeyId_fk" FOREIGN KEY ("virtualApiKeyId") REFERENCES "public"."virtualApiKeys"("virtualApiKeyId") ON DELETE set null ON UPDATE no action;`
        );
        await db.execute(
            sql`ALTER TABLE "aiUsageRecords" ADD CONSTRAINT "aiUsageRecords_orgId_orgs_orgId_fk" FOREIGN KEY ("orgId") REFERENCES "public"."orgs"("orgId") ON DELETE cascade ON UPDATE no action;`
        );
        await db.execute(
            sql`ALTER TABLE "aiUsageRecords" ADD CONSTRAINT "aiUsageRecords_providerId_aiProviders_providerId_fk" FOREIGN KEY ("providerId") REFERENCES "public"."aiProviders"("providerId") ON DELETE set null ON UPDATE no action;`
        );
        await db.execute(
            sql`ALTER TABLE "aiUsageRecords" ADD CONSTRAINT "aiUsageRecords_resourceId_resources_resourceId_fk" FOREIGN KEY ("resourceId") REFERENCES "public"."resources"("resourceId") ON DELETE set null ON UPDATE no action;`
        );
        await db.execute(
            sql`ALTER TABLE "aiUsageRecords" ADD CONSTRAINT "aiUsageRecords_siteResourceId_siteResources_siteResourceId_fk" FOREIGN KEY ("siteResourceId") REFERENCES "public"."siteResources"("siteResourceId") ON DELETE set null ON UPDATE no action;`
        );
        await db.execute(
            sql`ALTER TABLE "aiUsageRecords" ADD CONSTRAINT "aiUsageRecords_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;`
        );
        await db.execute(
            sql`ALTER TABLE "aiUsageRecords" ADD CONSTRAINT "aiUsageRecords_virtualApiKeyId_virtualApiKeys_virtualApiKeyId_fk" FOREIGN KEY ("virtualApiKeyId") REFERENCES "public"."virtualApiKeys"("virtualApiKeyId") ON DELETE set null ON UPDATE no action;`
        );
        await db.execute(
            sql`ALTER TABLE "resourceAiModels" ADD CONSTRAINT "resourceAiModels_resourceId_resources_resourceId_fk" FOREIGN KEY ("resourceId") REFERENCES "public"."resources"("resourceId") ON DELETE cascade ON UPDATE no action;`
        );
        await db.execute(
            sql`ALTER TABLE "resourceAiModels" ADD CONSTRAINT "resourceAiModels_modelId_aiModels_modelId_fk" FOREIGN KEY ("modelId") REFERENCES "public"."aiModels"("modelId") ON DELETE cascade ON UPDATE no action;`
        );
        await db.execute(
            sql`ALTER TABLE "resourceAiProviders" ADD CONSTRAINT "resourceAiProviders_resourceId_resources_resourceId_fk" FOREIGN KEY ("resourceId") REFERENCES "public"."resources"("resourceId") ON DELETE cascade ON UPDATE no action;`
        );
        await db.execute(
            sql`ALTER TABLE "resourceAiProviders" ADD CONSTRAINT "resourceAiProviders_providerId_aiProviders_providerId_fk" FOREIGN KEY ("providerId") REFERENCES "public"."aiProviders"("providerId") ON DELETE cascade ON UPDATE no action;`
        );
        await db.execute(
            sql`ALTER TABLE "siteResourceAiModels" ADD CONSTRAINT "siteResourceAiModels_siteResourceId_siteResources_siteResourceId_fk" FOREIGN KEY ("siteResourceId") REFERENCES "public"."siteResources"("siteResourceId") ON DELETE cascade ON UPDATE no action;`
        );
        await db.execute(
            sql`ALTER TABLE "siteResourceAiModels" ADD CONSTRAINT "siteResourceAiModels_modelId_aiModels_modelId_fk" FOREIGN KEY ("modelId") REFERENCES "public"."aiModels"("modelId") ON DELETE cascade ON UPDATE no action;`
        );
        await db.execute(
            sql`ALTER TABLE "siteResourceAiProviders" ADD CONSTRAINT "siteResourceAiProviders_siteResourceId_siteResources_siteResourceId_fk" FOREIGN KEY ("siteResourceId") REFERENCES "public"."siteResources"("siteResourceId") ON DELETE cascade ON UPDATE no action;`
        );
        await db.execute(
            sql`ALTER TABLE "siteResourceAiProviders" ADD CONSTRAINT "siteResourceAiProviders_providerId_aiProviders_providerId_fk" FOREIGN KEY ("providerId") REFERENCES "public"."aiProviders"("providerId") ON DELETE cascade ON UPDATE no action;`
        );
        await db.execute(
            sql`ALTER TABLE "virtualApiKeyResources" ADD CONSTRAINT "virtualApiKeyResources_virtualApiKeyId_virtualApiKeys_virtualApiKeyId_fk" FOREIGN KEY ("virtualApiKeyId") REFERENCES "public"."virtualApiKeys"("virtualApiKeyId") ON DELETE cascade ON UPDATE no action;`
        );
        await db.execute(
            sql`ALTER TABLE "virtualApiKeyResources" ADD CONSTRAINT "virtualApiKeyResources_resourceId_resources_resourceId_fk" FOREIGN KEY ("resourceId") REFERENCES "public"."resources"("resourceId") ON DELETE cascade ON UPDATE no action;`
        );
        await db.execute(
            sql`ALTER TABLE "virtualApiKeys" ADD CONSTRAINT "virtualApiKeys_orgId_orgs_orgId_fk" FOREIGN KEY ("orgId") REFERENCES "public"."orgs"("orgId") ON DELETE cascade ON UPDATE no action;`
        );
        await db.execute(
            sql`ALTER TABLE "virtualApiKeys" ADD CONSTRAINT "virtualApiKeys_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;`
        );
        await db.execute(
            sql`ALTER TABLE "virtualApiKeys" ADD CONSTRAINT "virtualApiKeys_createdByUserId_user_id_fk" FOREIGN KEY ("createdByUserId") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;`
        );
        await db.execute(
            sql`ALTER TABLE "eventStreamingDestinations" ADD "sendAISessionLogs" boolean DEFAULT false NOT NULL;`
        );
        await db.execute(
            sql`CREATE INDEX "idx_ai_budget_breach_events_budget_created" ON "aiBudgetBreachEvents" USING btree ("budgetId","createdAt");`
        );
        await db.execute(
            sql`CREATE INDEX "idx_aiProviders_orgId_niceId" ON "aiProviders" USING btree ("orgId","niceId");`
        );
        await db.execute(
            sql`CREATE INDEX "idx_ai_session_log_org_created" ON "aiSessionLog" USING btree ("orgId","createdAt");`
        );
        await db.execute(
            sql`CREATE INDEX "idx_ai_session_log_org_provider_created" ON "aiSessionLog" USING btree ("orgId","providerId","createdAt");`
        );
        await db.execute(
            sql`CREATE INDEX "idx_ai_session_log_org_resource_created" ON "aiSessionLog" USING btree ("orgId","resourceId","createdAt");`
        );
        await db.execute(
            sql`CREATE INDEX "idx_ai_session_log_org_site_resource_created" ON "aiSessionLog" USING btree ("orgId","siteResourceId","createdAt");`
        );
        await db.execute(
            sql`CREATE INDEX "idx_ai_session_log_org_user_created" ON "aiSessionLog" USING btree ("orgId","userId","createdAt");`
        );
        await db.execute(
            sql`CREATE INDEX "idx_ai_session_log_org_virtual_api_key_created" ON "aiSessionLog" USING btree ("orgId","virtualApiKeyId","createdAt");`
        );
        await db.execute(
            sql`CREATE INDEX "idx_ai_session_log_session" ON "aiSessionLog" USING btree ("sessionId");`
        );
        await db.execute(
            sql`CREATE INDEX "idx_ai_usage_records_org_provider_created" ON "aiUsageRecords" USING btree ("orgId","providerId","createdAt");`
        );
        await db.execute(
            sql`CREATE INDEX "idx_ai_usage_records_org_resource_created" ON "aiUsageRecords" USING btree ("orgId","resourceId","createdAt");`
        );
        await db.execute(
            sql`CREATE INDEX "idx_ai_usage_records_org_site_resource_created" ON "aiUsageRecords" USING btree ("orgId","siteResourceId","createdAt");`
        );
        await db.execute(
            sql`CREATE INDEX "idx_ai_usage_records_org_user_created" ON "aiUsageRecords" USING btree ("orgId","userId","createdAt");`
        );
        await db.execute(
            sql`CREATE INDEX "idx_ai_usage_records_org_virtual_api_key_created" ON "aiUsageRecords" USING btree ("orgId","virtualApiKeyId","createdAt");`
        );
        await db.execute(
            sql`CREATE INDEX "idx_ai_usage_records_session" ON "aiUsageRecords" USING btree ("sessionId");`
        );
        await db.execute(
            sql`CREATE UNIQUE INDEX "virtual_api_key_user_identity_uniq" ON "virtualApiKeys" USING btree ("orgId","userId") WHERE "virtualApiKeys"."kind" = 'user';`
        );
        await db.execute(
            sql`ALTER TABLE "targets" ADD CONSTRAINT "targets_providerId_aiProviders_providerId_fk" FOREIGN KEY ("providerId") REFERENCES "public"."aiProviders"("providerId") ON DELETE cascade ON UPDATE no action;`
        );
        await db.execute(
            sql`CREATE INDEX "idx_targets_providerid_siteid" ON "targets" USING btree ("providerId","siteId");`
        );

        for (const actionId of actionsToGrant) {
            await db.execute(sql`
                INSERT INTO "roleActions" ("roleId", "actionId", "orgId")
                SELECT r."roleId", ${actionId}, r."orgId"
                FROM "roles" r
                WHERE COALESCE(r."isAdmin", false) = false
                  AND NOT EXISTS (
                    SELECT 1 FROM "roleActions" ra
                    WHERE ra."roleId" = r."roleId"
                      AND ra."actionId" = ${actionId}
                      AND ra."orgId" = r."orgId"
                  );
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

        traefikConfig.experimental.plugins.badger.version = "v1.7.0";

        const updatedTraefikYaml = yaml.dump(traefikConfig);

        fs.writeFileSync(traefikPath, updatedTraefikYaml, "utf8");

        console.log(
            "Updated the version of Badger in your Traefik configuration to v1.7.0"
        );
    } catch (e) {
        console.log(
            "We were unable to update the version of Badger in your Traefik configuration. Please update it manually. Check the release notes for this version for more information."
        );
        console.error(e);
    }

    console.log(`${version} migration complete`);
}
