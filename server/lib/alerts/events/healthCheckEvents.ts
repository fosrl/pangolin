import logger from "@server/logger";
import { processAlerts } from "#dynamic/lib/alerts";
import {
    db,
    statusHistory,
    targetHealthCheck,
    targets,
    resources,
    Transaction,
    logsDb
} from "@server/db";
import { eq } from "drizzle-orm";
import { invalidateStatusHistoryCache } from "@server/lib/statusHistory";
import {
    fireResourceDegradedAlert,
    fireResourceHealthyAlert,
    fireResourceUnhealthyAlert,
    fireResourceUnknownAlert
} from "./resourceEvents";

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Fire a `health_check_healthy` alert for the given health check.
 *
 * Call this after a previously-failing health check has recovered so that any
 * matching `alertRules` can dispatch their email and webhook actions.
 *
 * @param orgId         - Organisation that owns the health check.
 * @param healthCheckId - Numeric primary key of the health check.
 * @param healthCheckName - Human-readable name shown in notifications (optional).
 * @param extra         - Any additional key/value pairs to include in the payload.
 */
export async function fireHealthCheckHealthyAlert(
    orgId: string,
    healthCheckId: number,
    healthCheckName?: string | null,
    healthCheckTargetId?: number | null,
    extra?: Record<string, unknown>,
    send: boolean = true,
    trx: Transaction | typeof db = db
): Promise<void> {
    try {
        await logsDb.insert(statusHistory).values({
            entityType: "health_check",
            entityId: healthCheckId,
            orgId: orgId,
            status: "healthy",
            timestamp: Math.floor(Date.now() / 1000)
        });
        await invalidateStatusHistoryCache("health_check", healthCheckId);

        await handleResource(orgId, healthCheckTargetId, send, trx);

        if (!send) {
            return;
        }

        await processAlerts({
            eventType: "health_check_healthy",
            orgId,
            healthCheckId,
            data: {
                ...(healthCheckName != null ? { healthCheckName } : {}),
                ...extra
            }
        });
        await processAlerts({
            eventType: "health_check_toggle",
            orgId,
            healthCheckId,
            data: {
                healthCheckId,
                status: "healthy",
                ...(healthCheckName != null ? { healthCheckName } : {}),
                ...extra
            }
        });
    } catch (err) {
        logger.error(
            `fireHealthCheckHealthyAlert: unexpected error for healthCheckId ${healthCheckId}`,
            err
        );
    }
}

/**
 * Fire a `health_check_unhealthy` alert for the given health check.
 *
 * Call this after a health check has been detected as failing so that any
 * matching `alertRules` can dispatch their email and webhook actions.
 *
 * @param orgId         - Organisation that owns the health check.
 * @param healthCheckId - Numeric primary key of the health check.
 * @param healthCheckName - Human-readable name shown in notifications (optional).
 * @param extra         - Any additional key/value pairs to include in the payload.
 */
export async function fireHealthCheckUnhealthyAlert(
    orgId: string,
    healthCheckId: number,
    healthCheckName?: string | null,
    healthCheckTargetId?: number | null,
    extra?: Record<string, unknown>,
    send: boolean = true,
    trx: Transaction | typeof db = db
): Promise<void> {
    try {
        await logsDb.insert(statusHistory).values({
            entityType: "health_check",
            entityId: healthCheckId,
            orgId: orgId,
            status: "unhealthy",
            timestamp: Math.floor(Date.now() / 1000)
        });
        await invalidateStatusHistoryCache("health_check", healthCheckId);

        await handleResource(orgId, healthCheckTargetId, send, trx);

        if (!send) {
            return;
        }

        await processAlerts({
            eventType: "health_check_unhealthy",
            orgId,
            healthCheckId,
            data: {
                ...(healthCheckName != null ? { healthCheckName } : {}),
                ...extra
            }
        });
        await processAlerts({
            eventType: "health_check_toggle",
            orgId,
            healthCheckId,
            data: {
                healthCheckId,
                status: "unhealthy",
                ...(healthCheckName != null ? { healthCheckName } : {}),
                ...extra
            }
        });
    } catch (err) {
        logger.error(
            `fireHealthCheckUnhealthyAlert: unexpected error for healthCheckId ${healthCheckId}`,
            err
        );
    }
}

export async function fireHealthCheckUnknownAlert(
    orgId: string,
    healthCheckId: number,
    healthCheckName?: string | null,
    healthCheckTargetId?: number | null,
    extra?: Record<string, unknown>,
    send: boolean = true,
    trx: Transaction | typeof db = db
): Promise<void> {
    try {
        await logsDb.insert(statusHistory).values({
            entityType: "health_check",
            entityId: healthCheckId,
            orgId: orgId,
            status: "unknown",
            timestamp: Math.floor(Date.now() / 1000)
        });
        await invalidateStatusHistoryCache("health_check", healthCheckId);

        await handleResource(orgId, healthCheckTargetId, send, trx);

        if (!send) {
            return;
        }
    } catch (err) {
        logger.error(
            `fireHealthCheckUnknownAlert: unexpected error for healthCheckId ${healthCheckId}`,
            err
        );
    }
}

async function handleResource(
    orgId: string,
    healthCheckTargetId?: number | null,
    send: boolean = true,
    trx: Transaction | typeof db = db
) {
    if (!healthCheckTargetId) {
        return;
    }
    // we have targets lets get them
    const [target] = await trx
        .select()
        .from(targets)
        .where(eq(targets.targetId, healthCheckTargetId))
        .limit(1);

    if (!target) {
        return;
    }

    const [resource] = await trx
        .select()
        .from(resources)
        .where(eq(resources.resourceId, target.resourceId))
        .limit(1);

    if (!resource) {
        return;
    }

    const otherTargets = await trx
        .select({ hcHealth: targetHealthCheck.hcHealth })
        .from(targets)
        .innerJoin(
            targetHealthCheck,
            eq(targetHealthCheck.targetId, targets.targetId)
        )
        .where(eq(targets.resourceId, resource.resourceId));

    const monitoredTargets = otherTargets.filter(
        (t) => t.hcHealth !== "unknown"
    );

    let health = "healthy";
    const allUnknown = monitoredTargets.length === 0;
    const allHealthy = monitoredTargets.every(
        (t) => t.hcHealth === "healthy"
    );
    const allUnhealthy = monitoredTargets.every(
        (t) => t.hcHealth === "unhealthy"
    );

    if (allUnknown) {
        logger.debug(
            `Marking resource ${resource.resourceId} as unknown because all health checks are disabled`
        );
        health = "unknown";
    } else if (allHealthy) {
        health = "healthy";
    } else if (allUnhealthy) {
        logger.debug(
            `Marking resource ${resource.resourceId} as unhealthy because all targets are unhealthy`
        );
        health = "unhealthy";
    } else {
        logger.debug(
            `Marking resource ${resource.resourceId} as degraded because some targets are unhealthy`
        );
        health = "degraded";
    }

    if (health != resource.health) {
        // it changed
        await trx
            .update(resources)
            .set({ health })
            .where(eq(resources.resourceId, resource.resourceId));

        if (health === "unknown") {
            await fireResourceUnknownAlert(
                orgId,
                resource.resourceId,
                resource.name,
                undefined,
                send,
                trx
            );
        } else if (health === "unhealthy") {
            await fireResourceUnhealthyAlert(
                orgId,
                resource.resourceId,
                resource.name,
                undefined,
                send,
                trx
            );
        } else if (health === "healthy") {
            await fireResourceHealthyAlert(
                orgId,
                resource.resourceId,
                resource.name,
                undefined,
                send,
                trx
            );
        } else if (health === "degraded") {
            await fireResourceDegradedAlert(
                orgId,
                resource.resourceId,
                resource.name,
                undefined,
                send,
                trx
            );
        }
    }
}
