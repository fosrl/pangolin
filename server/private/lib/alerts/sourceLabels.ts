/*
 * This file is part of a proprietary work.
 *
 * Copyright (c) 2025-2026 Fossorial, Inc.
 * All rights reserved.
 *
 * This file is licensed under the Fossorial Commercial License.
 * You may not use this file except in compliance with the License.
 * Unauthorized use, copying, modification, or distribution is strictly prohibited.
 *
 * This file is not licensed under the AGPLv3.
 */

import { eq, inArray } from "drizzle-orm";
import {
    alertLabels,
    db,
    resourceLabels,
    siteLabels,
    targetHealthCheck,
    targets
} from "@server/db";

export type AlertSource = {
    siteId?: number;
    resourceId?: number;
    healthCheckId?: number;
};

/**
 * Returns the label IDs attached to an alert source.
 *
 * - Sites use `siteLabels`.
 * - Resources use `resourceLabels`.
 * - Health checks have no labels of their own, so they inherit the labels of
 *   the site they run on and of the resource their target belongs to.
 */
export async function getAlertSourceLabelIds(
    source: AlertSource
): Promise<number[]> {
    if (source.siteId != null) {
        return getSiteLabelIds([source.siteId]);
    }

    if (source.resourceId != null) {
        return getResourceLabelIds([source.resourceId]);
    }

    if (source.healthCheckId != null) {
        const [hc] = await db
            .select({
                siteId: targetHealthCheck.siteId,
                resourceId: targets.resourceId
            })
            .from(targetHealthCheck)
            .leftJoin(targets, eq(targets.targetId, targetHealthCheck.targetId))
            .where(
                eq(targetHealthCheck.targetHealthCheckId, source.healthCheckId)
            )
            .limit(1);

        if (!hc) return [];

        const [fromSite, fromResource] = await Promise.all([
            getSiteLabelIds([hc.siteId]),
            hc.resourceId != null
                ? getResourceLabelIds([hc.resourceId])
                : Promise.resolve([])
        ]);

        return [...new Set([...fromSite, ...fromResource])];
    }

    return [];
}

/**
 * Returns the IDs of alert rules that target at least one of `labelIds`.
 */
export async function getAlertRuleIdsForLabels(
    labelIds: number[]
): Promise<number[]> {
    if (labelIds.length === 0) return [];
    const rows = await db
        .selectDistinct({ alertRuleId: alertLabels.alertRuleId })
        .from(alertLabels)
        .where(inArray(alertLabels.labelId, labelIds));
    return rows.map((r) => r.alertRuleId);
}

async function getSiteLabelIds(siteIds: number[]): Promise<number[]> {
    const rows = await db
        .select({ labelId: siteLabels.labelId })
        .from(siteLabels)
        .where(inArray(siteLabels.siteId, siteIds));
    return rows.map((r) => r.labelId);
}

async function getResourceLabelIds(resourceIds: number[]): Promise<number[]> {
    const rows = await db
        .select({ labelId: resourceLabels.labelId })
        .from(resourceLabels)
        .where(inArray(resourceLabels.resourceId, resourceIds));
    return rows.map((r) => r.labelId);
}
