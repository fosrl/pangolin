import { db } from "../../db/sqlite";
import {
    emailVerificationCodes,
    passwordResetTokens,
    resourceOtp,
    resources,
    resourceWhitelist,
    targets,
    userInvites,
    users
} from "../../db/sqlite";
import { APP_PATH, configFilePath1, configFilePath2 } from "@server/lib/consts";
import { eq, sql } from "drizzle-orm";
import fs from "fs";
import yaml from "js-yaml";
import path from "path";
import { z } from "zod";
import { fromZodError } from "zod-validation-error";

export default async function migration() {
    console.log("Running setup script 1.0.0-beta.9...");

    // make dir config/db/backups
    const appPath = APP_PATH;
    const dbDir = path.join(appPath, "db");

    const backupsDir = path.join(dbDir, "backups");

    // check if the backups directory exists and create it if it doesn't
    if (!fs.existsSync(backupsDir)) {
        fs.mkdirSync(backupsDir, { recursive: true });
    }

    // copy the db.sqlite file to backups
    // add the date to the filename
    const date = new Date();
    const dateString = `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}_${date.getHours()}-${date.getMinutes()}-${date.getSeconds()}`;
    const dbPath = path.join(dbDir, "db.sqlite");
    const backupPath = path.join(backupsDir, `db_${dateString}.sqlite`);
    fs.copyFileSync(dbPath, backupPath);

    await db.transaction(async (trx) => {
        try {
            // Determine which config file exists
            const filePaths = [configFilePath1, configFilePath2];
            let filePath = "";
            for (const path of filePaths) {
                if (fs.existsSync(path)) {
                    filePath = path;
                    break;
                }
            }

            if (!filePath) {
                throw new Error(
                    `No config file found (expected config.yml or config.yaml).`
                );
            }

            // Read and parse the YAML file
            const fileContents = fs.readFileSync(filePath, "utf8");
            const rawConfig = yaml.load(fileContents) as any;

            rawConfig.server.resource_session_request_param =
                "p_session_request";
            rawConfig.server.session_cookie_name = "p_session_token"; // rename to prevent conflicts
            delete rawConfig.server.resource_session_cookie_name;

            if (!rawConfig.flags) {
                rawConfig.flags = {};
            }

            rawConfig.flags.allow_raw_resources = true;

            // Write the updated YAML back to the file
            const updatedYaml = yaml.dump(rawConfig);
            fs.writeFileSync(filePath, updatedYaml, "utf8");
        } catch (e) {
            console.log(
                `Failed to add resource_session_request_param to config. Please add it manually. https://docs.pangolin.net/self-host/advanced/config-file`
            );
            trx.rollback();
            return;
        }

        try {
            const traefikPath = path.join(
                APP_PATH,
                "traefik",
                "traefik_config.yml"
            );

            // Define schema for traefik config validation
            const schema = z.object({
                entryPoints: z
                    .object({
                        websecure: z
                            .object({
                                address: z.string(),
                                transport: z
                                    .object({
                                        respondingTimeouts: z.object({
                                            readTimeout: z.string()
                                        })
                                    })
                                    .optional()
                            })
                            .optional()
                    })
                    .optional(),
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

            const parsedConfig: any = schema.safeParse(traefikConfig);

            if (parsedConfig.success) {
                // Ensure websecure entrypoint exists
                if (traefikConfig.entryPoints?.websecure) {
                    // Add transport configuration
                    traefikConfig.entryPoints.websecure.transport = {
                        respondingTimeouts: {
                            readTimeout: "30m"
                        }
                    };
                }

                traefikConfig.experimental.plugins.badger.version =
                    "v1.0.0-beta.3";

                const updatedTraefikYaml = yaml.dump(traefikConfig);
                fs.writeFileSync(traefikPath, updatedTraefikYaml, "utf8");

                console.log("Updated Badger version in Traefik config.");
            } else {
                console.log(fromZodError(parsedConfig.error));
                console.log(
                    "We were unable to update the version of Badger in your Traefik configuration. Please update it manually to at least v1.0.0-beta.3. https://github.com/fosrl/badger"
                );
            }
        } catch (e) {
            console.log(
                "We were unable to update the version of Badger in your Traefik configuration. Please update it manually to at least v1.0.0-beta.3. https://github.com/fosrl/badger"
            );
            trx.rollback();
            return;
        }

        try {
            const traefikPath = path.join(
                APP_PATH,
                "traefik",
                "dynamic_config.yml"
            );

            const schema = z.object({
                http: z.object({
                    middlewares: z.object({
                        "redirect-to-https": z.object({
                            redirectScheme: z.object({
                                scheme: z.string(),
                                permanent: z.boolean()
                            })
                        })
                    })
                })
            });

            const traefikFileContents = fs.readFileSync(traefikPath, "utf8");
            const traefikConfig = yaml.load(traefikFileContents) as any;

            const parsedConfig: any = schema.safeParse(traefikConfig);

            if (parsedConfig.success) {
                // delete permanent from redirect-to-https middleware
                delete traefikConfig.http.middlewares["redirect-to-https"].redirectScheme.permanent;

                const updatedTraefikYaml = yaml.dump(traefikConfig);
                fs.writeFileSync(traefikPath, updatedTraefikYaml, "utf8");

                console.log("Deleted permanent from redirect-to-https middleware.");
            } else {
                console.log(fromZodError(parsedConfig.error));
                console.log(
                    "We were unable to delete the permanent field from the redirect-to-https middleware in your Traefik configuration. Please delete it manually."
                );
            }
        } catch (e) {
            console.log(
                "We were unable to delete the permanent field from the redirect-to-https middleware in your Traefik configuration. Please delete it manually. Note that this is not a critical change but recommended."
            );
        }

        trx.run(sql`UPDATE ${users} SET email = LOWER(email);`);
        trx.run(
            sql`UPDATE ${emailVerificationCodes} SET email = LOWER(email);`
        );
        trx.run(sql`UPDATE ${passwordResetTokens} SET email = LOWER(email);`);
        trx.run(sql`UPDATE ${userInvites} SET email = LOWER(email);`);
        trx.run(sql`UPDATE ${resourceWhitelist} SET email = LOWER(email);`);
        trx.run(sql`UPDATE ${resourceOtp} SET email = LOWER(email);`);

        const resourcesAll = await trx
            .select({
                resourceId: resources.resourceId,
                fullDomain: resources.fullDomain,
                subdomain: resources.subdomain
            })
            .from(resources);

        trx.run(`DROP INDEX resources_fullDomain_unique;`);
        trx.run(`ALTER TABLE resources
                DROP COLUMN fullDomain;
            `);
        trx.run(`ALTER TABLE resources
                DROP COLUMN subdomain;
            `);
        trx.run(sql`ALTER TABLE resources
                ADD COLUMN fullDomain TEXT;
            `);
        trx.run(sql`ALTER TABLE resources
                ADD COLUMN subdomain TEXT;
            `);
        trx.run(sql`ALTER TABLE resources
                ADD COLUMN http INTEGER DEFAULT true NOT NULL;
            `);
        trx.run(sql`ALTER TABLE resources
                ADD COLUMN protocol TEXT DEFAULT 'tcp' NOT NULL;
            `);
        trx.run(sql`ALTER TABLE resources
                ADD COLUMN proxyPort INTEGER;
            `);

        // write the new fullDomain and subdomain values back to the database
        for (const resource of resourcesAll) {
            await trx
                .update(resources)
                .set({
                    fullDomain: resource.fullDomain,
                    subdomain: resource.subdomain
                })
                .where(eq(resources.resourceId, resource.resourceId));
        }

        const targetsAll = await trx
            .select({
                targetId: targets.targetId,
                method: targets.method
            })
            .from(targets);

        trx.run(`ALTER TABLE targets
                DROP COLUMN method;
            `);
        trx.run(`ALTER TABLE targets
                DROP COLUMN protocol;
            `);
        trx.run(sql`ALTER TABLE targets
                ADD COLUMN method TEXT;
            `);

        // write the new method and protocol values back to the database
        for (const target of targetsAll) {
            await trx
                .update(targets)
                .set({
                    method: target.method
                })
                .where(eq(targets.targetId, target.targetId));
        }

        trx.run(
            sql`ALTER TABLE 'resourceSessions' ADD 'isRequestToken' integer;`
        );
        trx.run(
            sql`ALTER TABLE 'resourceSessions' ADD 'userSessionId' text REFERENCES session(id);`
        );
    });

    console.log("Done.");
}
