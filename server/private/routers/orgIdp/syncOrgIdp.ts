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

import { Request, Response, NextFunction } from "express";
import { z } from "zod";
import { db, idp, idpOrg, users } from "@server/db";
import response from "@server/lib/response";
import HttpCode from "@server/types/HttpCode";
import createHttpError from "http-errors";
import logger from "@server/logger";
import { fromError } from "zod-validation-error";
import { and, eq, inArray } from "drizzle-orm";
import { OpenAPITags, registry } from "@server/openApi";
import {
    runIdpDirectorySync,
    type UserSyncEntry
} from "#private/lib/idpAPI/syncWorkflow";

const paramsSchema = z
    .object({
        orgId: z.string().nonempty(),
        idpId: z.coerce.number<number>().int().positive()
    })
    .strict();

const bodySchema = z.strictObject({
    dryRun: z.boolean().optional().default(false)
});

type SyncEntrySummary = {
    username: string | null;
    email: string | null;
    name: string | null;
    user: UserSyncEntry["user"]["operation"];
    membership: UserSyncEntry["membership"]["operation"];
    reason?: string;
    roles?: string[];
};

export type SyncOrgIdpResponse = {
    dryRun: boolean;
    counts: {
        usersCreated: number;
        usersUpdated: number;
        membershipsAdded: number;
        membershipsUpdated: number;
        membershipsRemoved: number;
        unchanged: number;
    };
    /** Only for a dry run. */
    entries?: SyncEntrySummary[];
};

registry.registerPath({
    method: "post",
    path: "/org/{orgId}/idp/{idpId}/sync",
    description:
        "Run the directory sync of an IdP for an organization now. With `dryRun`, returns what would change without writing anything.",
    tags: [OpenAPITags.OrgIdp],
    request: {
        params: paramsSchema,
        body: {
            content: {
                "application/json": {
                    schema: bodySchema
                }
            }
        }
    },
    responses: {}
});

export async function syncOrgIdp(
    req: Request,
    res: Response,
    next: NextFunction
): Promise<any> {
    try {
        const parsedParams = paramsSchema.safeParse(req.params);
        if (!parsedParams.success) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    fromError(parsedParams.error).toString()
                )
            );
        }

        const parsedBody = bodySchema.safeParse(req.body ?? {});
        if (!parsedBody.success) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    fromError(parsedBody.error).toString()
                )
            );
        }

        const { orgId, idpId } = parsedParams.data;
        const { dryRun } = parsedBody.data;

        const [existing] = await db
            .select({
                apiIntegrationEnabled: idp.apiIntegrationEnabled,
                directorySyncEnabled: idp.directorySyncEnabled
            })
            .from(idp)
            .innerJoin(idpOrg, eq(idpOrg.idpId, idp.idpId))
            .where(and(eq(idp.idpId, idpId), eq(idpOrg.orgId, orgId)))
            .limit(1);

        if (!existing) {
            return next(
                createHttpError(
                    HttpCode.NOT_FOUND,
                    `IdP with ID ${idpId} is not associated with organization ${orgId}`
                )
            );
        }

        if (!existing.apiIntegrationEnabled) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    "The API integration is not enabled for this IdP"
                )
            );
        }

        if (!dryRun && !existing.directorySyncEnabled) {
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    "Directory sync is not enabled for this IdP"
                )
            );
        }

        const [result] = await runIdpDirectorySync({ dryRun, idpId, orgId });

        if (!result) {
            // the query only skips IdPs that aren't google/azure
            return next(
                createHttpError(
                    HttpCode.BAD_REQUEST,
                    "Directory sync is not available for this IdP type"
                )
            );
        }

        if (result.status === "skipped") {
            return next(
                createHttpError(
                    HttpCode.FORBIDDEN,
                    "This organization's plan doesn't include the IdP API integration"
                )
            );
        }

        if (result.status === "failed") {
            return next(
                createHttpError(
                    HttpCode.BAD_GATEWAY,
                    `Directory sync failed: ${result.error}`
                )
            );
        }

        const { entries } = result.plan;
        const counts: SyncOrgIdpResponse["counts"] = {
            usersCreated: 0,
            usersUpdated: 0,
            membershipsAdded: 0,
            membershipsUpdated: 0,
            membershipsRemoved: 0,
            unchanged: 0
        };
        for (const entry of entries) {
            if (entry.user.operation === "create") counts.usersCreated++;
            if (entry.user.operation === "update") counts.usersUpdated++;
            switch (entry.membership.operation) {
                case "add":
                    counts.membershipsAdded++;
                    break;
                case "updateRoles":
                    counts.membershipsUpdated++;
                    break;
                case "remove":
                    counts.membershipsRemoved++;
                    break;
                case "unchanged":
                    counts.unchanged++;
                    break;
            }
        }

        return response<SyncOrgIdpResponse>(res, {
            data: {
                dryRun,
                counts,
                entries: dryRun ? await summarizeEntries(entries) : undefined
            },
            success: true,
            error: false,
            message: dryRun
                ? "Directory sync preview computed"
                : "Directory sync completed",
            status: HttpCode.OK
        });
    } catch (error) {
        logger.error(error);
        return next(
            createHttpError(HttpCode.INTERNAL_SERVER_ERROR, "An error occurred")
        );
    }
}

async function summarizeEntries(
    entries: UserSyncEntry[]
): Promise<SyncEntrySummary[]> {
    // members gone from the directory only carry their userId
    const userIds = entries.flatMap((e) =>
        e.user.operation === "unchanged" ? [e.user.userId] : []
    );
    const knownUsers = new Map(
        userIds.length === 0
            ? []
            : (
                  await db
                      .select({
                          userId: users.userId,
                          username: users.username,
                          email: users.email,
                          name: users.name
                      })
                      .from(users)
                      .where(inArray(users.userId, userIds))
              ).map((u) => [u.userId, u])
    );

    return entries.map((entry) =>
        summarizeEntry(
            entry,
            entry.user.operation === "unchanged"
                ? knownUsers.get(entry.user.userId)
                : undefined
        )
    );
}

function summarizeEntry(
    entry: UserSyncEntry,
    knownUser:
        | { username: string; email: string | null; name: string | null }
        | undefined
): SyncEntrySummary {
    const userData =
        entry.user.operation === "create" || entry.user.operation === "update"
            ? entry.user.data
            : (knownUser ?? null);

    return {
        username: userData?.username ?? null,
        email: userData?.email ?? entry.directoryUser?.email ?? null,
        name: userData?.name ?? entry.directoryUser?.name ?? null,
        user: entry.user.operation,
        membership: entry.membership.operation,
        reason:
            entry.membership.operation === "unchanged"
                ? entry.membership.reason
                : undefined,
        roles:
            entry.membership.operation === "add" ||
            entry.membership.operation === "updateRoles"
                ? entry.membership.roles.map((r) => r.name)
                : undefined
    };
}
