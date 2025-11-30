import { db } from "@server/db/pg/driver";
import { sql } from "drizzle-orm";
import { isoBase64URL } from "@simplewebauthn/server/helpers";
import { randomUUID } from "crypto";

const version = "1.11.0";

export default async function migration() {
    console.log(`Running setup script ${version}...`);

    try {
        await db.execute(sql`BEGIN`);

        await db.execute(sql`
        CREATE TABLE "account" (
            "accountId" serial PRIMARY KEY NOT NULL,
            "userId" varchar NOT NULL
        );
        `);

        await db.execute(sql`
        CREATE TABLE "accountDomains" (
            "accountId" integer NOT NULL,
            "domainId" varchar NOT NULL
        );
        `);

        await db.execute(sql`
        CREATE TABLE "certificates" (
            "certId" serial PRIMARY KEY NOT NULL,
            "domain" varchar(255) NOT NULL,
            "domainId" varchar,
            "wildcard" boolean DEFAULT false,
            "status" varchar(50) DEFAULT 'pending' NOT NULL,
            "expiresAt" bigint,
            "lastRenewalAttempt" bigint,
            "createdAt" bigint NOT NULL,
            "updatedAt" bigint NOT NULL,
            "orderId" varchar(500),
            "errorMessage" text,
            "renewalCount" integer DEFAULT 0,
            "certFile" text,
            "keyFile" text,
            CONSTRAINT "certificates_domain_unique" UNIQUE("domain")
        );
        `);

        await db.execute(sql`
        CREATE TABLE "customers" (
            "customerId" varchar(255) PRIMARY KEY NOT NULL,
            "orgId" varchar(255) NOT NULL,
            "email" varchar(255),
            "name" varchar(255),
            "phone" varchar(50),
            "address" text,
            "createdAt" bigint NOT NULL,
            "updatedAt" bigint NOT NULL
        );
        `);

        await db.execute(sql`
        CREATE TABLE "dnsChallenges" (
            "dnsChallengeId" serial PRIMARY KEY NOT NULL,
            "domain" varchar(255) NOT NULL,
            "token" varchar(255) NOT NULL,
            "keyAuthorization" varchar(1000) NOT NULL,
            "createdAt" bigint NOT NULL,
            "expiresAt" bigint NOT NULL,
            "completed" boolean DEFAULT false
        );
        `);

        await db.execute(sql`
        CREATE TABLE "domainNamespaces" (
            "domainNamespaceId" varchar(255) PRIMARY KEY NOT NULL,
            "domainId" varchar NOT NULL
        );
        `);

        await db.execute(sql`
        CREATE TABLE "exitNodeOrgs" (
            "exitNodeId" integer NOT NULL,
            "orgId" text NOT NULL
        );
        `);

        await db.execute(sql`
        CREATE TABLE "limits" (
            "limitId" varchar(255) PRIMARY KEY NOT NULL,
            "featureId" varchar(255) NOT NULL,
            "orgId" varchar NOT NULL,
            "value" real,
            "description" text
        );
        `);

        await db.execute(sql`
        CREATE TABLE "loginPage" (
            "loginPageId" serial PRIMARY KEY NOT NULL,
            "subdomain" varchar,
            "fullDomain" varchar,
            "exitNodeId" integer,
            "domainId" varchar
        );
        `);

        await db.execute(sql`
        CREATE TABLE "loginPageOrg" (
            "loginPageId" integer NOT NULL,
            "orgId" varchar NOT NULL
        );
        `);

        await db.execute(sql`
        CREATE TABLE "remoteExitNodeSession" (
            "id" varchar PRIMARY KEY NOT NULL,
            "remoteExitNodeId" varchar NOT NULL,
            "expiresAt" bigint NOT NULL
        );
        `);

        await db.execute(sql`
        CREATE TABLE "remoteExitNode" (
            "id" varchar PRIMARY KEY NOT NULL,
            "secretHash" varchar NOT NULL,
            "dateCreated" varchar NOT NULL,
            "version" varchar,
            "exitNodeId" integer
        );
        `);

        await db.execute(sql`
        CREATE TABLE "sessionTransferToken" (
            "token" varchar PRIMARY KEY NOT NULL,
            "sessionId" varchar NOT NULL,
            "encryptedSession" text NOT NULL,
            "expiresAt" bigint NOT NULL
        );
        `);

        await db.execute(sql`
        CREATE TABLE "subscriptionItems" (
            "subscriptionItemId" serial PRIMARY KEY NOT NULL,
            "subscriptionId" varchar(255) NOT NULL,
            "planId" varchar(255) NOT NULL,
            "priceId" varchar(255),
            "meterId" varchar(255),
            "unitAmount" real,
            "tiers" text,
            "interval" varchar(50),
            "currentPeriodStart" bigint,
            "currentPeriodEnd" bigint,
            "name" varchar(255)
        );
        `);

        await db.execute(sql`
        CREATE TABLE "subscriptions" (
            "subscriptionId" varchar(255) PRIMARY KEY NOT NULL,
            "customerId" varchar(255) NOT NULL,
            "status" varchar(50) DEFAULT 'active' NOT NULL,
            "canceledAt" bigint,
            "createdAt" bigint NOT NULL,
            "updatedAt" bigint,
            "billingCycleAnchor" bigint
        );
        `);

        await db.execute(sql`
        CREATE TABLE "usage" (
            "usageId" varchar(255) PRIMARY KEY NOT NULL,
            "featureId" varchar(255) NOT NULL,
            "orgId" varchar NOT NULL,
            "meterId" varchar(255),
            "instantaneousValue" real,
            "latestValue" real NOT NULL,
            "previousValue" real,
            "updatedAt" bigint NOT NULL,
            "rolledOverAt" bigint,
            "nextRolloverAt" bigint
        );
        `);

        await db.execute(sql`
        CREATE TABLE "usageNotifications" (
            "notificationId" serial PRIMARY KEY NOT NULL,
            "orgId" varchar NOT NULL,
            "featureId" varchar(255) NOT NULL,
            "limitId" varchar(255) NOT NULL,
            "notificationType" varchar(50) NOT NULL,
            "sentAt" bigint NOT NULL
        );
        `);

        await db.execute(sql`
        CREATE TABLE "resourceHeaderAuth" (
            "headerAuthId" serial PRIMARY KEY NOT NULL,
            "resourceId" integer NOT NULL,
            "headerAuthHash" varchar NOT NULL
        );
        `);

        await db.execute(sql`
        CREATE TABLE "targetHealthCheck" (
            "targetHealthCheckId" serial PRIMARY KEY NOT NULL,
            "targetId" integer NOT NULL,
            "hcEnabled" boolean DEFAULT false NOT NULL,
            "hcPath" varchar,
            "hcScheme" varchar,
            "hcMode" varchar DEFAULT 'http',
            "hcHostname" varchar,
            "hcPort" integer,
            "hcInterval" integer DEFAULT 30,
            "hcUnhealthyInterval" integer DEFAULT 30,
            "hcTimeout" integer DEFAULT 5,
            "hcHeaders" varchar,
            "hcFollowRedirects" boolean DEFAULT true,
            "hcMethod" varchar DEFAULT 'GET',
            "hcStatus" integer,
            "hcHealth" text DEFAULT 'unknown'
        );
        `);

        await db.execute(sql`ALTER TABLE "orgs" ADD COLUMN "settings" text;`);
        await db.execute(
            sql`ALTER TABLE "targets" ADD COLUMN "rewritePath" text;`
        );
        await db.execute(
            sql`ALTER TABLE "targets" ADD COLUMN "rewritePathType" text;`
        );
        await db.execute(
            sql`ALTER TABLE "targets" ADD COLUMN "priority" integer DEFAULT 100 NOT NULL;`
        );
        await db.execute(
            sql`ALTER TABLE "account" ADD CONSTRAINT "account_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;`
        );
        await db.execute(
            sql`ALTER TABLE "accountDomains" ADD CONSTRAINT "accountDomains_accountId_account_accountId_fk" FOREIGN KEY ("accountId") REFERENCES "public"."account"("accountId") ON DELETE cascade ON UPDATE no action;`
        );
        await db.execute(
            sql`ALTER TABLE "accountDomains" ADD CONSTRAINT "accountDomains_domainId_domains_domainId_fk" FOREIGN KEY ("domainId") REFERENCES "public"."domains"("domainId") ON DELETE cascade ON UPDATE no action;`
        );
        await db.execute(
            sql`ALTER TABLE "certificates" ADD CONSTRAINT "certificates_domainId_domains_domainId_fk" FOREIGN KEY ("domainId") REFERENCES "public"."domains"("domainId") ON DELETE cascade ON UPDATE no action;`
        );
        await db.execute(
            sql`ALTER TABLE "customers" ADD CONSTRAINT "customers_orgId_orgs_orgId_fk" FOREIGN KEY ("orgId") REFERENCES "public"."orgs"("orgId") ON DELETE cascade ON UPDATE no action;`
        );
        await db.execute(
            sql`ALTER TABLE "domainNamespaces" ADD CONSTRAINT "domainNamespaces_domainId_domains_domainId_fk" FOREIGN KEY ("domainId") REFERENCES "public"."domains"("domainId") ON DELETE set null ON UPDATE no action;`
        );
        await db.execute(
            sql`ALTER TABLE "exitNodeOrgs" ADD CONSTRAINT "exitNodeOrgs_exitNodeId_exitNodes_exitNodeId_fk" FOREIGN KEY ("exitNodeId") REFERENCES "public"."exitNodes"("exitNodeId") ON DELETE cascade ON UPDATE no action;`
        );
        await db.execute(
            sql`ALTER TABLE "exitNodeOrgs" ADD CONSTRAINT "exitNodeOrgs_orgId_orgs_orgId_fk" FOREIGN KEY ("orgId") REFERENCES "public"."orgs"("orgId") ON DELETE cascade ON UPDATE no action;`
        );
        await db.execute(
            sql`ALTER TABLE "limits" ADD CONSTRAINT "limits_orgId_orgs_orgId_fk" FOREIGN KEY ("orgId") REFERENCES "public"."orgs"("orgId") ON DELETE cascade ON UPDATE no action;`
        );
        await db.execute(
            sql`ALTER TABLE "loginPage" ADD CONSTRAINT "loginPage_exitNodeId_exitNodes_exitNodeId_fk" FOREIGN KEY ("exitNodeId") REFERENCES "public"."exitNodes"("exitNodeId") ON DELETE set null ON UPDATE no action;`
        );
        await db.execute(
            sql`ALTER TABLE "loginPage" ADD CONSTRAINT "loginPage_domainId_domains_domainId_fk" FOREIGN KEY ("domainId") REFERENCES "public"."domains"("domainId") ON DELETE set null ON UPDATE no action;`
        );
        await db.execute(
            sql`ALTER TABLE "loginPageOrg" ADD CONSTRAINT "loginPageOrg_loginPageId_loginPage_loginPageId_fk" FOREIGN KEY ("loginPageId") REFERENCES "public"."loginPage"("loginPageId") ON DELETE cascade ON UPDATE no action;`
        );
        await db.execute(
            sql`ALTER TABLE "loginPageOrg" ADD CONSTRAINT "loginPageOrg_orgId_orgs_orgId_fk" FOREIGN KEY ("orgId") REFERENCES "public"."orgs"("orgId") ON DELETE cascade ON UPDATE no action;`
        );
        await db.execute(
            sql`ALTER TABLE "remoteExitNodeSession" ADD CONSTRAINT "remoteExitNodeSession_remoteExitNodeId_remoteExitNode_id_fk" FOREIGN KEY ("remoteExitNodeId") REFERENCES "public"."remoteExitNode"("id") ON DELETE cascade ON UPDATE no action;`
        );
        await db.execute(
            sql`ALTER TABLE "remoteExitNode" ADD CONSTRAINT "remoteExitNode_exitNodeId_exitNodes_exitNodeId_fk" FOREIGN KEY ("exitNodeId") REFERENCES "public"."exitNodes"("exitNodeId") ON DELETE cascade ON UPDATE no action;`
        );
        await db.execute(
            sql`ALTER TABLE "sessionTransferToken" ADD CONSTRAINT "sessionTransferToken_sessionId_session_id_fk" FOREIGN KEY ("sessionId") REFERENCES "public"."session"("id") ON DELETE cascade ON UPDATE no action;`
        );
        await db.execute(
            sql`ALTER TABLE "subscriptionItems" ADD CONSTRAINT "subscriptionItems_subscriptionId_subscriptions_subscriptionId_fk" FOREIGN KEY ("subscriptionId") REFERENCES "public"."subscriptions"("subscriptionId") ON DELETE cascade ON UPDATE no action;`
        );
        await db.execute(
            sql`ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_customerId_customers_customerId_fk" FOREIGN KEY ("customerId") REFERENCES "public"."customers"("customerId") ON DELETE cascade ON UPDATE no action;`
        );
        await db.execute(
            sql`ALTER TABLE "usage" ADD CONSTRAINT "usage_orgId_orgs_orgId_fk" FOREIGN KEY ("orgId") REFERENCES "public"."orgs"("orgId") ON DELETE cascade ON UPDATE no action;`
        );
        await db.execute(
            sql`ALTER TABLE "usageNotifications" ADD CONSTRAINT "usageNotifications_orgId_orgs_orgId_fk" FOREIGN KEY ("orgId") REFERENCES "public"."orgs"("orgId") ON DELETE cascade ON UPDATE no action;`
        );
        await db.execute(
            sql`ALTER TABLE "resourceHeaderAuth" ADD CONSTRAINT "resourceHeaderAuth_resourceId_resources_resourceId_fk" FOREIGN KEY ("resourceId") REFERENCES "public"."resources"("resourceId") ON DELETE cascade ON UPDATE no action;`
        );
        await db.execute(
            sql`ALTER TABLE "targetHealthCheck" ADD CONSTRAINT "targetHealthCheck_targetId_targets_targetId_fk" FOREIGN KEY ("targetId") REFERENCES "public"."targets"("targetId") ON DELETE cascade ON UPDATE no action;`
        );

        const webauthnCredentialsQuery = await db.execute(
            sql`SELECT "credentialId", "publicKey", "userId", "signCount", "transports", "name", "lastUsed", "dateCreated" FROM "webauthnCredentials"`
        );

        const webauthnCredentials = webauthnCredentialsQuery.rows as {
            credentialId: string;
            publicKey: string;
            userId: string;
            signCount: number;
            transports: string | null;
            name: string | null;
            lastUsed: string;
            dateCreated: string;
        }[];

        // Delete the old record
        await db.execute(sql`
                DELETE FROM "webauthnCredentials";
            `);

        for (const webauthnCredential of webauthnCredentials) {
            const newCredentialId = isoBase64URL.fromBuffer(
                new Uint8Array(
                    Buffer.from(webauthnCredential.credentialId, "base64")
                )
            );
            const newPublicKey = isoBase64URL.fromBuffer(
                new Uint8Array(
                    Buffer.from(webauthnCredential.publicKey, "base64")
                )
            );

            // Insert the updated record with converted values
            await db.execute(sql`
                INSERT INTO "webauthnCredentials" ("credentialId", "publicKey", "userId", "signCount", "transports", "name", "lastUsed", "dateCreated")
                VALUES (${newCredentialId}, ${newPublicKey}, ${webauthnCredential.userId}, ${webauthnCredential.signCount}, ${webauthnCredential.transports}, ${webauthnCredential.name}, ${webauthnCredential.lastUsed}, ${webauthnCredential.dateCreated})
            `);
        }

        // 1. Add the column with placeholder so NOT NULL is satisfied
        await db.execute(sql`
            ALTER TABLE "resources"
            ADD COLUMN IF NOT EXISTS "resourceGuid" varchar(36) NOT NULL DEFAULT 'PLACEHOLDER'
        `);

        // 2. Fetch every row to backfill UUIDs
        const rows = await db.execute(
            sql`SELECT "resourceId" FROM "resources" WHERE "resourceGuid" = 'PLACEHOLDER'`
        );
        const resources = rows.rows as { resourceId: number }[];

        for (const r of resources) {
            await db.execute(sql`
                UPDATE "resources"
                SET "resourceGuid" = ${randomUUID()}
                WHERE "resourceId" = ${r.resourceId}
            `);
        }

        // get all of the targets
        const targetsQuery = await db.execute(
            sql`SELECT "targetId" FROM "targets"`
        );
        const targets = targetsQuery.rows as {
            targetId: number;
        }[];

        for (const target of targets) {
            await db.execute(sql`
            INSERT INTO "targetHealthCheck" ("targetId") 
            VALUES (${target.targetId})
            `);
        }

        // 3. Add UNIQUE constraint now that values are filled
        await db.execute(sql`
            ALTER TABLE "resources"
            ADD CONSTRAINT "resources_resourceGuid_unique" UNIQUE("resourceGuid")
        `);

        await db.execute(sql`COMMIT`);
        console.log(`Updated credentialId and publicKey`);
    } catch (e) {
        await db.execute(sql`ROLLBACK`);
        console.log("Unable to update credentialId and publicKey");
        console.log(e);
        throw e;
    }

    console.log(`${version} migration complete`);
}
