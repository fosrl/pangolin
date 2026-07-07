import { db, sites } from "@server/db";
import { getClientConfigVersion } from "#dynamic/routers/ws";
import { MessageHandler } from "@server/routers/ws";
import { Newt } from "@server/db";
import { eq } from "drizzle-orm";
import logger from "@server/logger";
import { sendNewtSyncMessage } from "./sync";
import semver from "semver";
import { recordSitePing } from "./pingAccumulator";

const NEWT_SUPPORTS_SYNC_VERSION = ">=1.14.0";
const PONG = {
    message: {
        type: "pong",
        data: {
            timestamp: new Date().toISOString()
        }
    },
    broadcast: false,
    excludeSender: false
};

/**
 * Handles ping messages from newt clients.
 *
 * On each ping:
 *  - Marks the associated site as online.
 *  - Records the current timestamp as the newt's last-ping time.
 *  - Triggers a config sync if the newt is running an outdated config version.
 *  - Responds with a pong message.
 */
export const handleNewtPingMessage: MessageHandler = async (context) => {
    const { message, client: c } = context;
    const newt = c as Newt;

    if (!newt) {
        logger.warn("Newt ping message: Newt not found");
        return;
    }

    if (!newt.siteId) {
        logger.warn("Newt ping message: has no site ID");
        return;
    }

    // Record the ping in memory; it will be flushed to the database
    // periodically by the ping accumulator (every ~10s) in a single
    // batched UPDATE instead of one query per ping. This prevents
    // connection pool exhaustion under load, especially with
    // cross-region latency to the database.
    recordSitePing(newt.siteId);

    if (
        newt.version &&
        !semver.satisfies(newt.version, NEWT_SUPPORTS_SYNC_VERSION)
    ) {
        // Newt does not support the sync message so not checking - stop here -
        return PONG;
    }

    // Check config version and sync if stale.
    const configVersion = await getClientConfigVersion(newt.newtId);

    if (
        message.configVersion != null &&
        configVersion != null &&
        configVersion !== message.configVersion
    ) {
        logger.warn(
            `Newt ping with outdated config version: ${message.configVersion} (current: ${configVersion})`
        );

        const [site] = await db
            .select()
            .from(sites)
            .where(eq(sites.siteId, newt.siteId))
            .limit(1);

        if (!site) {
            logger.warn(
                `Newt ping message: site with ID ${newt.siteId} not found`
            );
            return;
        }

        await sendNewtSyncMessage(newt, site);
    }

    return PONG;
};
