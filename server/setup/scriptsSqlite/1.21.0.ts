import { APP_PATH } from "@server/lib/consts";
import Database from "better-sqlite3";
import fs from "fs";
import yaml from "js-yaml";
import path from "path";
import z from "zod";
import { fromZodError } from "zod-validation-error";

const version = "1.21.0";

export default async function migration() {
    console.log(`Running setup script ${version}...`);

    const location = path.join(APP_PATH, "db", "db.sqlite");
    const db = new Database(location);

    try {
        db.pragma("foreign_keys = OFF");

        db.transaction(() => {
            db.prepare(
                `
            ALTER TABLE 'resourceAccessToken' ADD 'userId' text REFERENCES user(id);
                `
            ).run();

            db.prepare(
                `
            ALTER TABLE 'resourceAccessToken' ADD 'persistSession' integer DEFAULT false NOT NULL;
                `
            ).run();

            db.prepare(
                `
            ALTER TABLE 'resources' ADD 'status' text DEFAULT 'approved';
                `
            ).run();

            db.prepare(
                `
            ALTER TABLE 'siteResources' ADD 'status' text DEFAULT 'approved';
                `
            ).run();

            db.prepare(
                `
            ALTER TABLE 'sites' ADD 'localEndpoints' text;
                `
            ).run();
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

        traefikConfig.experimental.plugins.badger.version = "v1.5.0";

        const updatedTraefikYaml = yaml.dump(traefikConfig);

        fs.writeFileSync(traefikPath, updatedTraefikYaml, "utf8");

        console.log(
            "Updated the version of Badger in your Traefik configuration to v1.5.0"
        );
    } catch (e) {
        console.log(
            "We were unable to update the version of Badger in your Traefik configuration. Please update it manually. Check the release notes for this version for more information."
        );
        console.error(e);
    }

    console.log(`${version} migration complete`);
}
