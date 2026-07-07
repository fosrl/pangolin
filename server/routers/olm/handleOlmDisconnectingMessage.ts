import { MessageHandler } from "@server/routers/ws";
import { clients, db, Olm } from "@server/db";
import { eq } from "drizzle-orm";
import logger from "@server/logger";

/**
 * Handles disconnecting messages from clients to show disconnected in the ui
 */
export const handleOlmDisconnectingMessage: MessageHandler = async (
    context
) => {
    const { message, client: c, sendToClient } = context;
    const olm = c as Olm;

    if (!olm) {
        logger.warn("Olm not found");
        return;
    }

    if (!olm.clientId) {
        logger.warn("Olm has no client ID!");
        return;
    }

    try {
        // Update the client's last ping timestamp
        await db
            .update(clients)
            .set({
                online: false
            })
            .where(eq(clients.clientId, olm.clientId));
    } catch (error) {
        logger.error("Error handling client disconnecting message", error);
    }
};
