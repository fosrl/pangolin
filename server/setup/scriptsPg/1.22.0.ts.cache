import { db } from "@server/db/pg/driver";
import { APP_PATH } from "@server/lib/consts";
import { sql } from "drizzle-orm";
import fs from "fs";
import yaml from "js-yaml";
import path from "path";

const version = "1.22.0";

export default async function migration() {
    console.log(`Running setup script ${version}...`);

    try {
        await db.execute(sql`BEGIN`);

        await db.execute(sql`
            ALTER TABLE "resources" ADD COLUMN "enableCache" boolean DEFAULT false NOT NULL;
        `);

        await db.execute(sql`
            ALTER TABLE "resources" ADD COLUMN "enableCachePath" text DEFAULT '/tmp' NOT NULL;
        `);

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

        const traefikFileContents = fs.readFileSync(traefikPath, "utf8");
        const traefikConfig = yaml.load(traefikFileContents) as any;

        if (!traefikConfig.experimental) {
            traefikConfig.experimental = { plugins: {} };
        }
        if (!traefikConfig.experimental.plugins) {
            traefikConfig.experimental.plugins = {};
        }

        if (!traefikConfig.experimental.plugins.cache) {
            traefikConfig.experimental.plugins.cache = {
                moduleName: "github.com/traefik/plugin-simplecache",
                version: "v0.2.1"
            };

            const updatedTraefikYaml = yaml.dump(traefikConfig);
            fs.writeFileSync(traefikPath, updatedTraefikYaml, "utf8");

            console.log(
                "Added plugin-simplecache to your Traefik configuration"
            );
        } else {
            console.log(
                "plugin-simplecache already present in Traefik configuration"
            );
        }
    } catch (e) {
        console.log(
            "We were unable to add plugin-simplecache to your Traefik configuration. Please add it manually. Check the release notes for this version for more information."
        );
        console.error(e);
    }

    console.log(`${version} migration complete`);
}
