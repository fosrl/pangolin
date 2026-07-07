import { join } from "path";
import { readFileSync } from "fs";
import {
    clients,
    db,
    resourcePolicies,
    resources,
    siteResources
} from "@server/db";
import { randomInt } from "crypto";
import { exitNodes, sites } from "@server/db";
import { eq, and } from "drizzle-orm";
import { __DIRNAME } from "@server/lib/consts";

// Load the names from the names.json file
const dev = process.env.ENVIRONMENT !== "prod";
let file;
if (!dev) {
    file = join(__DIRNAME, "names.json");
} else {
    file = join("server/db/names.json");
}
export const names = JSON.parse(readFileSync(file, "utf-8"));

// Load iOS and Mac model mappings
let iosModelsFile: string;
let macModelsFile: string;
if (!dev) {
    iosModelsFile = join(__DIRNAME, "ios_models.json");
    macModelsFile = join(__DIRNAME, "mac_models.json");
} else {
    iosModelsFile = join("server/db/ios_models.json");
    macModelsFile = join("server/db/mac_models.json");
}

const iosModels: Record<string, string> = JSON.parse(
    readFileSync(iosModelsFile, "utf-8")
);
const macModels: Record<string, string> = JSON.parse(
    readFileSync(macModelsFile, "utf-8")
);

export async function getUniqueClientName(orgId: string): Promise<string> {
    let loops = 0;
    while (true) {
        if (loops > 100) {
            throw new Error("Could not generate a unique name");
        }

        const name = generateName();
        const count = await db
            .select({ niceId: clients.niceId, orgId: clients.orgId })
            .from(clients)
            .where(and(eq(clients.niceId, name), eq(clients.orgId, orgId)));
        if (count.length === 0) {
            return name;
        }
        loops++;
    }
}

export async function getUniqueSiteName(orgId: string): Promise<string> {
    let loops = 0;
    while (true) {
        if (loops > 100) {
            throw new Error("Could not generate a unique name");
        }

        const name = generateName();
        const count = await db
            .select({ niceId: sites.niceId, orgId: sites.orgId })
            .from(sites)
            .where(and(eq(sites.niceId, name), eq(sites.orgId, orgId)));
        if (count.length === 0) {
            return name;
        }
        loops++;
    }
}

export async function getUniqueResourceName(orgId: string): Promise<string> {
    let loops = 0;
    while (true) {
        if (loops > 100) {
            throw new Error("Could not generate a unique name");
        }

        const name = generateName();
        const [resourceCount, siteResourceCount] = await Promise.all([
            db
                .select({ niceId: resources.niceId, orgId: resources.orgId })
                .from(resources)
                .where(
                    and(eq(resources.niceId, name), eq(resources.orgId, orgId))
                ),
            db
                .select({
                    niceId: siteResources.niceId,
                    orgId: siteResources.orgId
                })
                .from(siteResources)
                .where(
                    and(
                        eq(siteResources.niceId, name),
                        eq(siteResources.orgId, orgId)
                    )
                )
        ]);
        if (resourceCount.length === 0 && siteResourceCount.length === 0) {
            return name;
        }
        loops++;
    }
}

export async function getUniqueResourcePolicyName(
    orgId: string
): Promise<string> {
    let loops = 0;
    while (true) {
        if (loops > 100) {
            throw new Error("Could not generate a unique name");
        }

        const name = generateName();
        const policyCount = await db
            .select({
                niceId: resourcePolicies.niceId,
                orgId: resourcePolicies.orgId
            })
            .from(resourcePolicies)
            .where(
                and(
                    eq(resourcePolicies.niceId, name),
                    eq(resourcePolicies.orgId, orgId)
                )
            );
        if (policyCount.length === 0) {
            return name;
        }
        loops++;
    }
}

export async function getUniqueSiteResourceName(
    orgId: string
): Promise<string> {
    let loops = 0;
    while (true) {
        if (loops > 100) {
            throw new Error("Could not generate a unique name");
        }

        const name = generateName();
        const [resourceCount, siteResourceCount] = await Promise.all([
            db
                .select({ niceId: resources.niceId, orgId: resources.orgId })
                .from(resources)
                .where(
                    and(eq(resources.niceId, name), eq(resources.orgId, orgId))
                ),
            db
                .select({
                    niceId: siteResources.niceId,
                    orgId: siteResources.orgId
                })
                .from(siteResources)
                .where(
                    and(
                        eq(siteResources.niceId, name),
                        eq(siteResources.orgId, orgId)
                    )
                )
        ]);
        if (resourceCount.length === 0 && siteResourceCount.length === 0) {
            return name;
        }
        loops++;
    }
}

export async function getUniqueExitNodeEndpointName(): Promise<string> {
    let loops = 0;
    const count = await db.select().from(exitNodes);
    while (true) {
        if (loops > 100) {
            throw new Error("Could not generate a unique name");
        }

        const name = generateName();

        for (const node of count) {
            if (node.endpoint.includes(name)) {
                loops++;
                continue;
            }
        }

        return name;
    }
}

export function generateName(): string {
    const name = (
        names.descriptors[randomInt(names.descriptors.length)] +
        "-" +
        names.animals[randomInt(names.animals.length)]
    )
        .toLowerCase()
        .replace(/\s/g, "-");

    // clean out any non-alphanumeric characters except for dashes
    return name.replace(/[^a-z0-9-]/g, "");
}

export function getMacDeviceName(macIdentifier?: string | null): string | null {
    if (macIdentifier && macModels[macIdentifier]) {
        return macModels[macIdentifier];
    }
    return null;
}

export function getIosDeviceName(iosIdentifier?: string | null): string | null {
    if (iosIdentifier && iosModels[iosIdentifier]) {
        return iosModels[iosIdentifier];
    }
    return null;
}

export function getUserDeviceName(
    model: string | null,
    fallBack: string | null
): string {
    return (
        getMacDeviceName(model) ||
        getIosDeviceName(model) ||
        fallBack ||
        "Unknown Device"
    );
}
