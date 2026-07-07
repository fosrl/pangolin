import { MessageHandler } from "@server/routers/ws";
import { db, Newt, sites } from "@server/db";
import { eq } from "drizzle-orm";
import logger from "@server/logger";
import { fireSiteOfflineAlert } from "@server/lib/alerts";

/**
 * Handles disconnecting messages from sites to show disconnected in the ui
 */
export const handleNewtDisconnectingMessage: MessageHandler = async (
    context
) => {
    const { message, client: c, sendToClient } = context;
    const newt = c as Newt;

    if (!newt) {
        logger.warn("Newt not found");
        return;
    }

    if (!newt.siteId) {
        logger.warn("Newt has no site ID!");
        return;
    }

    try {
        // Update the client's last ping timestamp
        await db.transaction(async (trx) => {
            const [site] = await trx
                .update(sites)
                .set({
                    online: false
                })
                .where(eq(sites.siteId, newt.siteId!))
                .returning();

            if (!site) {
                throw new Error(
                    `Could not find site ${newt.siteId} to update disconnection from disconnect message`
                );
            }

            await fireSiteOfflineAlert(
                site.orgId,
                site.siteId,
                site.name,
                undefined,
                trx
            );
        });
    } catch (error) {
        logger.error("Error handling site disconnecting message", error);
    }
};
