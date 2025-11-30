import { Request, Response, NextFunction } from "express";
import { eq, and, lt, inArray, sql } from "drizzle-orm";
import { sites } from "@server/db";
import { db } from "@server/db";
import logger from "@server/logger";
import createHttpError from "http-errors";
import HttpCode from "@server/types/HttpCode";
import response from "@server/lib/response";
import { usageService } from "@server/lib/billing/usageService";
import { FeatureId } from "@server/lib/billing/features";
import { checkExitNodeOrg } from "#dynamic/lib/exitNodes";
import { build } from "@server/build";

// Track sites that are already offline to avoid unnecessary queries
const offlineSites = new Set<string>();

interface PeerBandwidth {
    publicKey: string;
    bytesIn: number;
    bytesOut: number;
}

export const receiveBandwidth = async (
    req: Request,
    res: Response,
    next: NextFunction
): Promise<any> => {
    try {
        const bandwidthData: PeerBandwidth[] = req.body;

        if (!Array.isArray(bandwidthData)) {
            throw new Error("Invalid bandwidth data");
        }

        await updateSiteBandwidth(bandwidthData, build == "saas"); // we are checking the usage on saas only

        return response(res, {
            data: {},
            success: true,
            error: false,
            message: "Bandwidth data updated successfully",
            status: HttpCode.OK
        });
    } catch (error) {
        logger.error("Error updating bandwidth data:", error);
        return next(
            createHttpError(
                HttpCode.INTERNAL_SERVER_ERROR,
                "An error occurred..."
            )
        );
    }
};

export async function updateSiteBandwidth(
    bandwidthData: PeerBandwidth[],
    calcUsageAndLimits: boolean,
    exitNodeId?: number
) {
    const currentTime = new Date();
    const oneMinuteAgo = new Date(currentTime.getTime() - 60000); // 1 minute ago

    // logger.debug(`Received data: ${JSON.stringify(bandwidthData)}`);

    await db.transaction(async (trx) => {
        // First, handle sites that are actively reporting bandwidth
        const activePeers = bandwidthData.filter((peer) => peer.bytesIn > 0); // Bytesout will have data as it tries to send keep alive messages

        if (activePeers.length > 0) {
            // Remove any active peers from offline tracking since they're sending data
            activePeers.forEach((peer) => offlineSites.delete(peer.publicKey));

            // Aggregate usage data by organization
            const orgUsageMap = new Map<string, number>();
            const orgUptimeMap = new Map<string, number>();

            // Update all active sites with bandwidth data and get the site data in one operation
            const updatedSites = [];
            for (const peer of activePeers) {
                const [updatedSite] = await trx
                    .update(sites)
                    .set({
                        megabytesOut: sql`${sites.megabytesOut} + ${peer.bytesIn}`,
                        megabytesIn: sql`${sites.megabytesIn} + ${peer.bytesOut}`,
                        lastBandwidthUpdate: currentTime.toISOString(),
                        online: true
                    })
                    .where(eq(sites.pubKey, peer.publicKey))
                    .returning({
                        online: sites.online,
                        orgId: sites.orgId,
                        siteId: sites.siteId,
                        lastBandwidthUpdate: sites.lastBandwidthUpdate
                    });

                if (updatedSite) {
                    if (exitNodeId) {
                        if (
                            await checkExitNodeOrg(
                                exitNodeId,
                                updatedSite.orgId,
                                trx
                            )
                        ) {
                            // not allowed
                            logger.warn(
                                `Exit node ${exitNodeId} is not allowed for org ${updatedSite.orgId}`
                            );
                            // THIS SHOULD TRIGGER THE TRANSACTION TO FAIL?
                            throw new Error("Exit node not allowed");
                        }
                    }

                    updatedSites.push({ ...updatedSite, peer });
                }
            }

            // Calculate org usage aggregations using the updated site data
            for (const { peer, ...site } of updatedSites) {
                // Aggregate bandwidth usage for the org
                const totalBandwidth = peer.bytesIn + peer.bytesOut;
                const currentOrgUsage = orgUsageMap.get(site.orgId) || 0;
                orgUsageMap.set(site.orgId, currentOrgUsage + totalBandwidth);

                // Add 10 seconds of uptime for each active site
                const currentOrgUptime = orgUptimeMap.get(site.orgId) || 0;
                orgUptimeMap.set(site.orgId, currentOrgUptime + 10 / 60); // Store in minutes and jut add 10 seconds
            }

            if (calcUsageAndLimits) {
                // REMOTE EXIT NODES DO NOT COUNT TOWARDS USAGE
                // Process all usage updates sequentially by organization to reduce deadlock risk
                const allOrgIds = new Set([...orgUsageMap.keys(), ...orgUptimeMap.keys()]);
                
                for (const orgId of allOrgIds) {
                    try {
                        // Process bandwidth usage for this org
                        const totalBandwidth = orgUsageMap.get(orgId);
                        if (totalBandwidth) {
                            const bandwidthUsage = await usageService.add(
                                orgId,
                                FeatureId.EGRESS_DATA_MB,
                                totalBandwidth,
                                trx
                            );
                            if (bandwidthUsage) {
                                usageService
                                    .checkLimitSet(
                                        orgId,
                                        true,
                                        FeatureId.EGRESS_DATA_MB,
                                        bandwidthUsage,
                                        trx
                                    )
                                    .catch((error: any) => {
                                        logger.error(
                                            `Error checking bandwidth limits for org ${orgId}:`,
                                            error
                                        );
                                    });
                            }
                        }

                        // Process uptime usage for this org
                        const totalUptime = orgUptimeMap.get(orgId);
                        if (totalUptime) {
                            const uptimeUsage = await usageService.add(
                                orgId,
                                FeatureId.SITE_UPTIME,
                                totalUptime,
                                trx
                            );
                            if (uptimeUsage) {
                                usageService
                                    .checkLimitSet(
                                        orgId,
                                        true,
                                        FeatureId.SITE_UPTIME,
                                        uptimeUsage,
                                        trx
                                    )
                                    .catch((error: any) => {
                                        logger.error(
                                            `Error checking uptime limits for org ${orgId}:`,
                                            error
                                        );
                                    });
                            }
                        }
                    } catch (error) {
                        logger.error(
                            `Error processing usage for org ${orgId}:`,
                            error
                        );
                        // Don't break the loop, continue with other orgs
                    }
                }
            }
        }

        // Handle sites that reported zero bandwidth but need online status updated
        const zeroBandwidthPeers = bandwidthData.filter(
            (peer) => peer.bytesIn === 0 && !offlineSites.has(peer.publicKey) // Bytesout will have data as it tries to send keep alive messages
        );

        if (zeroBandwidthPeers.length > 0) {
            const zeroBandwidthSites = await trx
                .select()
                .from(sites)
                .where(
                    inArray(
                        sites.pubKey,
                        zeroBandwidthPeers.map((p) => p.publicKey)
                    )
                );

            for (const site of zeroBandwidthSites) {
                let newOnlineStatus = site.online;

                // Check if site should go offline based on last bandwidth update WITH DATA
                if (site.lastBandwidthUpdate) {
                    const lastUpdateWithData = new Date(
                        site.lastBandwidthUpdate
                    );
                    if (lastUpdateWithData < oneMinuteAgo) {
                        newOnlineStatus = false;
                    }
                } else {
                    // No previous data update recorded, set to offline
                    newOnlineStatus = false;
                }

                // Always update lastBandwidthUpdate to show this instance is receiving reports
                // Only update online status if it changed
                if (site.online !== newOnlineStatus) {
                    const [updatedSite] = await trx
                        .update(sites)
                        .set({
                            online: newOnlineStatus
                        })
                        .where(eq(sites.siteId, site.siteId))
                        .returning();

                    if (updatedSite && exitNodeId) {
                        if (
                            await checkExitNodeOrg(
                                exitNodeId,
                                updatedSite.orgId,
                                trx
                            )
                        ) {
                            // not allowed
                            logger.warn(
                                `Exit node ${exitNodeId} is not allowed for org ${updatedSite.orgId}`
                            );
                            // THIS SHOULD TRIGGER THE TRANSACTION TO FAIL?
                            throw new Error("Exit node not allowed");
                        }
                    }

                    // If site went offline, add it to our tracking set
                    if (!newOnlineStatus && site.pubKey) {
                        offlineSites.add(site.pubKey);
                    }
                }
            }
        }
    });
}
