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
    roles,
    userOrgRoles,
    userOrgs,
    users,
    type Role
} from "@server/db";

import { durationToMs } from "@app/lib/durationToMs";
import {
    parseDirectorySyncRoleMapping,
    type DirectorySyncRoleMappingConfig
} from "@app/lib/idpDirectorySyncRoleMapping";
import { generateId } from "@server/auth/sessions/app";
import { calculateUserClientsForOrgs } from "@server/lib/calculateUserClientsForOrgs";
import { assignUserToOrg, removeUserFromOrg } from "@server/lib/userOrg";
import logger from "@server/logger";
import { UserType } from "@server/types/UserTypes";
import { and, eq, inArray, sql, type InferInsertModel } from "drizzle-orm";
import { AzureDirectorySyncProvider } from "./azure";
import { GoogleDirectorySyncProvider } from "./google";
import type {
    DirectoryFetchContext,
    DirectorySyncProvider,
    DirectoryUser
} from "./types";

type InsertUser = InferInsertModel<typeof users>;
type UpdateUser = Pick<
    InsertUser,
    "username" | "email" | "name" | "userId" | "externalUserId"
>;

type SyncedRole = { id: number; name: string };

/** What happens to one user: their Pangolin profile and their membership in `orgId` are decided separately. */
export type UserSyncEntry = {
    /** `null` when the user is in Pangolin but gone from the directory. */
    directoryUser: DirectoryUser | null;
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
              reason: "noMatchingRoles" | "manualMembership" | "owner";
          };
};

// the planned changes for one idpOrg, computed first and
// applied in a single transaction at the end
export type IdpOrgSyncPlan = {
    idpId: number;
    orgId: string;
    entries: UserSyncEntry[];
};

// Track if the offline checker interval is running
let directorySyncInterval: NodeJS.Timeout | null = null;
const DIRECTORY_SYNC_RUN_INTERVAL = durationToMs(5, "minutes");

export async function runIdpDirectorySync(dryRun: boolean = false) {
    // to sync idps, we need
    const idpsToSync = await db
        .select()
        .from(idp)
        .innerJoin(idpOidcConfig, eq(idpOidcConfig.idpId, idp.idpId))
        .innerJoin(idpOrg, and(eq(idpOrg.idpId, idp.idpId)))
        .where(
            and(
                inArray(idpOidcConfig.variant, ["azure", "google"]),
                eq(idp.directorySyncEnabled, true),
                eq(idp.autoProvision, false)
            )
        );

    const providers: Partial<
        Record<(typeof idpsToSync)[number]["idpOidcConfig"]["variant"], DirectorySyncProvider>
    > = {
        azure: new AzureDirectorySyncProvider(),
        google: new GoogleDirectorySyncProvider()
    };
    const fetchPromises = idpsToSync
        .map(({ idp, idpOidcConfig, idpOrg }) => {
            const provider = providers[idpOidcConfig.variant];
            if (!provider) {
                return null;
            }
            const ctx = {
                idpId: idp.idpId,
                orgId: idpOrg.orgId,
                identifierPath: idpOidcConfig.identifierPath,
                roleMapping: parseDirectorySyncRoleMapping(
                    idpOrg.syncRoleMapping
                )
            } satisfies DirectoryFetchContext;
            return syncIdp(provider, ctx, dryRun);
        })
        .filter((p) => p != null);

    return await Promise.allSettled(fetchPromises);
}

async function syncIdp(
    provider: DirectorySyncProvider,
    ctx: DirectoryFetchContext,
    dryRun: boolean
) {
    // Note
    // username is unique only within IDPs or within internal ?
    // we can have two users with the same username, one in an IDP and another `internal`
    // Which means: a user can have two accounts w/ the same username (email in azure for ex)
    // and each account can have different roles within the same Org

    // ...
    // Later: we might need to change the `identifierPath` for azure/google idps to `sub` (for ex)
    // which is an immutable external ID that survives username/email changes
    // but first we need to check if that ID is the same returned by Entra/google workspace
    // if it's not the same ID, we might kepp `idpSyncUser` otherwise, we may need to see how
    // we can maybe get rid of that table (or just not need it anymore)

    // ...
    // For global idps, we will rely on org policies
    // we will not store a default mapping for directory sync
    // if the admin wants to add the synched IDP to an org, they can create an org policy
    // & set the role mapping to `automatic` (for ex)
    // for global idps, if there is not an org policy for a specific org, the user is not added to that org

    // 1. Fetch
    const result = await provider.fetch(ctx);

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
    roleIds = resolveRoles(user, ctx.roleMapping)   // fixed / group mapping / automatic
                                                    // [] = user doesn't qualify for this org
    if user is disabled: roleIds = []

    pangolinUser = match by externalUserId, then username
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

    const existingUsers = await db
        .select()
        .from(users)
        .where(eq(users.idpId, ctx.idpId));

    const existingUserOrgs = await db
        .select()
        .from(users)
        .innerJoin(userOrgs, eq(userOrgs.userId, users.userId))
        .where(and(eq(users.idpId, ctx.idpId), eq(userOrgs.orgId, ctx.orgId)));

    const existingPangolinUsers = new Map<
        string,
        (typeof existingUsers)[number]
    >();
    for (const u of existingUsers) {
        // rely on the external ID in the tenant if it exists, else use the username
        if (u.externalUserId) {
            existingPangolinUsers.set(u.externalUserId, u);
        } else {
            existingPangolinUsers.set(u.username, u);
        }
    }

    const existingPangolinUserOrgs = new Map<
        string,
        (typeof existingUserOrgs)[number]
    >();
    for (const u of existingUserOrgs) {
        existingPangolinUserOrgs.set(u.user.userId, u);
    }

    const syncPlan: IdpOrgSyncPlan = {
        idpId: ctx.idpId,
        orgId: ctx.orgId,
        entries: []
    };

    for (const user of result.users) {
        const roles = await resolveUserRoles(
            user,
            ctx.roleMapping,
            ctx.orgId,
            dryRun
        );

        const pangolinUser =
            existingPangolinUsers.get(user.externalId) ??
            existingPangolinUsers.get(user.username);

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
                        username: user.username,
                        externalUserId: user.externalId,
                        email: user.email,
                        name: user.name,
                        type: UserType.OIDC,
                        idpId: ctx.idpId,
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
            } else if (
                membership.userOrgs.autoProvisioned ||
                membership.userOrgs.directorySynched
            ) {
                if (membership.userOrgs.isOwner) {
                    membershipOperation = {
                        operation: "unchanged",
                        reason: "owner"
                    };
                } else if (roles.length === 0) {
                    membershipOperation = { operation: "remove" };
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
                        username: user.username,
                        email: user.email,
                        name: user.name,
                        externalUserId: user.externalId
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
    for (const { user, userOrgs: membership } of existingUserOrgs) {
        if (directoryUserIds.has(user.userId)) continue;
        if (
            membership.isOwner ||
            (!membership.autoProvisioned && !membership.directorySynched)
        )
            continue;

        syncPlan.entries.push({
            directoryUser: null,
            user: { operation: "unchanged", userId: user.userId },
            membership: { operation: "remove" }
        });
    }

    const [org] = await db.select().from(orgs).where(eq(orgs.orgId, ctx.orgId));
    if (!org) {
        throw new Error(`Org ${ctx.orgId} not found for directory sync`);
    }

    if (dryRun) {
        return syncPlan;
    }

    // the upsert can return an existing row's userId instead of the generated one
    // if a user is synched in multiple orgs, the generated `userId` will be
    // different when creating the same user, but the `externalId` will be the same
    const userIdsByExternalId = new Map<string, string>();

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
                    target: [users.idpId, users.externalUserId],
                    set: {
                        username: sql`excluded.username`,
                        email: sql`excluded.email`,
                        name: sql`excluded.name`
                    }
                })
                .returning({
                    userId: users.userId,
                    externalUserId: users.externalUserId
                });

            for (const u of upsertedUsers) {
                userIdsByExternalId.set(u.externalUserId!, u.userId);
            }
        }

        // update existing users by userId, this also backfills `externalUserId`
        // for users previously matched by username
        const usersToUpdate = syncPlan.entries.flatMap((e) =>
            e.user.operation === "update" ? [e.user.data] : []
        );
        await Promise.all(
            usersToUpdate.map((u) =>
                trx
                    .update(users)
                    .set(u)
                    .where(
                        and(
                            eq(users.userId, u.userId),
                            eq(users.idpId, ctx.idpId)
                        )
                    )
            )
        );

        // apply memberships sequentially, `assignUserToOrg` and `removeUserFromOrg`
        // read the user's other orgs for billing
        for (const entry of syncPlan.entries) {
            const userId = getEntryUserId(entry, userIdsByExternalId);
            if (!userId) continue;

            switch (entry.membership.operation) {
                case "add":
                    await assignUserToOrg(
                        org,
                        { userId, orgId: ctx.orgId, directorySynched: true },
                        entry.membership.roles.map((r) => r.id),
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
                                eq(userOrgRoles.orgId, ctx.orgId)
                            )
                        );
                    // add new roles
                    await trx.insert(userOrgRoles).values(
                        entry.membership.roles.map((r) => ({
                            userId,
                            orgId: ctx.orgId,
                            roleId: r.id
                        }))
                    );
                    break;
                case "remove":
                    await removeUserFromOrg(org, userId, trx);
                    break;
            }
        }
    });

    for (const entry of syncPlan.entries) {
        if (entry.membership.operation === "unchanged") continue;
        const userId = getEntryUserId(entry, userIdsByExternalId);
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
    userIdsByExternalId: Map<string, string>
) {
    switch (entry.user.operation) {
        case "create":
            return userIdsByExternalId.get(entry.user.data.externalUserId!);
        case "update":
            return entry.user.data.userId;
        case "unchanged":
            return entry.user.userId;
        case "skip":
            return undefined;
    }
}

async function resolveUserRoles(
    user: DirectoryUser,
    roleMapping: DirectorySyncRoleMappingConfig,
    orgId: string,
    dryRun: boolean
): Promise<SyncedRole[]> {
    if (!user.enabled) return [];

    let matchedRoles: Role[] = [];

    switch (roleMapping.mode) {
        case "fixedRoles": {
            if (roleMapping.fixedRoleNames.length > 0) {
                matchedRoles = await db
                    .select()
                    .from(roles)
                    .where(
                        and(
                            eq(roles.orgId, orgId),
                            inArray(roles.name, roleMapping.fixedRoleNames)
                        )
                    );
            }
            break;
        }
        case "groupMapping": {
            const roleNames: string[] = [];
            const groupMapping = new Map(
                roleMapping.groupRules.map((rule) => [
                    rule.group,
                    rule.roleNames
                ])
            );

            for (const group of user.groups) {
                let roles: string[] = [];
                if (group.displayName) {
                    roles =
                        groupMapping.get(group.displayName) ??
                        groupMapping.get(group.id) ??
                        [];
                } else {
                    roles =
                        groupMapping.get(group.displayName ?? group.id) ?? [];
                }
                roleNames.push(...roles);
            }

            if (roleNames.length > 0) {
                matchedRoles = await db
                    .select()
                    .from(roles)
                    .where(
                        and(
                            eq(roles.orgId, orgId),
                            inArray(roles.name, roleNames)
                        )
                    );
            }
            break;
        }
        case "automatic":
            const roleNames = user.groups
                .map((g) => g.displayName)
                .filter((name) => name !== undefined && name !== null);

            if (roleNames.length > 0) {
                matchedRoles = await db
                    .select()
                    .from(roles)
                    .where(
                        and(
                            eq(roles.orgId, orgId),
                            inArray(roles.name, roleNames)
                        )
                    );
            }

            if (roleMapping.createMissingRoles) {
                const missingRoles = new Set(roleNames).difference(
                    new Set(matchedRoles.map((r) => r.name))
                );

                if (missingRoles.size === 0) {
                    break;
                }

                if (dryRun) {
                    // the roles would be created when applying the plan, they don't have an id yet
                    return [
                        ...matchedRoles.map((role) => ({
                            id: role.roleId,
                            name: role.name
                        })),
                        ...[...missingRoles].map((name) => ({ id: -1, name }))
                    ];
                }

                const result = await db
                    .insert(roles)
                    .values(
                        [...missingRoles].map((role) => ({
                            name: role,
                            orgId: orgId
                        }))
                    )
                    .returning();

                matchedRoles.push(...result);
            }

            break;
    }

    return matchedRoles.map((role) => ({ id: role.roleId, name: role.name }));
}
