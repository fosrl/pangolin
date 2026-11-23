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

import { db, dnsBlockLists, roleDnsBlockLists, Transaction } from "@server/db";
import { and, eq, inArray } from "drizzle-orm";
import { parseDomains } from "@server/lib/dnsBlocklist/parse";
import type { CustomListSnapshot } from "@server/lib/dnsBlocklist/customLists";

export type { CustomListSnapshot };

export async function getCustomListsForRoles(
    orgId: string,
    roleIds: number[]
): Promise<CustomListSnapshot[]> {
    if (roleIds.length === 0) return [];

    const selected = await db
        .select({ dnsBlockListId: roleDnsBlockLists.dnsBlockListId })
        .from(roleDnsBlockLists)
        .where(inArray(roleDnsBlockLists.roleId, roleIds));
    const listIds = [...new Set(selected.map((r) => r.dnsBlockListId))];
    if (listIds.length === 0) return [];

    const lists = await db
        .select({
            dnsBlockListId: dnsBlockLists.dnsBlockListId,
            domains: dnsBlockLists.domains,
            showBlockPage: dnsBlockLists.showBlockPage,
            updatedAt: dnsBlockLists.updatedAt
        })
        .from(dnsBlockLists)
        .where(
            and(
                inArray(dnsBlockLists.dnsBlockListId, listIds),
                eq(dnsBlockLists.orgId, orgId)
            )
        );

    return lists.map((list) => ({
        key: `${list.dnsBlockListId}@${list.updatedAt}${list.showBlockPage ? ":page" : ""}`,
        domains: parseDomains(list.domains),
        showBlockPage: list.showBlockPage
    }));
}

export async function getRoleListIds(roleId: number): Promise<number[]> {
    const rows = await db
        .select({ dnsBlockListId: roleDnsBlockLists.dnsBlockListId })
        .from(roleDnsBlockLists)
        .where(eq(roleDnsBlockLists.roleId, roleId));
    return rows.map((r) => r.dnsBlockListId);
}

export async function allListsBelongToOrg(
    orgId: string,
    listIds: number[]
): Promise<boolean> {
    if (listIds.length === 0) return true;
    const found = await db
        .select({ id: dnsBlockLists.dnsBlockListId })
        .from(dnsBlockLists)
        .where(
            and(
                inArray(dnsBlockLists.dnsBlockListId, listIds),
                eq(dnsBlockLists.orgId, orgId)
            )
        );
    return found.length === listIds.length;
}

export async function setRoleListIds(
    trx: Transaction,
    roleId: number,
    listIds: number[]
): Promise<void> {
    await trx
        .delete(roleDnsBlockLists)
        .where(eq(roleDnsBlockLists.roleId, roleId));
    if (listIds.length > 0) {
        await trx
            .insert(roleDnsBlockLists)
            .values(
                listIds.map((dnsBlockListId) => ({ roleId, dnsBlockListId }))
            );
    }
}
