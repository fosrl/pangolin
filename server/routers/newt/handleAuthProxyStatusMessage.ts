import { MessageHandler } from "@server/routers/ws";
import { Newt } from "@server/db";
import logger from "@server/logger";

export const handleAuthProxyStatusMessage: MessageHandler = async (context) => {
    const { message, client } = context;
    const newt = client as Newt;

    if (!newt) {
        logger.warn("Auth proxy status message: Newt not found");
        return;
    }

    if (!newt.siteId) {
        logger.warn("Auth proxy status message: Newt has no site ID");
        return;
    }

    const {
        httpListening,
        httpsListening,
        httpSkipped,
        httpsSkipped,
        certCount,
        resourceCount,
        warning
    } = message.data;

    if (warning) {
        logger.warn(
            `Auth proxy status for site ${newt.siteId} (newt ${newt.newtId}): ${warning}`
        );
    }

    logger.info(
        `Auth proxy status for site ${newt.siteId}: ` +
            `HTTP=${httpListening ? "listening" : httpSkipped ? "skipped (port in use)" : "off"}, ` +
            `HTTPS=${httpsListening ? "listening" : httpsSkipped ? "skipped (port in use)" : "off"}, ` +
            `certs=${certCount}, resources=${resourceCount}`
    );
};
