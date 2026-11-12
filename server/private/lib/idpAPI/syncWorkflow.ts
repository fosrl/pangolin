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

import {
    db,
    idp,
    idpOidcConfig,
    idpOrg,
    orgs,
    userOrgRoles,
    userOrgs,
    users
} from "@server/db";

import { isLicensedOrSubscribed } from "#dynamic/lib/isLicencedOrSubscribed";
import { durationToMs } from "@app/lib/durationToMs";
import { generateId } from "@server/auth/sessions/app";
import { tierMatrix } from "@server/lib/billing/tierMatrix";
import { calculateUserClientsForOrgs } from "@server/lib/calculateUserClientsForOrgs";
import {
    createRoles,
    resolveOrgMembership
} from "@server/lib/idp/resolveOrgMembership";
import { assignUserToOrg, removeUserFromOrg } from "@server/lib/userOrg";
import logger from "@server/logger";
import { UserType } from "@server/types/UserTypes";
import { and, eq, inArray, sql, type InferInsertModel } from "drizzle-orm";
import jmespath from "jmespath";
import { AzureDirectorySyncProvider } from "./azure";
import { GoogleDirectorySyncProvider } from "./google";
import type { IDPAPIProvider, IDPDirectoryUser } from "./types";

type InsertUser = InferInsertModel<typeof users>;
type UpdateUser = Pick<InsertUser, "username" | "email" | "name" | "userId">;

/** `id` is `null` for a role that doesn't exist yet ("create missing roles"), it's created when the plan is applied. */
type SyncedRole = { id: number | null; name: string };

/** What happens to one user: their Pangolin profile and their membership in `orgId` are decided separately. */
export type UserSyncEntry = {
    /** `null` when the user is in Pangolin but gone from the directory. */
    directoryUser: IDPDirectoryUser | null;
    user:
        | { operation: "create"; data: InsertUser }
        | { operation: "update"; data: UpdateUser }
        | { operation: "unchanged"; userId: string }
        /** New directory user not provisioned in Pangolin. */
        | { operation: "skip" };

    membership:
        | { operation: "add" | "updateRoles"; roles: SyncedRole[] }
        /** Removed from the org, the user itself is not deleted. */
        | { operation: "remove" }
        | {
              operation: "unchanged";
              reason:
                  | "noMatchingRoles"
                  | "manualMembership"
                  | "owner"
                  | "noMatchingUserIdentifier"
                  /** `directorySyncDeletions` is off. */
                  | "deletionsDisabled";
          };
};

// the planned changes for one idpOrg, computed first and
// applied in a single transaction at the end
export type IdpOrgSyncPlan = {
    idpId: number;
    orgId: string;
    entries: UserSyncEntry[];
};

let directorySyncInterval: NodeJS.Timeout | null = null;
// the interval doesn't wait for the previous run, a slow directory could make runs pile up
let directorySyncRunning = false;
const DIRECTORY_SYNC_RUN_INTERVAL = durationToMs(5, "minutes");

export function startIdpDirectorySyncScheduler() {
    if (directorySyncInterval) {
        return;
    }

    directorySyncInterval = setInterval(async () => {
        if (directorySyncRunning) {
            logger.debug(
                "Directory sync: previous run still in progress, skipping"
            );
            return;
        }

        directorySyncRunning = true;
        try {
            await runIdpDirectorySync();
        } catch (error) {
            logger.error("Directory sync: run failed", { error });
        } finally {
            directorySyncRunning = false;
        }
    }, DIRECTORY_SYNC_RUN_INTERVAL);
}

export type IdpOrgSyncResult = {
    idpId: number;
    orgId: string;
} & (
    | { status: "synced"; plan: IdpOrgSyncPlan }
    /** The org isn't entitled to the IdP API integration. */
    | { status: "skipped" }
    | { status: "failed"; error: string }
);

/**
 * Syncs every (IdP, org) pair with sync on, one after another. A failure is
 * logged and the next pair still runs.
 *
 * - `idpId` / `orgId`: only sync that IdP / org ("Sync now").
 * - `dryRun`: compute the plans without writing anything. A dry run also covers
 *   IdPs whose sync is off (the API integration must be on), to preview it.
 */
export async function runIdpDirectorySync({
    dryRun = false,
    idpId,
    orgId
}: {
    dryRun?: boolean;
    idpId?: number;
    orgId?: string;
} = {}): Promise<IdpOrgSyncResult[]> {
    const idpsToSync = await db
        .select()
        .from(idp)
        .innerJoin(idpOidcConfig, eq(idpOidcConfig.idpId, idp.idpId))
        .innerJoin(idpOrg, eq(idpOrg.idpId, idp.idpId))
        .where(
            and(
                inArray(idpOidcConfig.variant, ["azure", "google"]),
                eq(idp.apiIntegrationEnabled, true),
                dryRun ? undefined : eq(idp.directorySyncEnabled, true),
                idpId === undefined ? undefined : eq(idp.idpId, idpId),
                orgId === undefined ? undefined : eq(idpOrg.orgId, orgId)
            )
        );

    const results: IdpOrgSyncResult[] = [];
    for (const data of idpsToSync) {
        const target = {
            idpId: data.idp.idpId,
            orgId: data.idpOrg.orgId
        };

        let provider: IDPAPIProvider;
        switch (data.idpOidcConfig.variant) {
            case "azure":
                provider = new AzureDirectorySyncProvider(data);
                break;
            case "google":
                provider = new GoogleDirectorySyncProvider(data);
                break;
            default:
                continue;
        }

        try {
            const plan = await syncIdp(provider, dryRun);
            results.push(
                plan
                    ? { ...target, status: "synced", plan }
                    : { ...target, status: "skipped" }
            );
        } catch (error) {
            logger.error(
                `Directory sync: failed for IdP ${target.idpId}, org ${target.orgId}`,
                { error }
            );
            results.push({
                ...target,
                status: "failed",
                error: error instanceof Error ? error.message : String(error)
            });
        }
    }

    return results;
}

async function syncIdp(provider: IDPAPIProvider, dryRun: boolean) {
    // Note
    // username is unique only within IDPs or within internal ?
    // we can have two users with the same username, one in an IDP and another `internal`
    // Which means: a user can have two accounts w/ the same username (email in azure for ex)
    // and each account can have different roles within the same Org

    // ...
    // users are matched on `users.username`, computed from `identifierPath` on the claims
    // (same as login). It should point to an immutable ID (`oid` for azure, `sub` for google)
    // so that renamed users keep their account

    // ...
    // For global idps, we will rely on org policies
    // we will not store a default mapping for directory sync
    // if the admin wants to add the synched IDP to an org, they can create an org policy
    // & set the role mapping to `groupNames` (for ex)
    // for global idps, if there is not an org policy for a specific org, the user is not added to that org

    // 0. Skip orgs that are not entitled to the IdP API integration (no data change on downgrade)
    const isEntitled = await isLicensedOrSubscribed(
        provider.idp.idpOrg.orgId,
        tierMatrix.idpAPIIntegration
    );
    if (!isEntitled) {
        logger.debug(
            `Directory sync: skipping IdP ${provider.idp.idp.idpId}, org ${provider.idp.idpOrg.orgId} is not entitled to the IdP API integration`
        );
        return null;
    }

    // 1. Fetch
    const result = await provider.fetchAllDirectoryUsers();

    /**
     * user =>
     *  user (has roles within) - org
     *
     * algorithm:

        fetch users for org:
            - if user is new to pangolin and idp:
                - if fixed roles:
                    -> create new user in DB
                - if group mapping:
                    - check that the user groups match at least one of the mapped groups:
                        -> create new user in DB
                - if automatic groups:
                    - if create:
                        -> create new user in DB
                    - if not create:
                        - check that group names matches:
                            -> create new user in DB
                
                -> Add user to Org with the correct roles

            - if user is not new to pangolin and idp:
                - if fixed roles or automatic groups with create :
                    - if user doesn't belongs to org:
                        -> add user to org with the correct roles
                    - else:
                        -> update user roles in org
                - if group mapping matches any role: 
                    -> update user roles in org
                - if automatic groups without create still matches groups:
                    -> update user roles in org
                - else:
                    -> remove user from org
            
            - if user exists in pangolin & IDP but not in remote users:
                -> remove user from org

for each remote user:
    roleIds = resolveRoles(claims, ctx.roleMapping) // same JMESPath format as JIT
                                                    // [] = user doesn't qualify for this org
    if user is disabled: roleIds = []

    pangolinUser = match by username (from identifierPath)
    if no pangolinUser:
        if roleIds empty: skip
        create user
    else:
        update profile (name, email, username)       // user-level, always safe

    membership = userOrg for (pangolinUser, orgId)
    if no membership:
        if roleIds non-empty: add to org with roleIds, flag = true
    else if membership.flag is true:
        if roleIds non-empty: set roles to roleIds
        else:                 remove from org
    else (manual membership):
        skip                                         // admin-owned, don't touch

for each membership with flag = true whose user is not in the remote set:
    remove from org                                  // user row stays (may be in other orgs)

     
                */

    const {
        idp: { idpId },
        idpOrg: {
            orgId,
            syncRoleMapping,
            mappingsLinked,
            roleMapping,
            createMissingRoles,
            syncCreateMissingRoles,
            directorySyncDeletions
        },
        idpOidcConfig: { identifierPath }
    } = provider.idp;

    const existingUsers = await db
        .select()
        .from(users)
        .where(eq(users.idpId, idpId));

    const existingUserOrgs = await db
        .select()
        .from(users)
        .innerJoin(userOrgs, eq(userOrgs.userId, users.userId))
        .where(and(eq(users.idpId, idpId), eq(userOrgs.orgId, orgId)));

    // match on the username, same as login
    const usersByUsername = new Map<string, (typeof existingUsers)[number]>();
    for (const u of existingUsers) {
        usersByUsername.set(u.username, u);
    }

    const existingPangolinUserOrgs = new Map<
        string,
        (typeof existingUserOrgs)[number]
    >();
    for (const u of existingUserOrgs) {
        existingPangolinUserOrgs.set(u.user.userId, u);
    }

    const syncPlan: IdpOrgSyncPlan = {
        idpId: idpId,
        orgId: orgId,
        entries: []
    };

    const supportsMultiRole = await isLicensedOrSubscribed(
        orgId,
        tierMatrix.fullRbac
    );

    for (const user of result.users) {
        const claims = provider.toClaims(user);

        const usernameClaim = jmespath.search(claims, identifierPath);

        if (typeof usernameClaim !== "string" || !usernameClaim) {
            syncPlan.entries.push({
                directoryUser: user,
                membership: {
                    operation: "unchanged",
                    reason: "noMatchingUserIdentifier"
                },
                user: { operation: "skip" }
            });
            continue;
        }

        const effectiveRoleMapping = mappingsLinked
            ? roleMapping
            : syncRoleMapping;

        const effectiveCreateMissingRoles = mappingsLinked
            ? createMissingRoles
            : syncCreateMissingRoles;

        const roles = await resolveUserRoles(
            user,
            claims,
            effectiveRoleMapping,
            orgId,
            supportsMultiRole,
            effectiveCreateMissingRoles
        );

        // lowercased, same as login
        const username = usernameClaim.toLowerCase();

        const pangolinUser = usersByUsername.get(username);

        // this is a new user
        if (!pangolinUser) {
            // the user doesn't match any group/role on the org
            if (roles.length === 0) {
                syncPlan.entries.push({
                    directoryUser: user,
                    user: { operation: "skip" },
                    membership: {
                        operation: "unchanged",
                        reason: "noMatchingRoles"
                    }
                });
                continue;
            }

            syncPlan.entries.push({
                directoryUser: user,
                user: {
                    operation: "create",
                    data: {
                        userId: generateId(15),
                        username,
                        email: user.email,
                        name: user.name,
                        type: UserType.OIDC,
                        idpId: idpId,
                        emailVerified: true, // OIDC users are always verified
                        dateCreated: new Date().toISOString()
                    }
                },
                membership: { operation: "add", roles }
            });
        } else {
            const membership = existingPangolinUserOrgs.get(
                pangolinUser.userId
            );

            let membershipOperation: UserSyncEntry["membership"];

            if (!membership) {
                membershipOperation =
                    roles.length === 0
                        ? // skip users which don't belong to the org
                          { operation: "unchanged", reason: "noMatchingRoles" }
                        : { operation: "add", roles };
            } else if (membership.userOrgs.autoManaged) {
                if (membership.userOrgs.isOwner) {
                    membershipOperation = {
                        operation: "unchanged",
                        reason: "owner"
                    };
                } else if (roles.length === 0) {
                    membershipOperation = directorySyncDeletions
                        ? { operation: "remove" }
                        : {
                              operation: "unchanged",
                              reason: "deletionsDisabled"
                          };
                } else {
                    membershipOperation = { operation: "updateRoles", roles };
                }
            } else {
                membershipOperation = {
                    operation: "unchanged",
                    reason: "manualMembership"
                };
            }

            syncPlan.entries.push({
                directoryUser: user,
                user: {
                    operation: "update",
                    data: {
                        userId: pangolinUser.userId,
                        email: user.email,
                        name: user.name,
                        username
                    }
                },
                membership: membershipOperation
            });
        }
    }

    // users still in the org through sync/provisioning but gone from the directory
    const directoryUserIds = new Set(
        syncPlan.entries.flatMap((e) =>
            e.user.operation === "update" ? [e.user.data.userId] : []
        )
    );
    // a directory user we couldn't identify may be one of these members,
    // so we can't tell who is really gone
    const unidentifiedUserCount = syncPlan.entries.filter(
        (e) =>
            e.membership.operation === "unchanged" &&
            e.membership.reason === "noMatchingUserIdentifier"
    ).length;
    if (unidentifiedUserCount > 0) {
        logger.warn(
            `Directory sync: IdP ${idpId}, org ${orgId}: ${unidentifiedUserCount} directory user(s) have no identifier at \`${identifierPath}\`, members missing from the directory are not removed this run`
        );
    } else {
        for (const { user, userOrgs: membership } of existingUserOrgs) {
            if (directoryUserIds.has(user.userId)) continue;
            if (membership.isOwner || !membership.autoManaged) continue;

            syncPlan.entries.push({
                directoryUser: null,
                user: { operation: "unchanged", userId: user.userId },
                membership: directorySyncDeletions
                    ? { operation: "remove" }
                    : { operation: "unchanged", reason: "deletionsDisabled" }
            });
        }
    }

    const [org] = await db.select().from(orgs).where(eq(orgs.orgId, orgId));
    if (!org) {
        throw new Error(`Org ${orgId} not found for directory sync`);
    }

    if (dryRun) {
        return syncPlan;
    }

    // the upsert can return an existing row's userId instead of the generated one
    // if a user is synched in multiple orgs, the generated `userId` will be
    // different when creating the same user, but the `username` will be the same
    const userIdsByUsername = new Map<string, string>();

    await db.transaction(async (trx) => {
        // create new users
        // upsert so the same directory user synced into several orgs isn't created twice
        const usersToUpsert = syncPlan.entries.flatMap((e) =>
            e.user.operation === "create" ? [e.user.data] : []
        );
        if (usersToUpsert.length > 0) {
            const upsertedUsers = await trx
                .insert(users)
                .values(usersToUpsert)
                .onConflictDoUpdate({
                    target: [users.idpId, users.username],
                    set: {
                        email: sql`excluded.email`,
                        name: sql`excluded.name`
                    }
                })
                .returning({
                    userId: users.userId,
                    username: users.username
                });

            for (const u of upsertedUsers) {
                userIdsByUsername.set(u.username, u.userId);
            }
        }

        // update existing users by userId
        const usersToUpdate = syncPlan.entries.flatMap((e) =>
            e.user.operation === "update" ? [e.user.data] : []
        );
        await Promise.all(
            usersToUpdate.map((u) =>
                trx
                    .update(users)
                    .set(u)
                    .where(
                        and(eq(users.userId, u.userId), eq(users.idpId, idpId))
                    )
            )
        );

        // create the mapped roles missing from the org ("create missing roles"), once for all users
        const missingRoleNames = syncPlan.entries.flatMap((e) =>
            e.membership.operation === "add" ||
            e.membership.operation === "updateRoles"
                ? e.membership.roles
                      .filter((r) => r.id === null)
                      .map((r) => r.name)
                : []
        );
        const createdRoleIds = new Map(
            (await createRoles(orgId, missingRoleNames, trx)).map((r) => [
                r.name,
                r.roleId
            ])
        );
        const toRoleIds = (syncedRoles: SyncedRole[]) => [
            ...new Set(
                syncedRoles.flatMap((r) => {
                    const id = r.id ?? createdRoleIds.get(r.name);
                    return id === undefined ? [] : [id];
                })
            )
        ];

        // apply memberships sequentially, `assignUserToOrg` and `removeUserFromOrg`
        // read the user's other orgs for billing
        for (const entry of syncPlan.entries) {
            const userId = getEntryUserId(entry, userIdsByUsername);
            if (!userId) continue;

            switch (entry.membership.operation) {
                case "add":
                    await assignUserToOrg(
                        org,
                        { userId, orgId: orgId, autoManaged: true },
                        toRoleIds(entry.membership.roles),
                        trx
                    );
                    break;
                case "updateRoles":
                    // remove previous roles
                    await trx
                        .delete(userOrgRoles)
                        .where(
                            and(
                                eq(userOrgRoles.userId, userId),
                                eq(userOrgRoles.orgId, orgId)
                            )
                        );
                    // add new roles
                    await trx.insert(userOrgRoles).values(
                        toRoleIds(entry.membership.roles).map((roleId) => ({
                            userId,
                            orgId: orgId,
                            roleId
                        }))
                    );
                    break;
                case "remove":
                    await removeUserFromOrg(org, userId, trx);
                    break;
            }
        }

        await trx
            .update(idpOrg)
            .set({ lastSyncedAt: Date.now() })
            .where(and(eq(idpOrg.idpId, idpId), eq(idpOrg.orgId, orgId)));
    });

    for (const entry of syncPlan.entries) {
        if (entry.membership.operation === "unchanged") continue;
        const userId = getEntryUserId(entry, userIdsByUsername);
        if (!userId) continue;

        calculateUserClientsForOrgs(userId).catch((error) => {
            logger.error(
                "Error calculating user clients after directory sync",
                { error }
            );
        });
    }

    return syncPlan;
}

function getEntryUserId(
    entry: UserSyncEntry,
    userIdsByUsername: Map<string, string>
) {
    switch (entry.user.operation) {
        case "create":
            return userIdsByUsername.get(entry.user.data.username);
        case "update":
            return entry.user.data.userId;
        case "unchanged":
            return entry.user.userId;
        case "skip":
            return undefined;
    }
}

async function resolveUserRoles(
    user: IDPDirectoryUser,
    claims: object,
    roleMapping: string | null,
    orgId: string,
    supportsMultiRole: boolean,
    createMissingRoles: boolean
): Promise<SyncedRole[]> {
    if (!user.enabled) return [];

    // org IdPs have a single org, so sync doesn't evaluate an org mapping
    const membership = await resolveOrgMembership({
        claims,
        orgId,
        orgMapping: null,
        roleMapping,
        supportsMultiRole,
        createMissingRoles
    });
    if (!membership.matched) return [];

    return [
        ...membership.roles.map((role) => ({
            id: role.roleId,
            name: role.name
        })),
        ...membership.missingRoleNames.map((name) => ({ id: null, name }))
    ];
}
