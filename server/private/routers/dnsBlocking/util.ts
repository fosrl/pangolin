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

import { db, roleDnsBlockLists } from "@server/db";
import { eq } from "drizzle-orm";

/** Roles that currently reference a custom list. */
export async function getRoleIdsUsingList(listId: number): Promise<number[]> {
    const rows = await db
        .select({ roleId: roleDnsBlockLists.roleId })
        .from(roleDnsBlockLists)
        .where(eq(roleDnsBlockLists.dnsBlockListId, listId));
    return rows.map((r) => r.roleId);
}
