/*
 * This file is part of a proprietary work.
 *
 * Copyright (c) 2025 Fossorial, Inc.
 * All rights reserved.
 *
 * This file is licensed under the Fossorial Commercial License.
 * You may not use this file except in compliance with the License.
 * Unauthorized use, copying, modification, or distribution is strictly prohibited.
 *
 * This file is not licensed under the AGPLv3.
 */

import { ActionsEnum } from "@server/auth/actions";
import { actionAuditLog, db, orgs } from "@server/db";
import logger from "@server/logger";
import HttpCode from "@server/types/HttpCode";
import { Request, Response, NextFunction } from "express";
import createHttpError from "http-errors";
import { and, eq, lt } from "drizzle-orm";
import cache from "@server/lib/cache";

async function getActionDays(orgId: string): Promise<number> {
    // check cache first
    const cached = cache.get<number>(`org_${orgId}_actionDays`);
    if (cached !== undefined) {
        return cached;
    }

    const [org] = await db
        .select({
            settingsLogRetentionDaysAction: orgs.settingsLogRetentionDaysAction
        })
        .from(orgs)
        .where(eq(orgs.orgId, orgId))
        .limit(1);

    if (!org) {
        return 0;
    }

    // store the result in cache
    cache.set(`org_${orgId}_actionDays`, org.settingsLogRetentionDaysAction, 300);

    return org.settingsLogRetentionDaysAction;
}

export async function cleanUpOldLogs(orgId: string, retentionDays: number) {
    const now = Math.floor(Date.now() / 1000);

    const cutoffTimestamp = now - retentionDays * 24 * 60 * 60;

    try {
        await db
            .delete(actionAuditLog)
            .where(
                and(
                    lt(actionAuditLog.timestamp, cutoffTimestamp),
                    eq(actionAuditLog.orgId, orgId)
                )
            );

        logger.debug(
            `Cleaned up action audit logs older than ${retentionDays} days`
        );
    } catch (error) {
        logger.error("Error cleaning up old action audit logs:", error);
    }
}

export function logActionAudit(action: ActionsEnum) {
    return async function (
        req: Request,
        res: Response,
        next: NextFunction
    ): Promise<any> {
        try {
            let orgId;
            let actorType;
            let actor;
            let actorId;

            const user = req.user;
            if (user) {
                const userOrg = req.userOrg;
                orgId = userOrg?.orgId;
                actorType = "user";
                actor = user.username;
                actorId = user.userId;
            }
            const apiKey = req.apiKey;
            if (apiKey) {
                const apiKeyOrg = req.apiKeyOrg;
                orgId = apiKeyOrg?.orgId;
                actorType = "apiKey";
                actor = apiKey.name;
                actorId = apiKey.apiKeyId;
            }

            if (!orgId) {
                logger.warn("logActionAudit: No organization context found");
                return next();
            }

            if (!actorType || !actor || !actorId) {
                logger.warn("logActionAudit: Incomplete actor information");
                return next();
            }

            const retentionDays = await getActionDays(orgId);
            if (retentionDays === 0) {
                // do not log
                return next();
            }

            const timestamp = Math.floor(Date.now() / 1000);

            let metadata = null;
            if (req.params) {
                metadata = JSON.stringify(req.params);
            }

            await db.insert(actionAuditLog).values({
                timestamp,
                orgId,
                actorType,
                actor,
                actorId,
                action,
                metadata
            });

            return next();
        } catch (error) {
            logger.error(error);
            return next(
                createHttpError(
                    HttpCode.INTERNAL_SERVER_ERROR,
                    "Error verifying logging action"
                )
            );
        }
    };
}

