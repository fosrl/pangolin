import { db, newts, sites } from "@server/db";
import { hasActiveConnections } from "#dynamic/routers/ws";
import { eq, lt, isNull, and, or, ne, not, inArray } from "drizzle-orm";
import logger from "@server/logger";
import { fireSiteOfflineAlert, fireSiteOnlineAlert } from "@server/lib/alerts";
import { getOfflineThresholds } from "#dynamic/lib/offlineThresholds";

// Track if the offline checker interval is running
let offlineCheckerInterval: NodeJS.Timeout | null = null;

/**
 * Starts the background interval that checks for newt sites that haven't
 * pinged recently and marks them as offline. For backward compatibility,
 * a site is only marked offline when there is no active WebSocket connection
 * either - so older newt versions that don't send pings but remain connected
 * continue to be treated as online.
 */
export const startNewtOfflineChecker = (): void => {
    if (offlineCheckerInterval) {
        return; // Already running
    }

    offlineCheckerInterval = setInterval(async () => {
        try {
            const thresholds = getOfflineThresholds();
            const offlineBefore = Math.floor(
                (Date.now() - thresholds.newtMs) / 1000
            );

            // Find all online newt-type sites that haven't pinged recently
            // (or have never pinged at all). Join newts to obtain the newtId
            // needed for the WebSocket connection check.
            const staleSites = await db
                .select({
                    siteId: sites.siteId,
                    orgId: sites.orgId,
                    name: sites.name,
                    newtId: newts.newtId,
                    lastPing: sites.lastPing
                })
                .from(sites)
                .innerJoin(newts, eq(newts.siteId, sites.siteId))
                .where(
                    and(
                        eq(sites.online, true),
                        eq(sites.type, "newt"),
                        or(
                            lt(sites.lastPing, offlineBefore),
                            isNull(sites.lastPing)
                        )
                    )
                );

            for (const staleSite of staleSites) {
                // Backward-compatibility check: if the newt still has an
                // active WebSocket connection (older clients that don't send
                // pings), keep the site online.
                const isConnected = await hasActiveConnections(
                    staleSite.newtId
                );
                if (isConnected) {
                    logger.debug(
                        `Newt ${staleSite.newtId} has not pinged recently but is still connected via WebSocket - keeping site ${staleSite.siteId} online`
                    );
                    continue;
                }

                logger.info(
                    `Marking site ${staleSite.siteId} offline: newt ${staleSite.newtId} has no recent ping and no active WebSocket connection`
                );

                await db.transaction(async (trx) => {
                    await trx
                        .update(sites)
                        .set({ online: false })
                        .where(eq(sites.siteId, staleSite.siteId));

                    await fireSiteOfflineAlert(
                        staleSite.orgId,
                        staleSite.siteId,
                        staleSite.name,
                        undefined,
                        trx
                    );
                });
            }

            // this part only effects self hosted. Its not efficient but we dont expect people to have very many wireguard sites
            // select all of the wireguard sites to evaluate if they need to be offline due to the last bandwidth update
            const allWireguardSites = await db
                .select({
                    siteId: sites.siteId,
                    orgId: sites.orgId,
                    name: sites.name,
                    online: sites.online,
                    lastBandwidthUpdate: sites.lastBandwidthUpdate
                })
                .from(sites)
                .where(
                    and(
                        eq(sites.type, "wireguard"),
                        not(isNull(sites.lastBandwidthUpdate))
                    )
                );

            const wireguardOfflineThreshold = Math.floor(
                (Date.now() - thresholds.newtWireguardMs) / 1000
            );

            // loop over each one. If its offline and there is a new update then mark it online. If its online and there is no update then mark it offline
            for (const site of allWireguardSites) {
                const lastBandwidthUpdate =
                    new Date(site.lastBandwidthUpdate!).getTime() / 1000;
                if (
                    lastBandwidthUpdate < wireguardOfflineThreshold &&
                    site.online
                ) {
                    logger.info(
                        `Marking wireguard site ${site.siteId} offline: no bandwidth update in over ${thresholds.newtWireguardMs / 1000} seconds`
                    );

                    await db.transaction(async (trx) => {
                        await trx
                            .update(sites)
                            .set({ online: false })
                            .where(eq(sites.siteId, site.siteId));

                        await fireSiteOfflineAlert(
                            site.orgId,
                            site.siteId,
                            site.name,
                            undefined,
                            trx
                        );
                    });
                } else if (
                    lastBandwidthUpdate >= wireguardOfflineThreshold &&
                    !site.online
                ) {
                    logger.info(
                        `Marking wireguard site ${site.siteId} online: recent bandwidth update`
                    );

                    await db.transaction(async (trx) => {
                        await trx
                            .update(sites)
                            .set({ online: true })
                            .where(eq(sites.siteId, site.siteId));

                        await fireSiteOnlineAlert(
                            site.orgId,
                            site.siteId,
                            site.name,
                            undefined,
                            trx
                        );
                    });
                }
            }
        } catch (error) {
            logger.error("Error in newt offline checker interval", { error });
        }
    }, getOfflineThresholds().checkIntervalMs);

    logger.debug("Started newt offline checker interval");
};

/**
 * Stops the background interval that checks for offline newt sites.
 */
export const stopNewtOfflineChecker = (): void => {
    if (offlineCheckerInterval) {
        clearInterval(offlineCheckerInterval);
        offlineCheckerInterval = null;
        logger.info("Stopped newt offline checker interval");
    }
};
