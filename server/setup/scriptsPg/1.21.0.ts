import { db } from "@server/db/pg/driver";
import { APP_PATH } from "@server/lib/consts";
import { sql } from "drizzle-orm";
import fs from "fs";
import yaml from "js-yaml";
import path from "path";
import z from "zod";
import { fromZodError } from "zod-validation-error";

const version = "1.21.0";

export default async function migration() {
    console.log(`Running setup script ${version}...`);

    try {
        await db.execute(sql`BEGIN`);

        await db.execute(sql`
            ALTER TABLE "resourceAccessToken" ADD COLUMN "userId" varchar;
        `);

        await db.execute(sql`
            ALTER TABLE "resourceAccessToken" ADD COLUMN "persistSession" boolean DEFAULT false NOT NULL;
        `);

        await db.execute(sql`
            ALTER TABLE "resources" ADD COLUMN "status" varchar DEFAULT 'approved';
        `);

        await db.execute(sql`
            ALTER TABLE "siteResources" ADD COLUMN "status" varchar DEFAULT 'approved';
        `);

        await db.execute(sql`
            ALTER TABLE "sites" ADD COLUMN "localEndpoints" varchar;
        `);

        await db.execute(sql`
            ALTER TABLE "resourceAccessToken" ADD CONSTRAINT "resourceAccessToken_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
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
