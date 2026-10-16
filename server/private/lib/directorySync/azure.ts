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

import { db, idp, idpOidcConfig, idpOrg } from "@server/db";
import { eq, and } from "drizzle-orm";
import type {
    DirectoryFetchContext,
    DirectoryFetchResult,
    DirectorySyncProvider,
    DirectoryUser
} from "./types";
import { decrypt } from "@server/lib/crypto";
import config from "@server/lib/config";
import cache from "@server/lib/cache";
import z from "zod";
import logger from "@server/logger";
import { fromError } from "zod-validation-error";

const userBodySchema = z.object({
    "@odata.nextLink": z.url().optional(),
    value: z.array(
        z.object({
            id: z.uuid(),
            mail: z.email().nullish(),
            displayName: z.string().nullish(),
            accountEnabled: z.boolean().nullish(),
            userPrincipalName: z.string().nullish(),
            otherMails: z.array(z.email()).nullish()
        })
    )
});

// we only do initial delta rounds for groups (no stored `deltaLink`), which return the
// current state of the directory and never contain `@removed` entries
const groupBodySchema = z.object({
    "@odata.nextLink": z.url().optional(),
    "@odata.deltaLink": z.url().optional(),
    value: z.array(
        z.object({
            id: z.uuid(),
            // large groups can be returned several times with their members split
            //    across the entries, the repeated entries may not have `displayName`
            displayName: z.string().nullish(),
            // omitted when the group has no members
            "members@delta": z
                .array(
                    z.object({
                        // user, group, device, servicePrincipal, orgContact...
                        "@odata.type": z.string(),
                        id: z.uuid()
                    })
                )
                .default([])
        })
    )
});

const tokenBodySchema = z.object({
    expires_in: z.int(),
    access_token: z.string()
});

type MicrosoftGraphUser = z.output<typeof userBodySchema>["value"][number];
type MicrosoftGraphGroup = z.output<typeof groupBodySchema>["value"][number];

type GraphGroupNode = {
    displayName: string | null;
    /** Groups that have this group as a direct member. */
    parentGroupIds: Set<string>;
    /** Users that are direct members of this group. */
    userIds: Set<string>;
};

type IdpDbResponse = Awaited<ReturnType<typeof ensureValidIdp>>;
export class AzureDirectorySyncProvider implements DirectorySyncProvider {
    #TOKEN_CACHE_KEY_PREFIX = "azureDirectorySyncToken";
    #microsoftGraphBaseUrl = "https://graph.microsoft.com/v1.0";

    async fetch(ctx: DirectoryFetchContext): Promise<DirectoryFetchResult> {
        const directoryUsers: Record<string, DirectoryUser> = {};
        // 0. fetch idp and check that it is valid
        const idpRes = await ensureValidIdp(ctx.idpId);

        // 1. get access token (and cache)
        const token = await this.#getToken(idpRes);

        // 2. get users & groups
        const [userResponse, groupResponse] = await Promise.all([
            this.#fetchAllUsers(token, idpRes.idp.idpId),
            this.#fetchAllGroups(token, idpRes.idp.idpId)
        ]);

        for (const user of userResponse.users) {
            let email = user.mail ?? user.otherMails?.[0];

            if (!email && user.userPrincipalName) {
                // uPn is formatted with `#EXT#<something>` at the end, we remove that
                const extSuffixRegex = /(\#EXT\#.*$)/;
                const uPnWithoutEXT = user.userPrincipalName.replaceAll(
                    extSuffixRegex,
                    ""
                );

                // split uPn with `_` (Entra `_` replaces `@`)
                let splitted = uPnWithoutEXT.split("_");
                if (splitted.length === 2) {
                    email = splitted.join("@");
                }
            }

            if (!email) {
                logger.warn(
                    `Directory sync: skipping Entra user ${user.userPrincipalName} (id: ${user.id}) for IdP ${idpRes.idp.idpId}: no email found in \`mail\`, \`otherMails\` or \`userPrincipalName\``
                );
            } else {
                directoryUsers[user.id] = {
                    email,
                    externalId: user.id,
                    enabled: user.accountEnabled ?? true,
                    name: user.displayName ?? null,
                    username: email,
                    groups: []
                };
            }
        }

        // 3. build the group tree, merging the repeated entries of large groups
        const groupNodes = new Map<string, GraphGroupNode>();
        const getGroupNode = (groupId: string) => {
            let node = groupNodes.get(groupId);
            if (!node) {
                node = {
                    displayName: null,
                    parentGroupIds: new Set(),
                    userIds: new Set()
                };
                groupNodes.set(groupId, node);
            }
            return node;
        };

        for (const group of groupResponse.groups) {
            const node = getGroupNode(group.id);
            if (group.displayName) {
                node.displayName = group.displayName;
            }

            for (const member of group["members@delta"]) {
                if (member["@odata.type"] === "#microsoft.graph.user") {
                    node.userIds.add(member.id);
                } else if (member["@odata.type"] === "#microsoft.graph.group") {
                    getGroupNode(member.id).parentGroupIds.add(group.id);
                }
            }
        }

        // 4. expand nested memberships: a user is a member of its direct groups
        //    and of every group above them
        const ancestorsCache = new Map<string, Set<string>>();
        const getGroupWithAncestors = (
            groupId: string,
            visiting = new Set<string>()
        ): Set<string> => {
            const cached = ancestorsCache.get(groupId);
            if (cached) {
                return cached;
            }

            const result = new Set([groupId]);
            visiting.add(groupId);
            for (const parentId of groupNodes.get(groupId)?.parentGroupIds ??
                []) {
                // guard against cycles
                if (visiting.has(parentId)) {
                    continue;
                }
                for (const ancestorId of getGroupWithAncestors(
                    parentId,
                    visiting
                )) {
                    result.add(ancestorId);
                }
            }
            visiting.delete(groupId);

            ancestorsCache.set(groupId, result);
            return result;
        };

        const userGroupIds = new Map<string, Set<string>>();
        for (const [groupId, node] of groupNodes) {
            for (const userId of node.userIds) {
                if (!directoryUsers[userId]) {
                    continue;
                }

                let groupIds = userGroupIds.get(userId);
                if (!groupIds) {
                    groupIds = new Set();
                    userGroupIds.set(userId, groupIds);
                }
                for (const id of getGroupWithAncestors(groupId)) {
                    groupIds.add(id);
                }
            }
        }

        for (const [userId, groupIds] of userGroupIds) {
            directoryUsers[userId].groups = [...groupIds].map((id) => ({
                id,
                displayName: groupNodes.get(id)?.displayName ?? null
            }));
        }

        return {
            users: Object.values(directoryUsers)
            // nextCursor: null
        };
    }

    async #getToken(idpRes: IdpDbResponse): Promise<string> {
        const cacheKey = `${this.#TOKEN_CACHE_KEY_PREFIX}:${idpRes.idp.idpId}`;
        const cached = await cache.get<string>(cacheKey);

        if (cached) {
            logger.info("Returning cached access token");
            return cached;
        }

        logger.info("Fetching fresh access token");
        const key = config.getRawConfig().server.secret!;

        let clientId = "";
        let clientSecret = "";

        if (idpRes.idp.type === "oidc") {
            clientSecret = decrypt(idpRes.idpOidcConfig.clientSecret, key);
            clientId = decrypt(idpRes.idpOidcConfig.clientId, key);
        }

        const res = await fetch(idpRes.idpOidcConfig.tokenUrl, {
            method: "POST",
            headers: {
                "Content-Type": "application/x-www-form-urlencoded"
            },
            body: new URLSearchParams({
                grant_type: "client_credentials",
                client_id: clientId,
                client_secret: clientSecret,
                scope: "https://graph.microsoft.com/.default"
            })
        });

        const body: any = await res.json().catch(() => ({}));
        if (!res.ok) {
            const reason =
                body.error_description ??
                body.error ??
                res.statusText ??
                "no error details in response";
            throw new Error(
                `Directory sync: Entra token request for IdP ${idpRes.idp.idpId} failed (HTTP ${res.status}): ${reason}`
            );
        }

        try {
            const tokenResponse = tokenBodySchema.parse(body);
            await cache.set(
                cacheKey,
                tokenResponse.access_token,
                tokenResponse.expires_in - 30 // keep the response 30 seconds less than the token to make sure to always have a fresh token
            );

            logger.info(
                `Got new access token (expires in: ${tokenResponse.expires_in}s)`
            );

            return tokenResponse.access_token;
        } catch (e) {
            throw new Error(
                `Directory sync: unexpected Entra token response for IdP ${idpRes.idp.idpId}: ${fromError(e).toString()}`,
                { cause: e }
            );
        }
    }

    async #fetchAllUsers(token: string, idpId: number) {
        // we need to follow `@odata.nextLink` as-is until it is absent
        //    (microsoft graph returns a max of 999 users per page)
        const sp = new URLSearchParams({
            $select:
                "id,displayName,mail,userPrincipalName,accountEnabled,otherMails",
            $top: "999"
        });
        let nextUrl: string | undefined =
            `${this.#microsoftGraphBaseUrl}/users?${sp.toString()}`;
        const allUsers: MicrosoftGraphUser[] = [];

        while (nextUrl) {
            logger.info(`Fetching URL: ${nextUrl}`);
            const res = await fetch(nextUrl, {
                headers: {
                    Authorization: `Bearer ${token}`
                }
            });

            const body: any = await res.json().catch(() => ({}));
            if (!res.ok) {
                const reason =
                    body.error?.message ??
                    body.error?.code ??
                    res.statusText ??
                    "no error details in response";
                throw new Error(
                    `Directory sync: Entra users request for IdP ${idpId} failed (HTTP ${res.status}): ${reason}`
                );
            }

            try {
                const response = userBodySchema.parse(body);

                allUsers.push(...response.value);
                nextUrl = response["@odata.nextLink"];
            } catch (e) {
                console.dir(
                    {
                        body
                    },
                    { depth: null }
                );
                throw new Error(
                    `Directory sync: unexpected Entra users response for IdP ${idpId}: ${fromError(e).toString()}`,
                    { cause: e }
                );
            }
        }

        logger.info(`Fetched ${allUsers.length} users from Microsoft Graph`);
        return {
            users: allUsers
        };
    }

    async #fetchAllGroups(token: string, idpId: number) {
        // we need to follow `@odata.nextLink` as-is until it is absent,
        //    the last page returns `@odata.deltaLink` instead
        //    (microsoft graph returns a max of 100 groups per page)
        const MAX_PAGES = 3;
        let pagesFound = 0;
        const sp = new URLSearchParams({
            $select: "id,displayName,members"
        });
        let nextUrl: string | undefined =
            `${this.#microsoftGraphBaseUrl}/groups/delta?${sp.toString()}`;
        let deltaLink: string | null = null;
        const allGroups: MicrosoftGraphGroup[] = [];

        while (nextUrl) {
            logger.info(`Fetching URL: ${nextUrl}`);

            const res = await fetch(nextUrl, {
                headers: {
                    Authorization: `Bearer ${token}`
                }
            });

            const body: any = await res.json().catch(() => ({}));
            if (!res.ok) {
                const reason =
                    body.error?.message ??
                    body.error?.code ??
                    res.statusText ??
                    "no error details in response";
                throw new Error(
                    `Directory sync: Entra groups request for IdP ${idpId} failed (HTTP ${res.status}): ${reason}`
                );
            }

            pagesFound += 1;
            try {
                const response = groupBodySchema.parse(body);

                allGroups.push(...response.value);
                nextUrl = response["@odata.nextLink"];

                // Sometimes, microsoft graph will send empty pages with a `@odata.nextLink` even
                // though they are the last page, in that case, we stop the loop because this shouldn't happen
                // DO NOT ASK ME WHY THIS IS THE CASE, IDK ¯\_(ツ)_/¯
                if (response.value.length === 0) {
                    nextUrl = undefined;
                }
                deltaLink = response["@odata.deltaLink"] ?? null;
            } catch (e) {
                console.dir(
                    {
                        body
                    },
                    { depth: null }
                );
                throw new Error(
                    `Directory sync: unexpected Entra groups response for IdP ${idpId}: ${fromError(e).toString()}`,
                    { cause: e }
                );
            }
        }

        logger.info(`Fetched ${allGroups.length} groups from Microsoft Graph`);
        return {
            groups: allGroups,
            deltaLink
        };
    }
}

async function ensureValidIdp(idpId: number) {
    const [idpRes] = await db
        .select()
        .from(idp)
        .where(eq(idp.idpId, idpId))
        .innerJoin(idpOidcConfig, eq(idpOidcConfig.idpId, idp.idpId))
        .innerJoin(idpOrg, and(eq(idpOrg.idpId, idp.idpId)))
        .limit(1);

    if (!idpRes) {
        throw new Error(
            `Directory sync: IdP ${idpId} not found, or it has no OIDC config or org mapping`
        );
    }

    if (idpRes.idpOidcConfig.variant !== "azure") {
        throw new Error(
            `Directory sync: IdP ${idpId} has variant "${idpRes.idpOidcConfig.variant}", expected "azure"`
        );
    }

    if (!idpRes.idp.directorySyncEnabled) {
        throw new Error(
            `Directory sync: directory sync is not enabled on IdP ${idpId}`
        );
    }

    if (idpRes.idp.autoProvision) {
        throw new Error(
            `Directory sync: IdP ${idpId} has both directory sync and auto-provisioning enabled; only one can be active`
        );
    }
    return idpRes;
}
