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
import { db, idp, idpOidcConfig, idpOrg, users } from "@server/db";

import { durationToMs } from "@app/lib/durationToMs";
import { parseDirectorySyncRoleMapping } from "@app/lib/idpDirectorySyncRoleMapping";
import { generateId } from "@server/auth/sessions/app";
import { UserType } from "@server/types/UserTypes";
import { and, eq, inArray, type InferInsertModel } from "drizzle-orm";
import { AzureDirectorySyncProvider } from "./azure";
import type { DirectoryFetchContext, DirectorySyncProvider } from "./types";

type InsertUser = InferInsertModel<typeof users>;
type UpdateUser = Pick<InsertUser, "username" | "email" | "name" | "userId">;

// Track if the offline checker interval is running
let directorySyncInterval: NodeJS.Timeout | null = null;
const DIRECTORY_SYNC_RUN_INTERVAL = durationToMs(5, "minutes");

export async function runIdpDirectorySync() {
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

    const azureSyncProvider = new AzureDirectorySyncProvider();
    const fetchPromises = idpsToSync
        .map(({ idp, idpOidcConfig, idpOrg }) => {
            if (idpOidcConfig.variant === "azure") {
                return syncIdp(azureSyncProvider, {
                    idpId: idp.idpId,
                    orgId: idpOrg.orgId,
                    identifierPath: idpOidcConfig.identifierPath,
                    roleMapping: parseDirectorySyncRoleMapping(
                        idpOrg.directoryRoleMapping
                    )
                });
            }
            return null;
        })
        .filter((p) => p != null);

    await Promise.allSettled(fetchPromises);
}

async function syncIdp(
    provider: DirectorySyncProvider,
    ctx: DirectoryFetchContext
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

    const existingUsers = await db
        .select()
        .from(users)
        .where(eq(users.idpId, ctx.idpId));

    const map = new Map<string, (typeof existingUsers)[number]>();
    for (const u of existingUsers) {
        map.set(u.username, u);
    }

    const usersToInsert: InsertUser[] = [];
    const usersToUpdate: UpdateUser[] = [];
    const deletedUserIds: string[] = [];

    for (const user of result.users) {
        const existing = map.get(user.username);
        if (existing) {
            usersToUpdate.push({
                username: user.username,
                email: user.email,
                name: user.name,
                userId: existing.userId
            });
        } else {
            const userId = generateId(15);
            usersToInsert.push({
                userId,
                username: user.username,
                email: user.email,
                name: user.name,
                type: UserType.OIDC,
                idpId: ctx.idpId,
                emailVerified: true, // OIDC users are always verified
                dateCreated: new Date().toISOString()
            });
        }
    }

    await db.transaction(async (trx) => {
        await trx.insert(users).values(usersToInsert);

        await Promise.all(
            usersToUpdate.map((u) =>
                trx.update(users).set(u).where(eq(users.userId, u.userId))
            )
        );
    });

    // ...
    // console.dir(
    //     {
    //         result
    //     },
    //     { depth: null }
    // );
    // await db.select().from(idp)

    return result;
}
