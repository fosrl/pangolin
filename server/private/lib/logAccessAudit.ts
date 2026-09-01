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

import { accessAuditLog, logsDb, db, orgs } from "@server/db";
import { getCountryCodeForIp } from "@server/lib/geoip";
import logger from "@server/logger";
import { and, eq, lt } from "drizzle-orm";
import cache from "#private/lib/cache";
import { calculateCutoffTimestamp } from "@server/lib/cleanupLogs";
import { stripPortFromHost } from "@server/lib/ip";

async function getAccessDays(orgId: string): Promise<number> {
    // check cache first
    const cached = await cache.get<number>(`org_${orgId}_accessDays`);
    if (cached !== undefined) {
        return cached;
    }

    const [org] = await db
        .select({
            settingsLogRetentionDaysAccess: orgs.settingsLogRetentionDaysAccess
        })
        .from(orgs)
        .where(eq(orgs.orgId, orgId))
        .limit(1);

    if (!org) {
        return 0;
    }

    // store the result in cache
    await cache.set(
        `org_${orgId}_accessDays`,
        org.settingsLogRetentionDaysAccess,
        300
    );

    return org.settingsLogRetentionDaysAccess;
}

export async function cleanUpOldLogs(orgId: string, retentionDays: number) {
    const cutoffTimestamp = calculateCutoffTimestamp(retentionDays);

    try {
        await logsDb
            .delete(accessAuditLog)
            .where(
                and(
                    lt(accessAuditLog.timestamp, cutoffTimestamp),
                    eq(accessAuditLog.orgId, orgId)
                )
            );

        logger.debug(
            `Cleaned up access audit logs older than ${retentionDays} days`
        );
    } catch (error) {
        logger.error("Error cleaning up old action audit logs:", error);
    }
}

export async function logAccessAudit(data: {
    action: boolean;
    type: string;
    orgId: string;
    resourceId?: number;
    siteResourceId?: number;
    user?: { username: string; userId: string };
    apiKey?: { name: string | null; apiKeyId: string };
    metadata?: any;
    userAgent?: string;
    requestIp?: string;
}) {
    try {
        const retentionDays = await getAccessDays(data.orgId);
        if (retentionDays === 0) {
            // do not log
            return;
        }

        let actorType: string | undefined;
        let actor: string | undefined;
        let actorId: string | undefined;

        const user = data.user;
        if (user) {
            actorType = "user";
            actor = user.username;
            actorId = user.userId;
        }
        const apiKey = data.apiKey;
        if (apiKey) {
            actorType = "apiKey";
            actor = apiKey.name || apiKey.apiKeyId;
            actorId = apiKey.apiKeyId;
        }

        // if (!actorType || !actor || !actorId) {
        //     logger.warn("logRequestAudit: Incomplete actor information");
        //     return;
        // }

        const timestamp = Math.floor(Date.now() / 1000);

        let metadata = null;
        if (metadata) {
            metadata = JSON.stringify(metadata);
        }

        const clientIp = data.requestIp
            ? stripPortFromHost(data.requestIp)
            : undefined;

        const countryCode = data.requestIp
            ? await getCountryCodeFromIp(data.requestIp)
            : undefined;

        await logsDb.insert(accessAuditLog).values({
            timestamp: timestamp,
            orgId: data.orgId,
            actorType,
            actor,
            actorId,
            action: data.action,
            type: data.type,
            metadata,
            resourceId: data.resourceId,
            siteResourceId: data.siteResourceId,
            userAgent: data.userAgent,
            ip: clientIp,
            location: countryCode
        });
    } catch (error) {
        logger.error(error);
    }
}

async function getCountryCodeFromIp(ip: string): Promise<string | undefined> {
    const geoIpCacheKey = `geoip_access:${ip}`;

    let cachedCountryCode: string | undefined = await cache.get(geoIpCacheKey);

    if (!cachedCountryCode) {
        cachedCountryCode = await getCountryCodeForIp(ip); // do it locally
        // Only cache successful lookups to avoid filling cache with undefined values
        if (cachedCountryCode) {
            // Cache for longer since IP geolocation doesn't change frequently
            await cache.set(geoIpCacheKey, cachedCountryCode, 300); // 5 minutes
        }
    }

    return cachedCountryCode;
}
