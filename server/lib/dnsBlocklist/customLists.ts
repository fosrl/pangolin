import type { Transaction } from "@server/db";

// Org-defined block lists are an enterprise feature. This is the OSS version of
// server/private/lib/dnsBlocklist/customLists.ts, where there are none.

export type CustomListSnapshot = {
    /** Changes whenever the list's domains change. */
    key: string;
    domains: ReadonlySet<string>;
    /** Whether its domains get the block page instead of a failed lookup. */
    showBlockPage: boolean;
};

/** The custom lists selected by any of these roles. */
export async function getCustomListsForRoles(
    orgId: string,
    roleIds: number[]
): Promise<CustomListSnapshot[]> {
    return [];
}

/** The custom list ids selected on a role. */
export async function getRoleListIds(roleId: number): Promise<number[]> {
    return [];
}

/** Whether every id is a custom list that belongs to the org. */
export async function allListsBelongToOrg(
    orgId: string,
    listIds: number[]
): Promise<boolean> {
    return listIds.length === 0;
}

/** Replaces the custom lists selected on a role. */
export async function setRoleListIds(
    trx: Transaction,
    roleId: number,
    listIds: number[]
): Promise<void> {
    return;
}
