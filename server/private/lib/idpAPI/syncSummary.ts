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

import { db, roles, userOrgRoles, users } from "@server/db";
import { and, eq, inArray } from "drizzle-orm";
import type { UserSyncEntry } from "./syncWorkflow";

// Turns sync plans into what the "Sync now" endpoints return

export type SyncEntrySummary = {
    username: string | null;
    email: string | null;
    name: string | null;
    user: UserSyncEntry["user"]["operation"];
    membership: UserSyncEntry["membership"]["operation"];
    reason?: string;
    /** Roles after the sync, for "add" and "updateRoles". */
    roles?: string[];
    /** Current roles, for "updateRoles" and "remove". */
    previousRoles?: string[];
};

export type SyncCounts = {
    usersCreated: number;
    usersUpdated: number;
    membershipsAdded: number;
    membershipsUpdated: number;
    membershipsRemoved: number;
    unchanged: number;
};

export function emptySyncCounts(): SyncCounts {
    return {
        usersCreated: 0,
        usersUpdated: 0,
        membershipsAdded: 0,
        membershipsUpdated: 0,
        membershipsRemoved: 0,
        unchanged: 0
    };
}

/** Adds the plan's entries to `counts` (pass the same object to total several orgs). */
export function countSyncEntries(
    entries: UserSyncEntry[],
    counts: SyncCounts = emptySyncCounts()
): SyncCounts {
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
    return counts;
}

export async function summarizeEntries(
    entries: UserSyncEntry[],
    orgId: string
): Promise<SyncEntrySummary[]> {
    const entryUserId = (e: UserSyncEntry) =>
        e.user.operation === "unchanged"
            ? e.user.userId
            : e.user.operation === "update"
              ? e.user.data.userId
              : undefined;

    // members gone from the directory only carry their userId
    const unchangedUserIds = entries.flatMap((e) =>
        e.user.operation === "unchanged" ? [e.user.userId] : []
    );
    const knownUsers = new Map(
        unchangedUserIds.length === 0
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
                      .where(inArray(users.userId, unchangedUserIds))
              ).map((u) => [u.userId, u])
    );

    // current roles, to show the old roles next to the new ones (display only)
    const memberUserIds = entries.flatMap((e) => {
        const userId = entryUserId(e);
        return userId &&
            (e.membership.operation === "updateRoles" ||
                e.membership.operation === "remove")
            ? [userId]
            : [];
    });
    const currentRoles = new Map<string, string[]>();
    if (memberUserIds.length > 0) {
        const rows = await db
            .select({ userId: userOrgRoles.userId, name: roles.name })
            .from(userOrgRoles)
            .innerJoin(roles, eq(roles.roleId, userOrgRoles.roleId))
            .where(
                and(
                    eq(userOrgRoles.orgId, orgId),
                    inArray(userOrgRoles.userId, memberUserIds)
                )
            );
        for (const row of rows) {
            currentRoles.set(row.userId, [
                ...(currentRoles.get(row.userId) ?? []),
                row.name
            ]);
        }
    }

    return entries.map((entry) => {
        const userId = entryUserId(entry);
        return {
            ...summarizeEntry(
                entry,
                entry.user.operation === "unchanged"
                    ? knownUsers.get(entry.user.userId)
                    : undefined
            ),
            previousRoles:
                userId &&
                (entry.membership.operation === "updateRoles" ||
                    entry.membership.operation === "remove")
                    ? (currentRoles.get(userId) ?? [])
                    : undefined
        };
    });
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
