import { CommandModule } from "yargs";
import { stringify as stringifyYaml } from "yaml";
import { asc, eq } from "drizzle-orm";
import { db, orgs, resources, siteResources } from "@server/db";
import {
    buildPrivateResourceBlueprintConfig,
    buildPublicResourceBlueprintConfig,
    formatBlueprintNotes
} from "@server/lib/blueprints/exportResourceBlueprint";

type ExportBlueprintsArgs = {
    orgId?: string;
};

async function buildOrgBlueprint(orgId: string): Promise<string | null> {
    const [publicRows, privateRows] = await Promise.all([
        db
            .select({ resourceId: resources.resourceId })
            .from(resources)
            .where(eq(resources.orgId, orgId))
            .orderBy(asc(resources.resourceId)),
        db
            .select({ siteResourceId: siteResources.siteResourceId })
            .from(siteResources)
            .where(eq(siteResources.orgId, orgId))
            .orderBy(asc(siteResources.siteResourceId))
    ]);

    if (publicRows.length === 0 && privateRows.length === 0) {
        return null;
    }

    const notes: string[] = [];
    const proxyResources: Record<string, any> = {};
    const clientResources: Record<string, any> = {};

    for (const { resourceId } of publicRows) {
        const built = await buildPublicResourceBlueprintConfig(resourceId);
        proxyResources[built.niceId] = built.config;
        notes.push(...built.notes.map((n) => `${built.niceId}: ${n}`));
    }

    for (const { siteResourceId } of privateRows) {
        const built = await buildPrivateResourceBlueprintConfig(siteResourceId);
        clientResources[built.niceId] = built.config;
    }

    const config: Record<string, any> = {};
    if (publicRows.length > 0) {
        config["proxy-resources"] = proxyResources;
    }
    if (privateRows.length > 0) {
        config["client-resources"] = clientResources;
    }

    return (
        `# org: ${orgId}\n` +
        formatBlueprintNotes(notes) +
        stringifyYaml(config)
    );
}

export const exportBlueprints: CommandModule<{}, ExportBlueprintsArgs> = {
    command: "export-blueprints",
    describe:
        "Export all public resources and site resources as blueprint YAML to stdout (one document per organization)",
    builder: (yargs) => {
        return yargs.option("orgId", {
            type: "string",
            describe: "Only export resources for this organization ID"
        });
    },
    handler: async (argv: ExportBlueprintsArgs) => {
        try {
            let orgIds: string[];
            if (argv.orgId) {
                const [org] = await db
                    .select({ orgId: orgs.orgId })
                    .from(orgs)
                    .where(eq(orgs.orgId, argv.orgId))
                    .limit(1);
                if (!org) {
                    console.error(
                        `Error: Organization "${argv.orgId}" not found.`
                    );
                    process.exit(1);
                }
                orgIds = [org.orgId];
            } else {
                const rows = await db
                    .select({ orgId: orgs.orgId })
                    .from(orgs)
                    .orderBy(asc(orgs.orgId));
                orgIds = rows.map((r) => r.orgId);
            }

            // Only YAML goes to stdout so the output can be piped to a file
            const documents: string[] = [];
            for (const orgId of orgIds) {
                const doc = await buildOrgBlueprint(orgId);
                if (doc) {
                    documents.push(doc);
                }
            }

            if (documents.length === 0) {
                console.error("No resources found to export.");
                process.exit(0);
            }

            process.stdout.write(documents.join("---\n"));

            process.exit(0);
        } catch (error) {
            console.error("Error exporting blueprints:", error);
            process.exit(1);
        }
    }
};
