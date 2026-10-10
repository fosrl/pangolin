// QUICK & DIRTY: one-shot Entra ID -> Pangolin user sync.
// Full snapshot only (no delta), creates/updates users and memberships,
// never removes anything (see DIRECTORY_SYNC_PLAN.md "Deprovisioning").
// Org/role assignment comes from an explicit group -> (org, role) mapping,
// NOT the login JMESPath mappings (Graph data != ID token claims).

import { db, Org } from "@server/db";
import {
    idp,
    idpOidcConfig,
    idpOrg,
    orgs,
    roles,
    userOrgRoles,
    userOrgs,
    users
} from "@server/db";
import { and, eq, inArray } from "drizzle-orm";
import config from "@server/lib/config";
import logger from "@server/logger";
import { decrypt } from "@server/lib/crypto";
import { generateId } from "@server/auth/sessions/app";
import { UserType } from "@server/types/UserTypes";
import { build } from "@server/build";
import { LimitId } from "@server/lib/billing";
import { usageService } from "@server/lib/billing/usageService";
import { calculateUserClientsForOrgs } from "@server/lib/calculateUserClientsForOrgs";
import { isLicensedOrSubscribed } from "#dynamic/lib/isLicencedOrSubscribed";
import { tierMatrix } from "@server/lib/billing/tierMatrix";
import { assignUserToOrg } from "@server/lib/userOrg";

const GRAPH = "https://graph.microsoft.com/v1.0";

type GraphUser = {
    id: string;
    displayName: string | null;
    mail: string | null;
    userPrincipalName: string | null;
    accountEnabled: boolean | null;
};

// TODO: move to an `idpGroupMapping` table (idpId, externalGroupId, orgId, roleId)
export type GroupMapping = {
    groupId: string; // Entra group object ID
    orgId: string;
    roleName: string;
};

type SyncReport = {
    fetchedUsers: number;
    fetchedGroups: number;
    missingRoles: string[];
    created: number;
    updated: number;
    skippedDisabled: number;
    skippedNoMatch: number;
    requests: number;
};

async function getAppToken(
    tenantId: string,
    clientId: string,
    clientSecret: string
): Promise<string> {
    const res = await fetch(
        `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`,
        {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: new URLSearchParams({
                grant_type: "client_credentials",
                client_id: clientId,
                client_secret: clientSecret,
                scope: "https://graph.microsoft.com/.default"
            })
        }
    );
    const body = await res.json();
    if (!res.ok) {
        throw new Error(
            `Entra token request failed (${res.status}): ${body.error_description ?? body.error}`
        );
    }
    return body.access_token;
}

async function graphGetAll<T>(
    token: string,
    url: string,
    report: SyncReport
): Promise<T[]> {
    const items: T[] = [];
    let next: string | undefined = url;
    while (next) {
        report.requests++;
        const res: Response = await fetch(next, {
            headers: { Authorization: `Bearer ${token}` }
        });
        if (res.status === 429 || res.status === 503) {
            const retryAfter = Number(res.headers.get("Retry-After") ?? 5);
            logger.warn(`Graph throttled, retrying in ${retryAfter}s`, {
                url: next
            });
            await new Promise((r) => setTimeout(r, retryAfter * 1000));
            continue;
        }
        const body: any = await res.json();
        if (!res.ok) {
            throw new Error(
                `Graph request failed (${res.status}) ${next}: ${body.error?.code} ${body.error?.message}`
            );
        }
        items.push(...body.value);
        next = body["@odata.nextLink"];
    }
    return items;
}

// Graph field that yields the same `username` login computes from the ID token.
const IDENTIFIER_FROM_GRAPH: Record<string, (u: GraphUser) => string | null> = {
    oid: (u) => u.id,
    preferred_username: (u) => u.userPrincipalName,
    upn: (u) => u.userPrincipalName
};

export async function syncAzureDirectory(
    idpId: number,
    groupMappings: GroupMapping[]
): Promise<SyncReport> {
    const report: SyncReport = {
        fetchedUsers: 0,
        fetchedGroups: 0,
        missingRoles: [],
        created: 0,
        updated: 0,
        skippedDisabled: 0,
        skippedNoMatch: 0,
        requests: 0
    };

    const [existingIdp] = await db
        .select()
        .from(idp)
        .innerJoin(idpOidcConfig, eq(idpOidcConfig.idpId, idp.idpId))
        .where(and(eq(idp.type, "oidc"), eq(idp.idpId, idpId)));

    if (!existingIdp) throw new Error(`IdP ${idpId} not found`);
    if (existingIdp.idpOidcConfig.variant !== "azure") {
        throw new Error(`IdP ${idpId} is not an azure IdP`);
    }
    if (existingIdp.idp.autoProvision) {
        throw new Error(
            `IdP ${idpId} has autoProvision enabled, which is exclusive with directory sync`
        );
    }
    if (!existingIdp.idp.directorySyncEnabled) {
        logger.warn(`IdP ${idpId} has directorySyncEnabled=false, syncing anyway`);
    }

    const identifierPath = existingIdp.idpOidcConfig.identifierPath;
    const getIdentifier = IDENTIFIER_FROM_GRAPH[identifierPath];
    if (!getIdentifier) {
        // e.g. "sub": Entra's sub is per-app and not exposed by Graph
        throw new Error(
            `identifierPath "${identifierPath}" can't be resolved from Graph; use one of: ${Object.keys(IDENTIFIER_FROM_GRAPH).join(", ")}`
        );
    }

    const tenantId = existingIdp.idpOidcConfig.authUrl.match(
        /login\.microsoftonline\.com\/([^/]+)\/oauth2/
    )?.[1];
    if (!tenantId) throw new Error("Could not parse tenant ID from authUrl");

    const key = config.getRawConfig().server.secret!;
    const clientId = decrypt(existingIdp.idpOidcConfig.clientId, key);
    const clientSecret = decrypt(existingIdp.idpOidcConfig.clientSecret, key);

    // ---- resolve mappings to (org, roleId) ----
    let allowedOrgs: Org[];
    if (build === "saas") {
        const idpOrgs = await db
            .select()
            .from(idpOrg)
            .where(eq(idpOrg.idpId, idpId))
            .innerJoin(orgs, eq(orgs.orgId, idpOrg.orgId));
        allowedOrgs = idpOrgs.map((o) => o.orgs);
    } else {
        allowedOrgs = await db.select().from(orgs);
    }

    const mappedOrgIds = [...new Set(groupMappings.map((m) => m.orgId))];
    const orgRoles = mappedOrgIds.length
        ? await db.select().from(roles).where(inArray(roles.orgId, mappedOrgIds))
        : [];

    // groupId -> [{ orgId, roleId }]
    const grantsByGroup = new Map<string, { orgId: string; roleId: number }[]>();
    for (const m of groupMappings) {
        if (!allowedOrgs.some((o) => o.orgId === m.orgId)) {
            logger.warn(`Org ${m.orgId} is not available to IdP ${idpId}, ignoring mapping`, m);
            continue;
        }
        const role = orgRoles.find(
            (r) => r.orgId === m.orgId && r.name === m.roleName
        );
        if (!role) {
            report.missingRoles.push(`${m.orgId}/${m.roleName}`);
            continue;
        }
        const list = grantsByGroup.get(m.groupId) ?? [];
        list.push({ orgId: m.orgId, roleId: role.roleId });
        grantsByGroup.set(m.groupId, list);
    }

    const multiRoleByOrg = new Map<string, boolean>();
    for (const orgId of mappedOrgIds) {
        multiRoleByOrg.set(
            orgId,
            await isLicensedOrSubscribed(orgId, tierMatrix.fullRbac)
        );
    }

    // ---- fetch directory snapshot (only members of mapped groups) ----
    const token = await getAppToken(tenantId, clientId, clientSecret);

    const graphUsers = await graphGetAll<GraphUser>(
        token,
        `${GRAPH}/users?$select=id,displayName,mail,userPrincipalName,accountEnabled&$top=999`,
        report
    );
    report.fetchedUsers = graphUsers.length;

    const groupsByUser = new Map<string, string[]>();
    for (const groupId of grantsByGroup.keys()) {
        const members = await graphGetAll<{ id: string }>(
            token,
            `${GRAPH}/groups/${groupId}/transitiveMembers/microsoft.graph.user?$select=id&$top=999`,
            report
        );
        report.fetchedGroups++;
        for (const m of members) {
            const list = groupsByUser.get(m.id) ?? [];
            list.push(groupId);
            groupsByUser.set(m.id, list);
        }
    }

    logger.info(
        `Fetched ${graphUsers.length} users and ${report.fetchedGroups} mapped groups from Entra (${report.requests} requests)`
    );

    const touchedOrgIds = new Set<string>();
    const touchedUserIds: string[] = [];

    for (const gu of graphUsers) {
        if (gu.accountEnabled === false) {
            report.skippedDisabled++;
            continue;
        }

        const userIdentifier = getIdentifier(gu)?.toLowerCase();
        if (!userIdentifier) {
            logger.warn(`No identifier for Entra user ${gu.id}, skipping`);
            continue;
        }
        const email = gu.mail?.toLowerCase() ?? null;
        const name = gu.displayName ?? null;

        // orgId -> roleIds, in mapping order
        const rolesByOrg = new Map<string, number[]>();
        for (const groupId of groupsByUser.get(gu.id) ?? []) {
            for (const g of grantsByGroup.get(groupId) ?? []) {
                const list = rolesByOrg.get(g.orgId) ?? [];
                if (!list.includes(g.roleId)) list.push(g.roleId);
                rolesByOrg.set(g.orgId, list);
            }
        }
        for (const [orgId, roleIds] of rolesByOrg) {
            if (!multiRoleByOrg.get(orgId)) rolesByOrg.set(orgId, roleIds.slice(0, 1));
        }

        const [existingUser] = await db
            .select()
            .from(users)
            .where(
                and(
                    eq(users.username, userIdentifier),
                    eq(users.idpId, idpId)
                )
            );

        if (!rolesByOrg.size && !existingUser) {
            // not in any mapped group; don't create orphans
            report.skippedNoMatch++;
            continue;
        }

        await db.transaction(async (trx) => {
            let userId = existingUser?.userId;
            if (!existingUser) {
                userId = generateId(15);
                await trx.insert(users).values({
                    userId,
                    username: userIdentifier,
                    email,
                    name,
                    type: UserType.OIDC,
                    idpId,
                    emailVerified: true,
                    dateCreated: new Date().toISOString()
                });
                report.created++;
            } else {
                await trx
                    .update(users)
                    .set({ email, name })
                    .where(eq(users.userId, userId!));
                report.updated++;
            }

            const currentUserOrgs = await trx
                .select()
                .from(userOrgs)
                .where(eq(userOrgs.userId, userId!));

            for (const [orgId, roleIds] of rolesByOrg) {
                const current = currentUserOrgs.find((o) => o.orgId === orgId);

                if (!current) {
                    const org = allowedOrgs.find((o) => o.orgId === orgId)!;
                    await assignUserToOrg(
                        org,
                        { orgId, userId: userId!, autoProvisioned: true },
                        roleIds,
                        trx
                    );
                    touchedOrgIds.add(orgId);
                } else if (current.autoProvisioned) {
                    // re-sync roles 1:1 on auto-provisioned memberships only
                    await trx
                        .delete(userOrgRoles)
                        .where(
                            and(
                                eq(userOrgRoles.userId, userId!),
                                eq(userOrgRoles.orgId, orgId)
                            )
                        );
                    await trx.insert(userOrgRoles).values(
                        roleIds.map((roleId) => ({
                            userId: userId!,
                            orgId,
                            roleId
                        }))
                    );
                }
            }

            // NOTE: no removal of stale auto-provisioned orgs — deprovisioning not approved
            touchedUserIds.push(userId!);
        });
    }

    for (const orgId of touchedOrgIds) {
        const count = await db
            .select()
            .from(userOrgs)
            .where(eq(userOrgs.orgId, orgId));
        await usageService.updateCount(orgId, LimitId.USERS, count.length);
    }

    for (const userId of touchedUserIds) {
        await calculateUserClientsForOrgs(userId).catch((err) =>
            logger.error("Error calculating user clients after sync", {
                userId,
                error: err
            })
        );
    }

    logger.info("Azure directory sync done", { idpId, ...report });
    return report;
}
