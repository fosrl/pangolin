import { APP_PATH, __DIRNAME } from "@server/lib/consts";
import Database from "better-sqlite3";
import z from "zod";
import { fromZodError } from "zod-validation-error";
import fs from "fs";
import yaml from "js-yaml";
import path, { join } from "path";

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

    const location = path.join(APP_PATH, "db", "db.sqlite");
    const db = new Database(location);

    try {
        db.transaction(() => {
            db.prepare(
                `
            CREATE TABLE 'clientLabels' (
                'clientLabelId' integer PRIMARY KEY AUTOINCREMENT NOT NULL,
                'clientId' integer NOT NULL,
                'labelId' integer NOT NULL,
                FOREIGN KEY ('clientId') REFERENCES 'clients'('clientId') ON UPDATE no action ON DELETE cascade,
                FOREIGN KEY ('labelId') REFERENCES 'labels'('labelId') ON UPDATE no action ON DELETE cascade
            );
                `
            ).run();

            db.prepare(
                `
            CREATE UNIQUE INDEX 'client_label_uniq' ON 'clientLabels' ('clientId','labelId');
                `
            ).run();
            db.prepare(
                `
            CREATE TABLE 'labels' (
                'labelId' integer PRIMARY KEY AUTOINCREMENT NOT NULL,
                'name' text NOT NULL,
                'color' text NOT NULL,
                'orgId' text NOT NULL,
                FOREIGN KEY ('orgId') REFERENCES 'orgs'('orgId') ON UPDATE no action ON DELETE cascade
            );
                `
            ).run();

            db.prepare(
                `
            CREATE TABLE 'resourceLabels' (
                'resourceLabelId' integer PRIMARY KEY AUTOINCREMENT NOT NULL,
                'resourceId' integer NOT NULL,
                'labelId' integer NOT NULL,
                FOREIGN KEY ('resourceId') REFERENCES 'resources'('resourceId') ON UPDATE no action ON DELETE cascade,
                FOREIGN KEY ('labelId') REFERENCES 'labels'('labelId') ON UPDATE no action ON DELETE cascade
            );
                `
            ).run();

            db.prepare(
                `
            CREATE UNIQUE INDEX 'resource_label_uniq' ON 'resourceLabels' ('resourceId','labelId');
                `
            ).run();
            db.prepare(
                `
            CREATE TABLE 'resourcePolicies' (
                'resourcePolicyId' integer PRIMARY KEY NOT NULL,
                'sso' integer DEFAULT true NOT NULL,
                'applyRules' integer DEFAULT false NOT NULL,
                'scope' text DEFAULT 'global' NOT NULL,
                'emailWhitelistEnabled' integer DEFAULT false NOT NULL,
                'niceId' text NOT NULL,
                'idpId' integer,
                'name' text NOT NULL,
                'orgId' text NOT NULL,
                FOREIGN KEY ('idpId') REFERENCES 'idp'('idpId') ON UPDATE no action ON DELETE set null,
                FOREIGN KEY ('orgId') REFERENCES 'orgs'('orgId') ON UPDATE no action ON DELETE cascade
            );
                `
            ).run();

            db.prepare(
                `
            CREATE TABLE 'resourcePolicyHeaderAuth' (
                'headerAuthId' integer PRIMARY KEY AUTOINCREMENT NOT NULL,
                'headerAuthHash' text NOT NULL,
                'extendedCompatibility' integer DEFAULT true NOT NULL,
                'resourcePolicyId' integer NOT NULL,
                FOREIGN KEY ('resourcePolicyId') REFERENCES 'resourcePolicies'('resourcePolicyId') ON UPDATE no action ON DELETE cascade
            );
                `
            ).run();

            db.prepare(
                `
            CREATE TABLE 'resourcePolicyPassword' (
                'passwordId' integer PRIMARY KEY AUTOINCREMENT NOT NULL,
                'passwordHash' text NOT NULL,
                'resourcePolicyId' integer NOT NULL,
                FOREIGN KEY ('resourcePolicyId') REFERENCES 'resourcePolicies'('resourcePolicyId') ON UPDATE no action ON DELETE cascade
            );
                `
            ).run();

            db.prepare(
                `
            CREATE TABLE 'resourcePolicyPincode' (
                'pincodeId' integer PRIMARY KEY AUTOINCREMENT NOT NULL,
                'pincodeHash' text NOT NULL,
                'digitLength' integer NOT NULL,
                'resourcePolicyId' integer NOT NULL,
                FOREIGN KEY ('resourcePolicyId') REFERENCES 'resourcePolicies'('resourcePolicyId') ON UPDATE no action ON DELETE cascade
            );
                `
            ).run();

            db.prepare(
                `
            CREATE TABLE 'resourcePolicyRules' (
                'ruleId' integer PRIMARY KEY AUTOINCREMENT NOT NULL,
                'resourcePolicyId' integer NOT NULL,
                'enabled' integer DEFAULT true NOT NULL,
                'priority' integer NOT NULL,
                'action' text NOT NULL,
                'match' text NOT NULL,
                'value' text NOT NULL,
                FOREIGN KEY ('resourcePolicyId') REFERENCES 'resourcePolicies'('resourcePolicyId') ON UPDATE no action ON DELETE cascade
            );
                `
            ).run();

            db.prepare(
                `
            CREATE TABLE 'resourcePolicyWhitelist' (
                'id' integer PRIMARY KEY AUTOINCREMENT NOT NULL,
                'email' text NOT NULL,
                'resourcePolicyId' integer NOT NULL,
                FOREIGN KEY ('resourcePolicyId') REFERENCES 'resourcePolicies'('resourcePolicyId') ON UPDATE no action ON DELETE cascade
            );
                `
            ).run();

            db.prepare(
                `
            CREATE TABLE 'rolePolicies' (
                'roleId' integer NOT NULL,
                'resourcePolicyId' integer NOT NULL,
                FOREIGN KEY ('roleId') REFERENCES 'roles'('roleId') ON UPDATE no action ON DELETE cascade,
                FOREIGN KEY ('resourcePolicyId') REFERENCES 'resourcePolicies'('resourcePolicyId') ON UPDATE no action ON DELETE cascade
            );
                `
            ).run();

            db.prepare(
                `
            CREATE TABLE 'siteLabels' (
                'siteLabelId' integer PRIMARY KEY AUTOINCREMENT NOT NULL,
                'siteId' integer NOT NULL,
                'labelId' integer NOT NULL,
                FOREIGN KEY ('siteId') REFERENCES 'sites'('siteId') ON UPDATE no action ON DELETE cascade,
                FOREIGN KEY ('labelId') REFERENCES 'labels'('labelId') ON UPDATE no action ON DELETE cascade
            );
                `
            ).run();

            db.prepare(
                `
            CREATE UNIQUE INDEX 'site_label_uniq' ON 'siteLabels' ('siteId','labelId');
                `
            ).run();
            db.prepare(
                `
            CREATE TABLE 'siteResourceLabels' (
                'siteResourceLabelId' integer PRIMARY KEY AUTOINCREMENT NOT NULL,
                'siteResourceId' integer NOT NULL,
                'labelId' integer NOT NULL,
                FOREIGN KEY ('siteResourceId') REFERENCES 'siteResources'('siteResourceId') ON UPDATE no action ON DELETE cascade,
                FOREIGN KEY ('labelId') REFERENCES 'labels'('labelId') ON UPDATE no action ON DELETE cascade
            );
                `
            ).run();

            db.prepare(
                `
            CREATE UNIQUE INDEX 'site_resource_label_uniq' ON 'siteResourceLabels' ('siteResourceId','labelId');
                `
            ).run();
            db.prepare(
                `
            CREATE TABLE 'userPolicies' (
                'userId' text NOT NULL,
                'resourcePolicyId' integer NOT NULL,
                FOREIGN KEY ('userId') REFERENCES 'user'('id') ON UPDATE no action ON DELETE cascade,
                FOREIGN KEY ('resourcePolicyId') REFERENCES 'resourcePolicies'('resourcePolicyId') ON UPDATE no action ON DELETE cascade
            );
                `
            ).run();

            db.prepare(
                `
            ALTER TABLE 'siteResources' ADD COLUMN 'destination2' text;
                `
            ).run();
            db.prepare(
                `
            UPDATE 'siteResources' SET "destination2" = "destination";
                `
            ).run();
            db.prepare(
                `
            ALTER TABLE 'siteResources' DROP COLUMN 'destination';
                `
            ).run();
            db.prepare(
                `
            ALTER TABLE 'siteResources' RENAME COLUMN 'destination2' TO 'destination';
                `
            ).run();
            db.prepare(
                `

            ALTER TABLE 'siteResources' ADD COLUMN 'pamMode' text DEFAULT 'passthrough';
                `
            ).run();
            db.prepare(
                `
            UPDATE 'siteResources'
            SET "pamMode" = 'push'
            WHERE LOWER(COALESCE("mode", '')) = 'host';
                `
            ).run();
            db.prepare(
                `

            ALTER TABLE 'orgs' ADD 'settingsEnableGlobalNewtAutoUpdate' integer DEFAULT false NOT NULL;
                `
            ).run();
            db.prepare(
                `
            ALTER TABLE 'resourceAccessToken' ADD 'path' text;
                `
            ).run();
            db.prepare(
                `
            ALTER TABLE 'resources' ADD 'resourcePolicyId' integer REFERENCES resourcePolicies(resourcePolicyId);
                `
            ).run();
            db.prepare(
                `
            ALTER TABLE 'resources' ADD 'defaultResourcePolicyId' integer REFERENCES resourcePolicies(resourcePolicyId);
                `
            ).run();
            db.prepare(
                `
            ALTER TABLE 'resources' ADD 'mode' text DEFAULT 'http' NOT NULL;
                `
            ).run();
            db.prepare(
                `
            UPDATE 'resources'
            SET "mode" = CASE
                WHEN COALESCE("http", 1) = 1 THEN 'http'
                WHEN COALESCE("http", 0) = 0 AND LOWER(COALESCE("protocol", '')) = 'tcp' THEN 'tcp'
                WHEN COALESCE("http", 0) = 0 AND LOWER(COALESCE("protocol", '')) = 'udp' THEN 'udp'
                ELSE 'http'
            END;
                `
            ).run();
            db.prepare(
                `
            ALTER TABLE 'resources' ADD 'pamMode' text DEFAULT 'passthrough';
                `
            ).run();
            db.prepare(
                `
            ALTER TABLE 'resources' ADD 'authDaemonMode' text DEFAULT 'site';
                `
            ).run();
            db.prepare(
                `
            ALTER TABLE 'resources' ADD 'authDaemonPort' integer DEFAULT 22123;
                `
            ).run();
            db.prepare(
                `
            ALTER TABLE 'resources' DROP COLUMN 'http';
                `
            ).run();
            db.prepare(
                `
            ALTER TABLE 'resources' DROP COLUMN 'protocol';
                `
            ).run();
            db.prepare(
                `
            ALTER TABLE 'sites' ADD 'autoUpdateEnabled' integer DEFAULT false NOT NULL;
                `
            ).run();
            db.prepare(
                `
            ALTER TABLE 'sites' ADD 'autoUpdateOverrideOrg' integer DEFAULT false NOT NULL;
                `
            ).run();
            db.prepare(
                `
            ALTER TABLE 'resourceSessions' ADD 'policyPasswordId' integer REFERENCES resourcePolicyPassword(passwordId);
                `
            ).run();
            db.prepare(
                `
            ALTER TABLE 'resourceSessions' ADD 'policyPincodeId' integer REFERENCES resourcePolicyPincode(pincodeId);
                `
            ).run();
            db.prepare(
                `
            ALTER TABLE 'resourceSessions' ADD 'policyWhitelistId' integer REFERENCES resourcePolicyWhitelist(id);
                `
            ).run();
            db.prepare(
                `
            ALTER TABLE 'targets' ADD 'mode' text DEFAULT 'http' NOT NULL;
                `
            ).run();
            db.prepare(
                `
            UPDATE 'targets'
            SET "mode" = COALESCE((
                SELECT "mode" FROM 'resources'
                WHERE "resources"."resourceId" = "targets"."resourceId"
            ), 'http');
                `
            ).run();
            db.prepare(
                `
            ALTER TABLE 'targets' ADD 'authToken' text;
                `
            ).run();
        })();

        const existingResources = db
            .prepare(
                `SELECT
                    "resourceId",
                    "orgId",
                    "niceId",
                    COALESCE("sso", 1) AS "sso",
                    COALESCE("applyRules", 0) AS "applyRules",
                    COALESCE("emailWhitelistEnabled", 0) AS "emailWhitelistEnabled",
                    "skipToIdpId"
                 FROM 'resources'`
            )
            .all() as {
            resourceId: number;
            orgId: string;
            niceId: string;
            sso: number;
            applyRules: number;
            emailWhitelistEnabled: number;
            skipToIdpId: number | null;
        }[];

        if (existingResources.length > 0) {
            const insertResourcePolicy = db.prepare(
                `INSERT INTO 'resourcePolicies' (
                    "sso",
                    "applyRules",
                    "scope",
                    "emailWhitelistEnabled",
                    "niceId",
                    "idpId",
                    "name",
                    "orgId"
                ) VALUES (?, ?, 'resource', ?, ?, ?, ?, ?)`
            );
            const updateResourcePolicyRefs = db.prepare(
                `UPDATE 'resources'
                 SET "defaultResourcePolicyId" = ?
                 WHERE "resourceId" = ?`
            );
            const policyNiceIdExists = db.prepare(
                `SELECT 1
                 FROM 'resourcePolicies'
                 WHERE "niceId" = ? AND "orgId" = ?
                 LIMIT 1`
            );

            const selectResourcePincodes = db.prepare(
                `SELECT "pincodeHash", "digitLength"
                 FROM 'resourcePincode'
                 WHERE "resourceId" = ?`
            );
            const insertResourcePolicyPincode = db.prepare(
                `INSERT INTO 'resourcePolicyPincode' (
                    "pincodeHash",
                    "digitLength",
                    "resourcePolicyId"
                ) VALUES (?, ?, ?)`
            );

            const selectResourcePasswords = db.prepare(
                `SELECT "passwordHash"
                 FROM 'resourcePassword'
                 WHERE "resourceId" = ?`
            );
            const insertResourcePolicyPassword = db.prepare(
                `INSERT INTO 'resourcePolicyPassword' (
                    "passwordHash",
                    "resourcePolicyId"
                ) VALUES (?, ?)`
            );

            const selectResourceHeaderAuth = db.prepare(
                `SELECT "headerAuthHash"
                 FROM 'resourceHeaderAuth'
                 WHERE "resourceId" = ?`
            );
            const selectResourceHeaderCompatibility = db.prepare(
                `SELECT COALESCE("extendedCompatibilityIsActivated", 1) AS "extendedCompatibility"
                 FROM 'resourceHeaderAuthExtendedCompatibility'
                 WHERE "resourceId" = ?
                 LIMIT 1`
            );
            const insertResourcePolicyHeaderAuth = db.prepare(
                `INSERT INTO 'resourcePolicyHeaderAuth' (
                    "headerAuthHash",
                    "extendedCompatibility",
                    "resourcePolicyId"
                ) VALUES (?, ?, ?)`
            );

            const selectResourceRules = db.prepare(
                `SELECT "enabled", "priority", "action", "match", "value"
                 FROM 'resourceRules'
                 WHERE "resourceId" = ?`
            );
            const insertResourcePolicyRule = db.prepare(
                `INSERT INTO 'resourcePolicyRules' (
                    "resourcePolicyId",
                    "enabled",
                    "priority",
                    "action",
                    "match",
                    "value"
                ) VALUES (?, ?, ?, ?, ?, ?)`
            );

            const selectResourceWhitelist = db.prepare(
                `SELECT "email"
                 FROM 'resourceWhitelist'
                 WHERE "resourceId" = ?`
            );
            const insertResourcePolicyWhitelist = db.prepare(
                `INSERT INTO 'resourcePolicyWhitelist' (
                    "email",
                    "resourcePolicyId"
                ) VALUES (?, ?)`
            );

            const selectRoleResources = db.prepare(
                `SELECT "roleId"
                 FROM 'roleResources'
                 WHERE "resourceId" = ?`
            );
            const rolePolicyExists = db.prepare(
                `SELECT 1
                 FROM 'rolePolicies'
                 WHERE "roleId" = ? AND "resourcePolicyId" = ?
                 LIMIT 1`
            );
            const insertRolePolicy = db.prepare(
                `INSERT INTO 'rolePolicies' (
                    "roleId",
                    "resourcePolicyId"
                ) VALUES (?, ?)`
            );

            const selectUserResources = db.prepare(
                `SELECT "userId"
                 FROM 'userResources'
                 WHERE "resourceId" = ?`
            );
            const userPolicyExists = db.prepare(
                `SELECT 1
                 FROM 'userPolicies'
                 WHERE "userId" = ? AND "resourcePolicyId" = ?
                 LIMIT 1`
            );
            const insertUserPolicy = db.prepare(
                `INSERT INTO 'userPolicies' (
                    "userId",
                    "resourcePolicyId"
                ) VALUES (?, ?)`
            );

            const deleteResourcePincodes = db.prepare(
                `DELETE FROM 'resourcePincode' WHERE "resourceId" = ?`
            );
            const deleteResourcePasswords = db.prepare(
                `DELETE FROM 'resourcePassword' WHERE "resourceId" = ?`
            );
            const deleteResourceHeaderAuth = db.prepare(
                `DELETE FROM 'resourceHeaderAuth' WHERE "resourceId" = ?`
            );
            const deleteResourceHeaderCompatibility = db.prepare(
                `DELETE FROM 'resourceHeaderAuthExtendedCompatibility' WHERE "resourceId" = ?`
            );
            const deleteResourceRules = db.prepare(
                `DELETE FROM 'resourceRules' WHERE "resourceId" = ?`
            );
            const deleteResourceWhitelist = db.prepare(
                `DELETE FROM 'resourceWhitelist' WHERE "resourceId" = ?`
            );

            const usedPolicyNiceIds = new Set<string>();

            const migrateInlinePolicies = db.transaction(() => {
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
                        const exists = policyNiceIdExists.get(
                            candidate,
                            resource.orgId
                        ) as { 1: number } | undefined;
                        if (!usedPolicyNiceIds.has(candidate) && !exists) {
                            usedPolicyNiceIds.add(candidate);
                            policyNiceId = candidate;
                            break;
                        }

                        loops++;
                    }

                    const policyName = `default policy for ${resource.niceId}`;

                    const inserted = insertResourcePolicy.run(
                        resource.sso,
                        resource.applyRules,
                        resource.emailWhitelistEnabled,
                        policyNiceId,
                        resource.skipToIdpId,
                        policyName,
                        resource.orgId
                    );
                    const policyId = inserted.lastInsertRowid as number;

                    updateResourcePolicyRefs.run(policyId, resource.resourceId);

                    const resourcePincodes = selectResourcePincodes.all(
                        resource.resourceId
                    ) as { pincodeHash: string; digitLength: number }[];
                    for (const pincode of resourcePincodes) {
                        insertResourcePolicyPincode.run(
                            pincode.pincodeHash,
                            pincode.digitLength,
                            policyId
                        );
                    }

                    const resourcePasswords = selectResourcePasswords.all(
                        resource.resourceId
                    ) as { passwordHash: string }[];
                    for (const password of resourcePasswords) {
                        insertResourcePolicyPassword.run(
                            password.passwordHash,
                            policyId
                        );
                    }

                    const compatibilityRow =
                        selectResourceHeaderCompatibility.get(
                            resource.resourceId
                        ) as { extendedCompatibility: number } | undefined;
                    const extendedCompatibility =
                        compatibilityRow?.extendedCompatibility ?? 1;

                    const resourceHeaderAuthRows = selectResourceHeaderAuth.all(
                        resource.resourceId
                    ) as { headerAuthHash: string }[];
                    for (const headerAuth of resourceHeaderAuthRows) {
                        insertResourcePolicyHeaderAuth.run(
                            headerAuth.headerAuthHash,
                            extendedCompatibility,
                            policyId
                        );
                    }

                    const resourceRules = selectResourceRules.all(
                        resource.resourceId
                    ) as {
                        enabled: number;
                        priority: number;
                        action: string;
                        match: string;
                        value: string;
                    }[];
                    for (const rule of resourceRules) {
                        insertResourcePolicyRule.run(
                            policyId,
                            rule.enabled,
                            rule.priority,
                            rule.action,
                            rule.match,
                            rule.value
                        );
                    }

                    const resourceWhitelist = selectResourceWhitelist.all(
                        resource.resourceId
                    ) as { email: string }[];
                    for (const whitelistRow of resourceWhitelist) {
                        insertResourcePolicyWhitelist.run(
                            whitelistRow.email,
                            policyId
                        );
                    }

                    const resourceRoles = selectRoleResources.all(
                        resource.resourceId
                    ) as { roleId: number }[];
                    for (const role of resourceRoles) {
                        const exists = rolePolicyExists.get(
                            role.roleId,
                            policyId
                        ) as { 1: number } | undefined;
                        if (!exists) {
                            insertRolePolicy.run(role.roleId, policyId);
                        }
                    }

                    const resourceUsers = selectUserResources.all(
                        resource.resourceId
                    ) as { userId: string }[];
                    for (const user of resourceUsers) {
                        const exists = userPolicyExists.get(
                            user.userId,
                            policyId
                        ) as { 1: number } | undefined;
                        if (!exists) {
                            insertUserPolicy.run(user.userId, policyId);
                        }
                    }

                    deleteResourcePincodes.run(resource.resourceId);
                    deleteResourcePasswords.run(resource.resourceId);
                    deleteResourceHeaderAuth.run(resource.resourceId);
                    deleteResourceHeaderCompatibility.run(resource.resourceId);
                    deleteResourceRules.run(resource.resourceId);
                    deleteResourceWhitelist.run(resource.resourceId);
                }
            });

            migrateInlinePolicies();
            console.log(
                `Migrated inline resource policies for ${existingResources.length} resource(s)`
            );
        }

        // add one more transaction
        db.transaction(() => {
            // remove not null/default from sso, applyRules, and emailWhitelistEnabled in preparation for resource policies
            db.prepare(`ALTER TABLE 'resources' DROP COLUMN 'sso';`).run();
            db.prepare(
                `ALTER TABLE 'resources' ADD COLUMN 'sso' integer;`
            ).run();

            db.prepare(
                `ALTER TABLE 'resources' DROP COLUMN 'applyRules';`
            ).run();
            db.prepare(
                `ALTER TABLE 'resources' ADD COLUMN 'applyRules' integer;`
            ).run();

            db.prepare(
                `ALTER TABLE 'resources' DROP COLUMN 'emailWhitelistEnabled';`
            ).run();
            db.prepare(
                `ALTER TABLE 'resources' ADD COLUMN 'emailWhitelistEnabled' integer;`
            ).run();
        })();

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
