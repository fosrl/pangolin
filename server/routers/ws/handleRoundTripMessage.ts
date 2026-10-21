import { db, roundTripMessageTracker } from "@server/db";
import { MessageHandler } from "@server/routers/ws";
import { eq } from "drizzle-orm";
import logger from "@server/logger";

interface RoundTripCompleteMessage {
    messageId: number;
    complete: boolean;
    error?: string;
}

export const handleRoundTripMessage: MessageHandler = async (context) => {
    const { message, client: c } = context;

    logger.info("Handling round trip message");

    const data = message.data as RoundTripCompleteMessage;

    try {
        const { messageId, complete, error } = data;

        if (!messageId) {
            logger.error("Round trip message missing messageId");
            return;
        }

        // Update the roundTripMessageTracker with completion status
        await db
            .update(roundTripMessageTracker)
            .set({
                complete: complete,
                receivedAt: Math.floor(Date.now() / 1000),
                error: error || null
            })
            .where(eq(roundTripMessageTracker.messageId, messageId));

        logger.info(
            `Round trip message ${messageId} marked as complete: ${complete}`
        );

        if (error) {
            logger.debug(
                `Round trip message ${messageId} did not complete: ${error}`
            );
        }
    } catch (error) {
        logger.error("Error processing round trip message:", error);
    }

    return;
};
