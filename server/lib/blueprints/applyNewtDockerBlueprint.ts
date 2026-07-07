import { sendToClient } from "#dynamic/routers/ws";
import { processContainerLabels } from "./parseDockerContainers";
import { applyBlueprint } from "./applyBlueprint";
import { PrivateResourceSchema, PublicResourceSchema } from "./types";
import { db, sites } from "@server/db";
import { eq } from "drizzle-orm";
import logger from "@server/logger";

type BlueprintResult = ReturnType<typeof processContainerLabels>;

function filterInvalidResources(blueprint: BlueprintResult): {
    skippedCount: number;
    skippedKeys: string[];
} {
    const skippedKeys: string[] = [];

    for (const section of ["proxy-resources", "public-resources"] as const) {
        const resources = blueprint[section];
        for (const [key, value] of Object.entries(resources)) {
            const result = PublicResourceSchema.safeParse(value);
            if (!result.success) {
                const errors = result.error.issues
                    .map((i) => `${i.path.join(".")}: ${i.message}`)
                    .join("; ");
                logger.warn(
                    `Skipping invalid Docker ${section} "${key}": ${errors}`
                );
                delete resources[key];
                skippedKeys.push(`${section}.${key}`);
            }
        }
    }

    for (const section of ["client-resources", "private-resources"] as const) {
        const resources = blueprint[section];
        for (const [key, value] of Object.entries(resources)) {
            const result = PrivateResourceSchema.safeParse(value);
            if (!result.success) {
                const errors = result.error.issues
                    .map((i) => `${i.path.join(".")}: ${i.message}`)
                    .join("; ");
                logger.warn(
                    `Skipping invalid Docker ${section} "${key}": ${errors}`
                );
                delete resources[key];
                skippedKeys.push(`${section}.${key}`);
            }
        }
    }

    return { skippedCount: skippedKeys.length, skippedKeys };
}

export async function applyNewtDockerBlueprint(
    siteId: number,
    newtId: string,
    containers: any
) {
    const [site] = await db
        .select()
        .from(sites)
        .where(eq(sites.siteId, siteId))
        .limit(1);

    if (!site) {
        logger.warn("Site not found in applyNewtDockerBlueprint");
        return;
    }

    let skippedCount = 0;
    let skippedKeys: string[] = [];

    try {
        // Some Newt clients can report null/undefined containers when Docker
        // labels are unavailable. Treat that as an empty blueprint payload.
        const safeContainers = Array.isArray(containers) ? containers : [];
        const blueprint = processContainerLabels(safeContainers);

        logger.debug(
            `Received Docker blueprint with ${Object.keys(blueprint["proxy-resources"]).length} proxy, ${Object.keys(blueprint["client-resources"]).length} client resource(s)`
        );

        const filterResult = filterInvalidResources(blueprint);
        skippedCount = filterResult.skippedCount;
        skippedKeys = filterResult.skippedKeys;

        if (skippedCount > 0) {
            logger.warn(
                `Filtered ${skippedCount} invalid resource(s) from Docker blueprint: ${skippedKeys.join(", ")}`
            );
        }

        if (
            isEmptyObject(blueprint["proxy-resources"]) &&
            isEmptyObject(blueprint["client-resources"]) &&
            isEmptyObject(blueprint["public-resources"]) &&
            isEmptyObject(blueprint["private-resources"])
        ) {
            if (skippedCount > 0) {
                await sendToClient(newtId, {
                    type: "newt/blueprint/results",
                    data: {
                        success: false,
                        message: `All resources were invalid and skipped: ${skippedKeys.join(", ")}`
                    }
                });
            }
            return;
        }

        // Update the blueprint in the database
        await applyBlueprint({
            orgId: site.orgId,
            configData: blueprint,
            siteId: site.siteId,
            source: "NEWT"
        });
    } catch (error) {
        logger.debug(`Failed to update database from config: ${error}`);
        await sendToClient(newtId, {
            type: "newt/blueprint/results",
            data: {
                success: false,
                message: `Failed to apply blueprint from config: ${error}`
            }
        });
        return;
    }

    await sendToClient(newtId, {
        type: "newt/blueprint/results",
        data: {
            success: true,
            message:
                skippedCount > 0
                    ? `Config updated successfully. Skipped ${skippedCount} invalid resource(s): ${skippedKeys.join(", ")}`
                    : "Config updated successfully"
        }
    });
}

function isEmptyObject(obj: any) {
    if (obj === null || obj === undefined) {
        return true;
    }
    return Object.keys(obj).length === 0 && obj.constructor === Object;
}
