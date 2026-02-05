import { db, sites } from "@server/db";
import { MessageHandler } from "@server/routers/ws";
import { Newt } from "@server/db";
import { eq } from "drizzle-orm";
import logger from "@server/logger";

export const handleDnsStatusMessage: MessageHandler = async (context) => {
    const { message, client } = context;
    const newt = client as Newt;

    if (!newt) {
        logger.warn("DNS status message: Newt not found");
        return;
    }

    if (!newt.siteId) {
        logger.warn("DNS status message: Newt has no site ID");
        return;
    }

    const { status, error, address } = message.data;

    logger.info(
        `Updating DNS status for site ${newt.siteId}: status=${status}, address=${address}, error=${error}`
    );

    try {
        await db
            .update(sites)
            .set({
                dnsStatus: status,
                dnsError: error || null
            })
            .where(eq(sites.siteId, newt.siteId));
    } catch (err) {
        logger.error(
            `Failed to update DNS status for site ${newt.siteId}:`,
            err
        );
    }

    return;
};
