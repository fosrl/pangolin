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
    clientOrgRoles,
    db,
    roleClientSettings,
    RoleClientSettings,
    userOrgRoles
} from "@server/db";
import type { ClientSettings } from "@server/lib/clientSettings";
import { isLicensedOrSubscribed } from "#private/lib/isLicencedOrSubscribed";
import { tierMatrix, TierFeature } from "@server/lib/billing/tierMatrix";
import { and, asc, eq } from "drizzle-orm";

export function parseMatchDomains(value: string | null): string[] | undefined {
    if (!value) return undefined;
    try {
        const parsed = JSON.parse(value);
        return Array.isArray(parsed) && parsed.length > 0 ? parsed : undefined;
    } catch {
        return undefined;
    }
}

function toClientSettings(row: RoleClientSettings): ClientSettings {
    const settings: ClientSettings = {};

    if (row.overrideDns !== null) settings.overrideDns = row.overrideDns;
    if (row.mtu !== null) settings.mtu = row.mtu;
    if (row.tunnelDns !== null) settings.tunnelDns = row.tunnelDns;
    if (row.primaryDns) settings.primaryDns = row.primaryDns;
    if (row.secondaryDns) settings.secondaryDns = row.secondaryDns;
    if (row.exitNodeTakesPrecedence !== null) {
        settings.exitNodeTakesPrecedence = row.exitNodeTakesPrecedence;
    }
    if (row.preferLocalRoutes !== null) {
        settings.preferLocalRoutes = row.preferLocalRoutes;
    }

    const matchDomains = parseMatchDomains(row.matchDomains);
    if (matchDomains) settings.matchDomains = matchDomains;

    if (row.exitNodeSiteResourceId !== null) {
        settings.exitNodeSiteResourceId = row.exitNodeSiteResourceId;
        settings.exitNodeLocked = row.exitNodeLocked;
    }

    return settings;
}

function isClientSettingsLicensed(orgId: string): Promise<boolean> {
    return isLicensedOrSubscribed(
        orgId,
        tierMatrix[TierFeature.ClientSettings]
    );
}

// Resolves the settings a user gets in the org. Settings are never merged
// across roles: a user with several enabled roles gets exactly one of them,
// the one with the lowest roleId, so the result is deterministic.
export async function getClientSettingsForUser(
    orgId: string,
    userId: string
): Promise<ClientSettings | undefined> {
    if (!(await isClientSettingsLicensed(orgId))) {
        return undefined;
    }

    const [row] = await db
        .select({ settings: roleClientSettings })
        .from(userOrgRoles)
        .innerJoin(
            roleClientSettings,
            eq(userOrgRoles.roleId, roleClientSettings.roleId)
        )
        .where(
            and(
                eq(userOrgRoles.orgId, orgId),
                eq(userOrgRoles.userId, userId),
                eq(roleClientSettings.enabled, true)
            )
        )
        .orderBy(asc(userOrgRoles.roleId))
        .limit(1);

    return row ? toClientSettings(row.settings) : undefined;
}

// Resolves the settings a client gets. A user device gets its user's settings;
// a machine client gets the settings of the roles assigned to it directly
// (clientOrgRoles), picked the same way as for users: the enabled role with
// the lowest roleId.
export async function getClientSettingsForClient(client: {
    clientId: number;
    orgId: string;
    userId: string | null;
}): Promise<ClientSettings | undefined> {
    if (client.userId) {
        return getClientSettingsForUser(client.orgId, client.userId);
    }

    if (!(await isClientSettingsLicensed(client.orgId))) {
        return undefined;
    }

    const [row] = await db
        .select({ settings: roleClientSettings })
        .from(clientOrgRoles)
        .innerJoin(
            roleClientSettings,
            eq(clientOrgRoles.roleId, roleClientSettings.roleId)
        )
        .where(
            and(
                eq(clientOrgRoles.orgId, client.orgId),
                eq(clientOrgRoles.clientId, client.clientId),
                eq(roleClientSettings.enabled, true)
            )
        )
        .orderBy(asc(clientOrgRoles.roleId))
        .limit(1);

    return row ? toClientSettings(row.settings) : undefined;
}
