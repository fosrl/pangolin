import { db, newts } from "@server/db";
import { MessageHandler } from "@server/routers/ws";
import { exitNodes, Newt, resources, sites, Target, targets } from "@server/db";
import { eq, and, sql, inArray } from "drizzle-orm";
import logger from "@server/logger";
import { applyBlueprint } from "@server/lib/blueprints/applyBlueprint";

export const handleApplyBlueprintMessage: MessageHandler = async (context) => {
    const { message, client, sendToClient } = context;
    const newt = client as Newt;

    logger.debug("Handling apply blueprint message!");

    if (!newt) {
        logger.warn("Newt not found");
        return;
    }

    if (!newt.siteId) {
        logger.warn("Newt has no site!"); // TODO: Maybe we create the site here?
        return;
    }

    // get the site
    const [site] = await db
        .select()
        .from(sites)
        .where(eq(sites.siteId, newt.siteId));

    if (!site) {
        logger.warn("Site not found for newt");
        return;
    }

    const { blueprint } = message.data;
    if (!blueprint) {
        logger.warn("No blueprint provided");
        return;
    }

    logger.debug(`Received blueprint: ${blueprint}`);

    try {
        const blueprintParsed = JSON.parse(blueprint);
        // Update the blueprint in the database
        await applyBlueprint({
            orgId: site.orgId,
            configData: blueprintParsed,
            siteId: site.siteId,
            source: "NEWT"
        });
    } catch (error) {
        logger.error(`Failed to update database from config: ${error}`);
        return {
            message: {
                type: "newt/blueprint/results",
                data: {
                    success: false,
                    message: `Failed to update database from config: ${error}`
                }
            },
            broadcast: false, // Send to all clients
            excludeSender: false // Include sender in broadcast
        };
    }

    return {
        message: {
            type: "newt/blueprint/results",
            data: {
                success: true,
                message: "Config updated successfully"
            }
        },
        broadcast: false, // Send to all clients
        excludeSender: false // Include sender in broadcast
    };
};
