import { build } from "@server/build";
import { APP_PATH } from "@server/lib/consts";
import Database from "better-sqlite3";
import fs from "fs";
import yaml from "js-yaml";
import path from "path";
import z from "zod";
import { fromZodError } from "zod-validation-error";

const version = "1.22.0";

const actionsToGrant = ["getSiteResource", "listSiteResources"] as const;

export default async function migration() {
    console.log(`Running setup script ${version}...`);

    const location = path.join(APP_PATH, "db", "db.sqlite");
    const db = new Database(location);

    try {
        db.pragma("foreign_keys = OFF");

        db.transaction(() => {
            db.prepare(
                `ALTER TABLE 'sites' RENAME COLUMN "subnet" TO "exitNodeSubnet";`
            ).run();

            db.prepare(
                `
                CREATE TABLE 'aiBudgetBreachEvents' (
                    'id' integer PRIMARY KEY AUTOINCREMENT NOT NULL,
                    'orgId' text NOT NULL,
                    'budgetId' integer NOT NULL,
                    'enforcement' text NOT NULL,
                    'unit' text NOT NULL,
                    'period' text NOT NULL,
                    'amount' real NOT NULL,
                    'usageAmount' real NOT NULL,
                    'blocked' integer NOT NULL,
                    'requestUserId' text,
                    'createdAt' integer NOT NULL,
                    FOREIGN KEY ('orgId') REFERENCES 'orgs'('orgId') ON UPDATE no action ON DELETE cascade,
                    FOREIGN KEY ('budgetId') REFERENCES 'aiBudgets'('budgetId') ON UPDATE no action ON DELETE cascade,
                    FOREIGN KEY ('requestUserId') REFERENCES 'user'('id') ON UPDATE no action ON DELETE set null
                );
                `
            ).run();
            db.prepare(
                `
                CREATE INDEX 'idx_ai_budget_breach_events_budget_created' ON 'aiBudgetBreachEvents' ('budgetId','createdAt');
                `
            ).run();
            db.prepare(
                `
                CREATE TABLE 'aiBudgets' (
                    'budgetId' integer PRIMARY KEY AUTOINCREMENT NOT NULL,
                    'orgId' text NOT NULL,
                    'providerId' integer,
                    'modelId' integer,
                    'resourceId' integer,
                    'siteResourceId' integer,
                    'roleId' integer,
                    'virtualApiKeyId' text,
                    'amount' real NOT NULL,
                    'unit' text NOT NULL,
                    'period' text DEFAULT 'monthly' NOT NULL,
                    'enforcement' text DEFAULT 'hard' NOT NULL,
                    'enabled' integer DEFAULT true NOT NULL,
                    'createdAt' integer NOT NULL,
                    'updatedAt' integer NOT NULL,
                    FOREIGN KEY ('orgId') REFERENCES 'orgs'('orgId') ON UPDATE no action ON DELETE cascade,
                    FOREIGN KEY ('providerId') REFERENCES 'aiProviders'('providerId') ON UPDATE no action ON DELETE cascade,
                    FOREIGN KEY ('modelId') REFERENCES 'aiModels'('modelId') ON UPDATE no action ON DELETE cascade,
                    FOREIGN KEY ('resourceId') REFERENCES 'resources'('resourceId') ON UPDATE no action ON DELETE cascade,
                    FOREIGN KEY ('siteResourceId') REFERENCES 'siteResources'('siteResourceId') ON UPDATE no action ON DELETE cascade,
                    FOREIGN KEY ('roleId') REFERENCES 'roles'('roleId') ON UPDATE no action ON DELETE cascade,
                    FOREIGN KEY ('virtualApiKeyId') REFERENCES 'virtualApiKeys'('virtualApiKeyId') ON UPDATE no action ON DELETE cascade
                );
                `
            ).run();

            db.prepare(
                `CREATE UNIQUE INDEX 'ai_budget_provider_uniq' ON 'aiBudgets' ('providerId','unit','period');`
            ).run();
            db.prepare(
                `CREATE UNIQUE INDEX 'ai_budget_model_uniq' ON 'aiBudgets' ('modelId','unit','period');`
            ).run();
            db.prepare(
                `CREATE UNIQUE INDEX 'ai_budget_resource_uniq' ON 'aiBudgets' ('resourceId','unit','period');`
            ).run();
            db.prepare(
                `CREATE UNIQUE INDEX 'ai_budget_site_resource_uniq' ON 'aiBudgets' ('siteResourceId','unit','period');`
            ).run();
            db.prepare(
                `CREATE UNIQUE INDEX 'ai_budget_role_uniq' ON 'aiBudgets' ('roleId','unit','period');`
            ).run();
            db.prepare(
                `CREATE UNIQUE INDEX 'ai_budget_virtual_api_key_uniq' ON 'aiBudgets' ('virtualApiKeyId','unit','period');`
            ).run();
            db.prepare(
                `
                CREATE TABLE 'aiModels' (
                    'modelId' integer PRIMARY KEY AUTOINCREMENT NOT NULL,
                    'providerId' integer NOT NULL,
                    'modelKey' text NOT NULL,
                    'name' text NOT NULL,
                    'listType' text DEFAULT 'allow' NOT NULL,
                    'enabled' integer DEFAULT true NOT NULL,
                    'createdAt' integer NOT NULL,
                    'updatedAt' integer NOT NULL,
                    FOREIGN KEY ('providerId') REFERENCES 'aiProviders'('providerId') ON UPDATE no action ON DELETE cascade
                );
                `
            ).run();
            db.prepare(
                `
                CREATE UNIQUE INDEX 'ai_model_provider_key_uniq' ON 'aiModels' ('providerId','modelKey');
                `
            ).run();
            db.prepare(
                `
                CREATE TABLE 'aiProviders' (
                    'providerId' integer PRIMARY KEY AUTOINCREMENT NOT NULL,
                    'orgId' text NOT NULL,
                    'name' text NOT NULL,
                    'niceId' text NOT NULL,
                    'type' text NOT NULL,
                    'upstreamUrl' text,
                    'apiKey' text,
                    'apiKeyLastChars' text,
                    'authType' text NOT NULL,
                    'routingMode' text DEFAULT 'url' NOT NULL,
                    'capabilities' text DEFAULT '[]' NOT NULL,
                    'headers' text,
                    'skipTlsVerification' integer DEFAULT false NOT NULL,
                    'enabled' integer DEFAULT true NOT NULL,
                    'createdAt' integer NOT NULL,
                    'updatedAt' integer NOT NULL,
                    FOREIGN KEY ('orgId') REFERENCES 'orgs'('orgId') ON UPDATE no action ON DELETE cascade
                );
                `
            ).run();
            db.prepare(
                `
                CREATE INDEX 'idx_aiProviders_orgId_niceId' ON 'aiProviders' ('orgId','niceId');
                `
            ).run();
            db.prepare(
                `
                CREATE TABLE 'aiSessionLog' (
                    'id' integer PRIMARY KEY AUTOINCREMENT NOT NULL,
                    'sessionId' text NOT NULL,
                    'orgId' text,
                    'providerId' integer,
                    'capability' text NOT NULL,
                    'resourceId' integer,
                    'siteResourceId' integer,
                    'userId' text,
                    'virtualApiKeyId' text,
                    'requestedModel' text,
                    'isStream' integer DEFAULT false NOT NULL,
                    'requestBody' text,
                    'responseBody' text,
                    'normalizedRequest' text,
                    'normalizedResponse' text,
                    'truncated' integer DEFAULT false NOT NULL,
                    'statusCode' integer,
                    'createdAt' integer NOT NULL,
                    FOREIGN KEY ('orgId') REFERENCES 'orgs'('orgId') ON UPDATE no action ON DELETE cascade,
                    FOREIGN KEY ('providerId') REFERENCES 'aiProviders'('providerId') ON UPDATE no action ON DELETE set null,
                    FOREIGN KEY ('resourceId') REFERENCES 'resources'('resourceId') ON UPDATE no action ON DELETE set null,
                    FOREIGN KEY ('siteResourceId') REFERENCES 'siteResources'('siteResourceId') ON UPDATE no action ON DELETE set null,
                    FOREIGN KEY ('userId') REFERENCES 'user'('id') ON UPDATE no action ON DELETE set null,
                    FOREIGN KEY ('virtualApiKeyId') REFERENCES 'virtualApiKeys'('virtualApiKeyId') ON UPDATE no action ON DELETE set null
                );
                `
            ).run();
            db.prepare(
                `CREATE INDEX 'idx_ai_session_log_org_created' ON 'aiSessionLog' ('orgId','createdAt');`
            ).run();
            db.prepare(
                `CREATE INDEX 'idx_ai_session_log_org_provider_created' ON 'aiSessionLog' ('orgId','providerId','createdAt');`
            ).run();
            db.prepare(
                `CREATE INDEX 'idx_ai_session_log_org_resource_created' ON 'aiSessionLog' ('orgId','resourceId','createdAt');`
            ).run();
            db.prepare(
                `CREATE INDEX 'idx_ai_session_log_org_site_resource_created' ON 'aiSessionLog' ('orgId','siteResourceId','createdAt');`
            ).run();
            db.prepare(
                `CREATE INDEX 'idx_ai_session_log_org_user_created' ON 'aiSessionLog' ('orgId','userId','createdAt');`
            ).run();
            db.prepare(
                `CREATE INDEX 'idx_ai_session_log_org_virtual_api_key_created' ON 'aiSessionLog' ('orgId','virtualApiKeyId','createdAt');`
            ).run();
            db.prepare(
                `CREATE INDEX 'idx_ai_session_log_session' ON 'aiSessionLog' ('sessionId');`
            ).run();
            db.prepare(
                `
                CREATE TABLE 'aiUsageRecords' (
                    'id' integer PRIMARY KEY AUTOINCREMENT NOT NULL,
                    'orgId' text NOT NULL,
                    'providerId' integer,
                    'resourceId' integer,
                    'siteResourceId' integer,
                    'userId' text,
                    'virtualApiKeyId' text,
                    'sessionId' text,
                    'requestedModel' text NOT NULL,
                    'promptTokens' integer DEFAULT 0 NOT NULL,
                    'cacheReadTokens' integer DEFAULT 0 NOT NULL,
                    'cacheWriteTokens' integer DEFAULT 0 NOT NULL,
                    'completionTokens' integer DEFAULT 0 NOT NULL,
                    'reasoningTokens' integer DEFAULT 0 NOT NULL,
                    'totalTokens' integer DEFAULT 0 NOT NULL,
                    'costUsd' real,
                    'estimated' integer DEFAULT false NOT NULL,
                    'createdAt' integer NOT NULL,
                    FOREIGN KEY ('orgId') REFERENCES 'orgs'('orgId') ON UPDATE no action ON DELETE cascade,
                    FOREIGN KEY ('providerId') REFERENCES 'aiProviders'('providerId') ON UPDATE no action ON DELETE set null,
                    FOREIGN KEY ('resourceId') REFERENCES 'resources'('resourceId') ON UPDATE no action ON DELETE set null,
                    FOREIGN KEY ('siteResourceId') REFERENCES 'siteResources'('siteResourceId') ON UPDATE no action ON DELETE set null,
                    FOREIGN KEY ('userId') REFERENCES 'user'('id') ON UPDATE no action ON DELETE set null,
                    FOREIGN KEY ('virtualApiKeyId') REFERENCES 'virtualApiKeys'('virtualApiKeyId') ON UPDATE no action ON DELETE set null
                );
                `
            ).run();
            db.prepare(
                `CREATE INDEX 'idx_ai_usage_records_org_provider_created' ON 'aiUsageRecords' ('orgId','providerId','createdAt');`
            ).run();
            db.prepare(
                `CREATE INDEX 'idx_ai_usage_records_org_resource_created' ON 'aiUsageRecords' ('orgId','resourceId','createdAt');`
            ).run();
            db.prepare(
                `CREATE INDEX 'idx_ai_usage_records_org_site_resource_created' ON 'aiUsageRecords' ('orgId','siteResourceId','createdAt');`
            ).run();
            db.prepare(
                `CREATE INDEX 'idx_ai_usage_records_org_user_created' ON 'aiUsageRecords' ('orgId','userId','createdAt');`
            ).run();
            db.prepare(
                `CREATE INDEX 'idx_ai_usage_records_org_virtual_api_key_created' ON 'aiUsageRecords' ('orgId','virtualApiKeyId','createdAt');`
            ).run();
            db.prepare(
                `CREATE INDEX 'idx_ai_usage_records_session' ON 'aiUsageRecords' ('sessionId');`
            ).run();
            db.prepare(
                `
                CREATE TABLE 'resourceAiModels' (
                    'resourceId' integer NOT NULL,
                    'modelId' integer NOT NULL,
                    'listType' text DEFAULT 'allow' NOT NULL,
                    PRIMARY KEY('resourceId', 'modelId'),
                    FOREIGN KEY ('resourceId') REFERENCES 'resources'('resourceId') ON UPDATE no action ON DELETE cascade,
                    FOREIGN KEY ('modelId') REFERENCES 'aiModels'('modelId') ON UPDATE no action ON DELETE cascade
                );
                `
            ).run();
            db.prepare(
                `
                CREATE TABLE 'resourceAiProviders' (
                    'resourceId' integer NOT NULL,
                    'providerId' integer NOT NULL,
                    'accessMode' text DEFAULT 'inherit' NOT NULL,
                    'enabled' integer DEFAULT true NOT NULL,
                    PRIMARY KEY('resourceId', 'providerId'),
                    FOREIGN KEY ('resourceId') REFERENCES 'resources'('resourceId') ON UPDATE no action ON DELETE cascade,
                    FOREIGN KEY ('providerId') REFERENCES 'aiProviders'('providerId') ON UPDATE no action ON DELETE cascade
                );
                `
            ).run();
            db.prepare(
                `
                CREATE TABLE 'siteResourceAiModels' (
                    'siteResourceId' integer NOT NULL,
                    'modelId' integer NOT NULL,
                    'listType' text DEFAULT 'allow' NOT NULL,
                    PRIMARY KEY('siteResourceId', 'modelId'),
                    FOREIGN KEY ('siteResourceId') REFERENCES 'siteResources'('siteResourceId') ON UPDATE no action ON DELETE cascade,
                    FOREIGN KEY ('modelId') REFERENCES 'aiModels'('modelId') ON UPDATE no action ON DELETE cascade
                );
                `
            ).run();
            db.prepare(
                `
                CREATE TABLE 'siteResourceAiProviders' (
                    'siteResourceId' integer NOT NULL,
                    'providerId' integer NOT NULL,
                    'accessMode' text DEFAULT 'inherit' NOT NULL,
                    'enabled' integer DEFAULT true NOT NULL,
                    PRIMARY KEY('siteResourceId', 'providerId'),
                    FOREIGN KEY ('siteResourceId') REFERENCES 'siteResources'('siteResourceId') ON UPDATE no action ON DELETE cascade,
                    FOREIGN KEY ('providerId') REFERENCES 'aiProviders'('providerId') ON UPDATE no action ON DELETE cascade
                );
                `
            ).run();
            db.prepare(
                `
                CREATE TABLE 'virtualApiKeyResources' (
                    'virtualApiKeyId' text NOT NULL,
                    'resourceId' integer NOT NULL,
                    PRIMARY KEY('virtualApiKeyId', 'resourceId'),
                    FOREIGN KEY ('virtualApiKeyId') REFERENCES 'virtualApiKeys'('virtualApiKeyId') ON UPDATE no action ON DELETE cascade,
                    FOREIGN KEY ('resourceId') REFERENCES 'resources'('resourceId') ON UPDATE no action ON DELETE cascade
                );
                `
            ).run();
            db.prepare(
                `
                CREATE TABLE 'virtualApiKeys' (
                    'virtualApiKeyId' text PRIMARY KEY NOT NULL,
                    'orgId' text NOT NULL,
                    'kind' text NOT NULL,
                    'userId' text,
                    'name' text,
                    'description' text,
                    'token' text NOT NULL,
                    'lastChars' text NOT NULL,
                    'allResources' integer DEFAULT false NOT NULL,
                    'expiresAt' integer,
                    'lastUsedAt' integer,
                    'createdAt' integer NOT NULL,
                    'createdByUserId' text,
                    FOREIGN KEY ('orgId') REFERENCES 'orgs'('orgId') ON UPDATE no action ON DELETE cascade,
                    FOREIGN KEY ('userId') REFERENCES 'user'('id') ON UPDATE no action ON DELETE cascade,
                    FOREIGN KEY ('createdByUserId') REFERENCES 'user'('id') ON UPDATE no action ON DELETE set null
                );
                `
            ).run();
            db.prepare(
                `
                CREATE UNIQUE INDEX 'virtual_api_key_user_identity_uniq' ON 'virtualApiKeys' ('orgId','userId') WHERE "virtualApiKeys"."kind" = 'user';
                `
            ).run();

            db.prepare(
                `ALTER TABLE 'roles' ADD COLUMN 'sshSudoModeNew' text DEFAULT 'full';`
            ).run();
            db.prepare(
                `UPDATE 'roles' SET "sshSudoModeNew" = "sshSudoMode";`
            ).run();
            db.prepare(`ALTER TABLE 'roles' DROP COLUMN "sshSudoMode";`).run();
            db.prepare(
                `ALTER TABLE 'roles' RENAME COLUMN "sshSudoModeNew" TO "sshSudoMode";`
            ).run();

            const licenseKeyCount = db
                .prepare(`SELECT COUNT(*) as count FROM 'licenseKey';`)
                .get() as { count: number };

            if (
                build === "oss" ||
                (build === "enterprise" && licenseKeyCount.count === 0)
            ) {
                db.prepare(
                    `UPDATE 'roles' SET "sshSudoMode" = 'full' WHERE "sshSudoMode" = 'none';`
                ).run();
            }

            db.prepare(
                `
                CREATE TABLE '__new_targets' (
                    'targetId' integer PRIMARY KEY AUTOINCREMENT NOT NULL,
                    'resourceId' integer,
                    'providerId' integer,
                    'siteId' integer NOT NULL,
                    'ip' text NOT NULL,
                    'method' text,
                    'port' integer NOT NULL,
                    'internalPort' integer,
                    'enabled' integer DEFAULT true NOT NULL,
                    'path' text,
                    'pathMatchType' text,
                    'rewritePath' text,
                    'rewritePathType' text,
                    'priority' integer DEFAULT 100 NOT NULL,
                    'mode' text DEFAULT 'http' NOT NULL,
                    'authToken' text,
                    FOREIGN KEY ('resourceId') REFERENCES 'resources'('resourceId') ON UPDATE no action ON DELETE cascade,
                    FOREIGN KEY ('providerId') REFERENCES 'aiProviders'('providerId') ON UPDATE no action ON DELETE cascade,
                    FOREIGN KEY ('siteId') REFERENCES 'sites'('siteId') ON UPDATE no action ON DELETE cascade
                );
                `
            ).run();

            db.prepare(
                `INSERT INTO '__new_targets'("targetId", "resourceId", "siteId", "ip", "method", "port", "internalPort", "enabled", "path", "pathMatchType", "rewritePath", "rewritePathType", "priority", "mode", "authToken") SELECT "targetId", "resourceId", "siteId", "ip", "method", "port", "internalPort", "enabled", "path", "pathMatchType", "rewritePath", "rewritePathType", "priority", "mode", "authToken" FROM 'targets';`
            ).run();
            db.prepare(`DROP TABLE 'targets';`).run();
            db.prepare(
                `ALTER TABLE '__new_targets' RENAME TO 'targets';`
            ).run();
            db.prepare(
                `ALTER TABLE 'subscriptions' ADD 'override' integer DEFAULT false;`
            ).run();
            db.prepare(
                `ALTER TABLE 'clients' ADD 'exitNodeSubnet' text;`
            ).run();
            db.prepare(
                `ALTER TABLE 'orgs' ADD 'settingsLogRetentionDaysAISessions' integer DEFAULT 0 NOT NULL;`
            ).run();
            db.prepare(
                `ALTER TABLE 'siteResources' ADD 'requiresExitNodeConnection' integer DEFAULT false NOT NULL;`
            ).run();
            db.prepare(
                `ALTER TABLE 'eventStreamingDestinations' ADD 'sendAISessionLogs' integer DEFAULT false NOT NULL;`
            ).run();

            const insertRoleAction = db.prepare(`
                INSERT INTO 'roleActions' ("roleId", "actionId", "orgId")
                SELECT r."roleId", ?, r."orgId"
                FROM 'roles' r
                WHERE COALESCE(r."isAdmin", 0) = 0
                  AND NOT EXISTS (
                    SELECT 1 FROM 'roleActions' ra
                    WHERE ra."roleId" = r."roleId"
                      AND ra."actionId" = ?
                      AND ra."orgId" = r."orgId"
                  );
            `);

            for (const actionId of actionsToGrant) {
                insertRoleAction.run(actionId, actionId);
            }
        })();

        db.pragma("foreign_keys = ON");

        console.log("Migrated database");
    } catch (e) {
        console.log("Failed to migrate db:", e);
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
