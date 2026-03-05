import { db } from "@server/db/pg/driver";
import { sql } from "drizzle-orm";
import { configFilePath1, configFilePath2 } from "@server/lib/consts";
import { encrypt } from "@server/lib/crypto";
import { generateCA } from "@server/lib/sshCA";
import fs from "fs";
import yaml from "js-yaml";

const version = "1.16.0";

function getServerSecret(): string {
    const envSecret = process.env.SERVER_SECRET;

    const configPath = fs.existsSync(configFilePath1)
        ? configFilePath1
        : fs.existsSync(configFilePath2)
          ? configFilePath2
          : null;

    // If no config file but an env secret is set, use the env secret directly
    if (!configPath) {
        if (envSecret && envSecret.length > 0) {
            return envSecret;
        }

        throw new Error(
            "Cannot generate org CA keys: no config file found and SERVER_SECRET env var is not set. " +
                "Expected config.yml or config.yaml in the config directory, or set SERVER_SECRET."
        );
    }

    const configContent = fs.readFileSync(configPath, "utf8");
    const config = yaml.load(configContent) as {
        server?: { secret?: string };
    };

    let secret = config?.server?.secret;
    if (!secret || secret.length === 0) {
        // Fall back to SERVER_SECRET env var if config does not contain server.secret
        if (envSecret && envSecret.length > 0) {
            secret = envSecret;
        }
    }

    if (!secret || secret.length === 0) {
        throw new Error(
            "Cannot generate org CA keys: no server.secret in config and SERVER_SECRET env var is not set. " +
                "Set server.secret in config.yml/config.yaml or set SERVER_SECRET."
        );
    }

    return secret;
}

export default async function migration() {
    console.log(`Running setup script ${version}...`);

    // Ensure server secret exists before running migration (required for org CA key generation)
    getServerSecret();

    try {
        await db.execute(sql`BEGIN`);

        // Schema changes
        await db.execute(sql`
            CREATE TABLE "roundTripMessageTracker" (
                "messageId" serial PRIMARY KEY NOT NULL,
                "clientId" varchar,
                "messageType" varchar,
                "sentAt" bigint NOT NULL,
                "receivedAt" bigint,
                "error" text,
                "complete" boolean DEFAULT false NOT NULL
            );
        `);

        await db.execute(
            sql`ALTER TABLE "orgs" ADD COLUMN "sshCaPrivateKey" text;`
        );
        await db.execute(
            sql`ALTER TABLE "orgs" ADD COLUMN "sshCaPublicKey" text;`
        );
        await db.execute(
            sql`ALTER TABLE "orgs" ADD COLUMN "isBillingOrg" boolean;`
        );
        await db.execute(
            sql`ALTER TABLE "orgs" ADD COLUMN "billingOrgId" varchar;`
        );

        await db.execute(
            sql`ALTER TABLE "roles" ADD COLUMN "sshSudoMode" varchar(32) DEFAULT 'none';`
        );
        await db.execute(
            sql`ALTER TABLE "roles" ADD COLUMN "sshSudoCommands" text DEFAULT '[]';`
        );
        await db.execute(
            sql`ALTER TABLE "roles" ADD COLUMN "sshCreateHomeDir" boolean DEFAULT true;`
        );
        await db.execute(
            sql`ALTER TABLE "roles" ADD COLUMN "sshUnixGroups" text DEFAULT '[]';`
        );

        await db.execute(
            sql`ALTER TABLE "siteResources" ADD COLUMN "authDaemonPort" integer DEFAULT 22123;`
        );
        await db.execute(
            sql`ALTER TABLE "siteResources" ADD COLUMN "authDaemonMode" varchar(32) DEFAULT 'site';`
        );

        await db.execute(
            sql`ALTER TABLE "userOrgs" ADD COLUMN "pamUsername" varchar;`
        );

        // Set all admin role sudo to "full"; other roles keep default "none"
        await db.execute(
            sql`UPDATE "roles" SET "sshSudoMode" = 'full' WHERE "isAdmin" = true;`
        );

        await db.execute(sql`COMMIT`);
        console.log("Migrated database");
    } catch (e) {
        await db.execute(sql`ROLLBACK`);
        console.log("Unable to migrate database");
        console.log(e);
        throw e;
    }

    // Generate and store encrypted SSH CA keys for all orgs
    try {
        const secret = getServerSecret();

        const orgQuery = await db.execute(sql`SELECT "orgId" FROM "orgs"`);
        const orgRows = orgQuery.rows as { orgId: string }[];

        const failedOrgIds: string[] = [];

        for (const row of orgRows) {
            try {
                const ca = generateCA(`pangolin-ssh-ca-${row.orgId}`);
                const encryptedPrivateKey = encrypt(ca.privateKeyPem, secret);

                await db.execute(sql`
                    UPDATE "orgs"
                    SET "sshCaPrivateKey" = ${encryptedPrivateKey},
                        "sshCaPublicKey" = ${ca.publicKeyOpenSSH}
                    WHERE "orgId" = ${row.orgId};
                `);
            } catch (err) {
                failedOrgIds.push(row.orgId);
                console.error(
                    `Error: No CA was generated for organization "${row.orgId}".`,
                    err instanceof Error ? err.message : err
                );
            }
        }

        if (orgRows.length > 0) {
            const succeeded = orgRows.length - failedOrgIds.length;
            console.log(
                `Generated and stored SSH CA keys for ${succeeded} org(s).`
            );
        }

        if (failedOrgIds.length > 0) {
            console.error(
                `No CA was generated for ${failedOrgIds.length} organization(s): ${failedOrgIds.join(
                    ", "
                )}`
            );
        }
    } catch (e) {
        console.error(
            "Error while generating SSH CA keys for orgs after migration:",
            e
        );
    }

    console.log(`${version} migration complete`);
}
