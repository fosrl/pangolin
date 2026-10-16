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

// Microsoft Entra ID directory provider (Microsoft Graph, app-only auth).
//
// Required application permissions (with admin consent): User.Read.All, GroupMember.Read.All.
//
// Full fetch: /users/delta + /groups/delta?$select=displayName,members without a token, which
// lists everything and returns delta links for next time. Nested memberships are resolved in
// memory from the direct members.
//
// Incremental fetch: replay both delta links. Group deltas only report direct member changes,
// so every user touched by a change is re-read (/users/{id} + /transitiveMemberOf) to get their
// full current state. Cases that can't be resolved cheaply fall back to a full fetch.

import config from "@server/lib/config";
import logger from "@server/logger";
import { decrypt } from "@server/lib/crypto";
import {
    DirectoryCursorExpiredError,
    DirectoryFetchContext,
    DirectoryFetchResult,
    DirectoryGroup,
    DirectorySyncProvider,
    DirectoryUser
} from "./types";

const GRAPH = "https://graph.microsoft.com/v1.0";
const USER_SELECT = "id,displayName,mail,userPrincipalName,accountEnabled";

/** Above this many touched users, an incremental run is more expensive than a full one. */
const MAX_INCREMENTAL_AFFECTED_USERS = 500;
/** Longest Retry-After we sleep through in-process before failing the run. */
const MAX_RETRY_AFTER_SECONDS = 120;
const MAX_THROTTLE_RETRIES = 5;

type GraphUser = {
    id: string;
    displayName?: string | null;
    mail?: string | null;
    userPrincipalName?: string | null;
    accountEnabled?: boolean | null;
    "@removed"?: { reason: string };
};

type GraphDirectoryObjectRef = {
    "@odata.type"?: string;
    id: string;
    "@removed"?: { reason: string };
};

type GraphGroup = {
    id: string;
    displayName?: string | null;
    "members@delta"?: GraphDirectoryObjectRef[];
    "@removed"?: { reason: string };
};

type AzureCursor = {
    usersDeltaLink: string;
    groupsDeltaLink: string;
};

type GraphPage<T> = {
    value: T[];
    "@odata.nextLink"?: string;
    "@odata.deltaLink"?: string;
};

// Graph field that yields the same `username` login computes from the ID token.
// `sub` is per-app in Entra and not exposed by Graph, so it can't be synced.
const IDENTIFIER_FROM_GRAPH: Record<string, (u: GraphUser) => string | null> = {
    oid: (u) => u.id,
    preferred_username: (u) => u.userPrincipalName ?? null,
    upn: (u) => u.userPrincipalName ?? null,
    email: (u) => u.mail ?? null
};

const tokenCache = new Map<string, { token: string; expiresAt: number }>();

class GraphClient {
    constructor(
        private readonly getToken: () => Promise<string>,
        private readonly onRequest: () => void
    ) {}

    /** GET a single Graph URL, sleeping through short throttling. Returns null on 404. */
    async get<T>(url: string): Promise<T | null> {
        for (let attempt = 0; ; attempt++) {
            this.onRequest();
            const res = await fetch(url, {
                headers: { Authorization: `Bearer ${await this.getToken()}` }
            });

            if (res.status === 429 || res.status === 503) {
                const retryAfter = Number(res.headers.get("Retry-After") ?? 5);
                if (
                    attempt >= MAX_THROTTLE_RETRIES ||
                    retryAfter > MAX_RETRY_AFTER_SECONDS
                ) {
                    throw new Error(
                        `Graph throttled (${res.status}, Retry-After ${retryAfter}s): ${url}`
                    );
                }
                logger.warn(`Graph throttled, retrying in ${retryAfter}s`, {
                    url
                });
                await new Promise((r) => setTimeout(r, retryAfter * 1000));
                continue;
            }

            if (res.status === 404) return null;

            const body: any = await res.json().catch(() => ({}));

            if (
                res.status === 410 ||
                body.error?.code === "syncStateNotFound" ||
                body.error?.code === "resyncRequired"
            ) {
                throw new DirectoryCursorExpiredError(
                    `Graph delta token expired (${res.status} ${body.error?.code})`
                );
            }
            if (!res.ok) {
                throw new Error(
                    `Graph request failed (${res.status}) ${url}: ${body.error?.code} ${body.error?.message}`
                );
            }
            return body as T;
        }
    }

    /** Follow @odata.nextLink pages; returns the items and the final delta link, if any. */
    async getAll<T>(
        url: string
    ): Promise<{ items: T[]; deltaLink: string | null }> {
        const items: T[] = [];
        let next: string | undefined = url;
        while (next) {
            const page: GraphPage<T> | null =
                await this.get<GraphPage<T>>(next);
            if (!page) throw new Error(`Graph returned 404 for ${next}`);
            items.push(...page.value);
            if (page["@odata.deltaLink"]) {
                return { items, deltaLink: page["@odata.deltaLink"] };
            }
            next = page["@odata.nextLink"];
        }
        return { items, deltaLink: null };
    }
}

function isUserRef(ref: GraphDirectoryObjectRef) {
    return ref["@odata.type"] === "#microsoft.graph.user";
}

function isGroupRef(ref: GraphDirectoryObjectRef) {
    return ref["@odata.type"] === "#microsoft.graph.group";
}

function parseCursor(cursor: string | null): AzureCursor | null {
    if (!cursor) return null;
    try {
        const parsed = JSON.parse(cursor);
        if (
            typeof parsed?.usersDeltaLink === "string" &&
            typeof parsed?.groupsDeltaLink === "string"
        ) {
            return parsed;
        }
    } catch {
        // fall through
    }
    logger.warn("Ignoring unreadable Azure directory sync cursor");
    return null;
}

export class AzureDirectoryProvider implements DirectorySyncProvider {
    constructor(
        private readonly settings: {
            tenantId: string;
            /** Encrypted, as stored in `idpOidcConfig`. */
            encryptedClientId: string;
            /** Encrypted, as stored in `idpOidcConfig`. */
            encryptedClientSecret: string;
        }
    ) {}

    /** Parses the tenant ID from an Entra authorize URL. */
    static tenantIdFromAuthUrl(authUrl: string): string | null {
        return (
            authUrl.match(
                /login\.microsoftonline\.com\/([^/]+)\/oauth2/
            )?.[1] ?? null
        );
    }

    async fetch(ctx: DirectoryFetchContext): Promise<DirectoryFetchResult> {
        const getIdentifier = IDENTIFIER_FROM_GRAPH[ctx.identifierPath];
        if (!getIdentifier) {
            throw new Error(
                `identifierPath "${ctx.identifierPath}" can't be resolved from Graph; use one of: ${Object.keys(IDENTIFIER_FROM_GRAPH).join(", ")}`
            );
        }

        const graph = new GraphClient(() => this.getToken(), ctx.onRequest);
        const toDirectoryUser = (
            u: GraphUser,
            groups: DirectoryGroup[]
        ): DirectoryUser => ({
            externalId: u.id,
            username: getIdentifier(u)?.toLowerCase() ?? null,
            email: u.mail?.toLowerCase() ?? null,
            name: u.displayName ?? null,
            enabled: u.accountEnabled !== false,
            groups
        });

        const cursor = parseCursor(ctx.cursor);
        if (cursor) {
            const incremental = await this.fetchIncremental(
                graph,
                cursor,
                toDirectoryUser
            );
            if (incremental) return incremental;
            logger.info(
                `Azure incremental sync for IdP ${ctx.idpId} needs a full fetch`
            );
        }
        return this.fetchFull(graph, toDirectoryUser);
    }

    private async getToken(): Promise<string> {
        const { tenantId, encryptedClientId, encryptedClientSecret } =
            this.settings;
        const key = config.getRawConfig().server.secret!;
        const clientId = decrypt(encryptedClientId, key);
        const cacheKey = `${tenantId}:${clientId}`;

        const cached = tokenCache.get(cacheKey);
        if (cached && cached.expiresAt > Date.now() + 60_000) {
            return cached.token;
        }

        const res = await fetch(
            `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`,
            {
                method: "POST",
                headers: {
                    "Content-Type": "application/x-www-form-urlencoded"
                },
                body: new URLSearchParams({
                    grant_type: "client_credentials",
                    client_id: clientId,
                    client_secret: decrypt(encryptedClientSecret, key),
                    scope: "https://graph.microsoft.com/.default"
                })
            }
        );
        const body: any = await res.json().catch(() => ({}));
        if (!res.ok) {
            throw new Error(
                `Entra token request failed (${res.status}): ${body.error_description ?? body.error}`
            );
        }

        tokenCache.set(cacheKey, {
            token: body.access_token,
            expiresAt: Date.now() + Number(body.expires_in ?? 3600) * 1000
        });
        return body.access_token;
    }

    private async fetchFull(
        graph: GraphClient,
        toDirectoryUser: (
            u: GraphUser,
            groups: DirectoryGroup[]
        ) => DirectoryUser
    ): Promise<DirectoryFetchResult> {
        const usersRes = await graph.getAll<GraphUser>(
            `${GRAPH}/users/delta?$select=${USER_SELECT}`
        );
        const groupsRes = await graph.getAll<GraphGroup>(
            `${GRAPH}/groups/delta?$select=displayName,members`
        );

        // A large group can be split over several pages; merge its member chunks.
        const groups = new Map<string, DirectoryGroup>();
        // member (user or group) ID -> IDs of groups it directly belongs to
        const parentGroups = new Map<string, Set<string>>();
        for (const g of groupsRes.items) {
            if (g["@removed"]) continue;
            const existing = groups.get(g.id);
            groups.set(g.id, {
                id: g.id,
                displayName: g.displayName ?? existing?.displayName ?? null
            });
            for (const member of g["members@delta"] ?? []) {
                if (member["@removed"]) continue;
                if (!isUserRef(member) && !isGroupRef(member)) continue;
                const parents = parentGroups.get(member.id) ?? new Set();
                parents.add(g.id);
                parentGroups.set(member.id, parents);
            }
        }

        const transitiveGroups = (memberId: string): DirectoryGroup[] => {
            const seen = new Set<string>();
            const queue = [...(parentGroups.get(memberId) ?? [])];
            while (queue.length) {
                const groupId = queue.pop()!;
                if (seen.has(groupId)) continue;
                seen.add(groupId);
                queue.push(...(parentGroups.get(groupId) ?? []));
            }
            return [...seen]
                .map((id) => groups.get(id))
                .filter((g): g is DirectoryGroup => !!g);
        };

        const users = usersRes.items
            .filter((u) => !u["@removed"])
            .map((u) => toDirectoryUser(u, transitiveGroups(u.id)));

        return {
            kind: "full",
            users,
            nextCursor: this.cursorFrom(usersRes.deltaLink, groupsRes.deltaLink)
        };
    }

    /** Returns null when a full fetch is required instead. */
    private async fetchIncremental(
        graph: GraphClient,
        cursor: AzureCursor,
        toDirectoryUser: (
            u: GraphUser,
            groups: DirectoryGroup[]
        ) => DirectoryUser
    ): Promise<DirectoryFetchResult | null> {
        const usersRes = await graph.getAll<GraphUser>(cursor.usersDeltaLink);
        const groupsRes = await graph.getAll<GraphGroup>(
            cursor.groupsDeltaLink
        );

        const removedExternalIds = new Set<string>();
        const affectedUserIds = new Set<string>();

        for (const u of usersRes.items) {
            if (u["@removed"]) {
                removedExternalIds.add(u.id);
            } else {
                affectedUserIds.add(u.id);
            }
        }

        // Groups whose every (transitive) user member must be re-read.
        const expandGroupIds = new Set<string>();
        for (const g of groupsRes.items) {
            if (g["@removed"]) {
                // The former members of a deleted group aren't listed anywhere.
                return null;
            }
            if (g.displayName !== undefined) {
                // Possibly renamed: name-based role mappings may change for all members.
                expandGroupIds.add(g.id);
            }
            for (const member of g["members@delta"] ?? []) {
                if (isUserRef(member)) {
                    affectedUserIds.add(member.id);
                } else if (isGroupRef(member)) {
                    expandGroupIds.add(member.id);
                }
            }
        }

        for (const groupId of expandGroupIds) {
            const members = await graph.getAll<{ id: string }>(
                `${GRAPH}/groups/${groupId}/transitiveMembers/microsoft.graph.user?$select=id&$top=999`
            );
            for (const m of members.items) affectedUserIds.add(m.id);
            if (affectedUserIds.size > MAX_INCREMENTAL_AFFECTED_USERS) {
                return null;
            }
        }
        if (affectedUserIds.size > MAX_INCREMENTAL_AFFECTED_USERS) {
            return null;
        }

        const users: DirectoryUser[] = [];
        for (const userId of affectedUserIds) {
            if (removedExternalIds.has(userId)) continue;
            const u = await graph.get<GraphUser>(
                `${GRAPH}/users/${userId}?$select=${USER_SELECT}`
            );
            if (!u) {
                removedExternalIds.add(userId);
                continue;
            }
            const memberOf = await graph.getAll<GraphGroup>(
                `${GRAPH}/users/${userId}/transitiveMemberOf/microsoft.graph.group?$select=id,displayName&$top=999`
            );
            users.push(
                toDirectoryUser(
                    u,
                    memberOf.items.map((g) => ({
                        id: g.id,
                        displayName: g.displayName ?? null
                    }))
                )
            );
        }

        return {
            kind: "incremental",
            users,
            removedExternalIds: [...removedExternalIds],
            nextCursor: this.cursorFrom(usersRes.deltaLink, groupsRes.deltaLink)
        };
    }

    private cursorFrom(
        usersDeltaLink: string | null,
        groupsDeltaLink: string | null
    ): string | null {
        if (!usersDeltaLink || !groupsDeltaLink) return null;
        const cursor: AzureCursor = { usersDeltaLink, groupsDeltaLink };
        return JSON.stringify(cursor);
    }
}
