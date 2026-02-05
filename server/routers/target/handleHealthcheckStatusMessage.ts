import { db, primaryDb, targetHealthCheck } from "@server/db";
import { MessageHandler } from "@server/routers/ws";
import { Newt } from "@server/db";
import { eq, and, ne } from "drizzle-orm";
import logger from "@server/logger";
import {
    fireHealthCheckHealthyAlert,
    fireHealthCheckUnhealthyAlert
} from "@server/lib/alerts";
import { onHealthCheckUpdate } from "@server/routers/dns/dnsAuthority";

interface TargetHealthStatus {
    status: string;
    lastCheck: string;
    checkCount: number;
    lastError?: string;
    config: {
        id: string; // this could be the hc id or the target id, depending on the version of newt
        hcEnabled: boolean;
        hcPath?: string;
        hcScheme?: string;
        hcMode?: string;
        hcHostname?: string;
        hcPort?: number;
        hcInterval?: number;
        hcUnhealthyInterval?: number;
        hcTimeout?: number;
        hcHeaders?: any;
        hcFollowRedirects?: boolean;
        hcMethod?: string;
        hcTlsServerName?: string;
        hcHealthyThreshold?: number;
        hcUnhealthyThreshold?: number;
    };
}

interface HealthcheckStatusMessage {
    targets: Record<string, TargetHealthStatus>;
}

export const handleHealthcheckStatusMessage: MessageHandler = async (
    context
) => {
    const { message, client: c } = context;
    const newt = c as Newt;

    logger.info("Handling healthcheck status message");

    if (!newt) {
        logger.warn("Newt not found");
        return;
    }

    if (!newt.siteId) {
        logger.warn("Newt has no site ID");
        return;
    }

    const data = message.data as HealthcheckStatusMessage;

    if (!data.targets) {
        logger.warn("No targets data in healthcheck status message");
        return;
    }

    try {
        let successCount = 0;
        let errorCount = 0;
        const updatedTargetIds: number[] = [];

        // Process each target status update
        for (const [targetId, healthStatus] of Object.entries(data.targets)) {
            logger.debug(
                `Processing health status for target ${targetId}: ${healthStatus.status}${healthStatus.lastError ? ` (${healthStatus.lastError})` : ""}`
            );

            // Verify the target belongs to this newt's site before updating
            // This prevents unauthorized updates to targets from other sites
            const targetIdNum = parseInt(targetId);
            if (isNaN(targetIdNum)) {
                logger.warn(`Invalid target ID: ${targetId}`);
                errorCount++;
                continue;
            }

            const [targetCheck] = await primaryDb // using the primary db here in case it has just been updated and we are getting the immediate status back and it has not made it out to the repliacs yet
                .select({
                    targetId: targetHealthCheck.targetId,
                    orgId: targetHealthCheck.orgId,
                    targetHealthCheckId: targetHealthCheck.targetHealthCheckId,
                    name: targetHealthCheck.name,
                    hcHealth: targetHealthCheck.hcHealth,
                    hcEnabled: targetHealthCheck.hcEnabled
                })
                .from(targetHealthCheck)
                .where(
                    and(
                        eq(targetHealthCheck.targetHealthCheckId, targetIdNum),
                        eq(targetHealthCheck.siteId, newt.siteId)
                    )
                )
                .limit(1);

            if (!targetCheck) {
                logger.debug(
                    `Target ${targetId} not found or does not belong to site ${newt.siteId}`
                );
                errorCount++;
                continue;
            }

            if (!targetCheck.hcEnabled) {
                logger.debug(
                    `Health check for target ${targetId} is not enabled, skipping update`
                );
                continue;
            }

            // check if the status has changed
            if (targetCheck.hcHealth === healthStatus.status) {
                logger.debug(
                    `Health status for target ${targetId} is already ${healthStatus.status}, skipping update`
                );
                continue;
            }

            // Update the target's health status in the database and fire alert in a transaction
            await db.transaction(async (trx) => {
                await trx
                    .update(targetHealthCheck)
                    .set({
                        hcHealth: healthStatus.status as
                            | "unknown"
                            | "healthy"
                            | "unhealthy"
                    })
                    .where(
                        eq(
                            targetHealthCheck.targetHealthCheckId,
                            targetCheck.targetHealthCheckId
                        )
                    );

                // because we are checking above if there was a change we can fire the alert here because it changed
                if (healthStatus.status === "unhealthy") {
                    await fireHealthCheckUnhealthyAlert(
                        targetCheck.orgId,
                        targetCheck.targetHealthCheckId,
                        targetCheck.name ?? undefined,
                        targetCheck.targetId,
                        undefined,
                        true,
                        trx
                    );
                } else if (healthStatus.status === "healthy") {
                    await fireHealthCheckHealthyAlert(
                        targetCheck.orgId,
                        targetCheck.targetHealthCheckId,
                        targetCheck.name ?? undefined,
                        targetCheck.targetId,
                        undefined,
                        true,
                        trx
                    );
                }
            });

            logger.debug(
                `Updated health status for target ${targetId} to ${healthStatus.status}`
            );
            successCount++;
            updatedTargetIds.push(targetIdNum);
        }

        logger.debug(
            `Health status update complete: ${successCount} successful, ${errorCount} errors out of ${Object.keys(data.targets).length} targets`
        );

        if (updatedTargetIds.length > 0) {
            try {
                await onHealthCheckUpdate(updatedTargetIds);
            } catch (error) {
                logger.error("Error updating DNS authority config:", error);
            }
        }
    } catch (error) {
        logger.error("Error processing healthcheck status message:", error);
    }

    return;
};
