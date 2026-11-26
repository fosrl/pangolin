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

import cache from "@server/lib/cache";
import { idpApiTokenCacheKey } from "@server/lib/idp/apiTokenCache";
import config from "@server/lib/config";
import { decrypt } from "@server/lib/crypto";
import logger from "@server/logger";
import z from "zod";
import { fromError } from "zod-validation-error";
import type { IDPAPIProviderIdp } from "./types";
import { IDPAPIProvider } from "./types";
import { readOrThrow, runApiIntegrationTest } from "./testConnection";
import type {
    IdpApiTestResult,
    DirectoryFetchContext,
    IDPDirectoryFetchResult,
    IDPGroup,
    IDPDirectoryUser
} from "./types";

const userBodySchema = z.object({
    "@odata.nextLink": z.url().optional(),
    value: z.array(
        z.object({
            id: z.uuid(),
            // invalid addresses are dropped instead of failing the whole sync
            mail: z.email().nullish().catch(null),
            displayName: z.string().nullish(),
            accountEnabled: z.boolean().nullish(),
            userPrincipalName: z.string().nullish(),
            otherMails: z
                .array(z.string())
                .nullish()
                .transform((mails) =>
                    mails?.filter((m) => z.email().safeParse(m).success)
                )
        })
    )
});

// entries flagged as removed (e.g. soft-deleted groups or removed members), these
//    can show up even in initial delta rounds (no stored `deltaLink`)
const removedSchema = z.object({ reason: z.string() }).optional();

const groupBodySchema = z.object({
    "@odata.nextLink": z.url().optional(),
    "@odata.deltaLink": z.url().optional(),
    value: z.array(
        z.object({
            id: z.uuid(),
            // large groups can be returned several times with their members split
            //    across the entries, the repeated entries may not have `displayName`
            displayName: z.string().nullish(),
            "@removed": removedSchema,
            // omitted when the group has no members
            "members@delta": z
                .array(
                    z.object({
                        // user, group, device, servicePrincipal, orgContact...
                        "@odata.type": z.string(),
                        id: z.uuid(),
                        "@removed": removedSchema
                    })
                )
                .default([])
        })
    )
});

const memberOfBodySchema = z.object({
    "@odata.nextLink": z.url().optional(),
    value: z.array(
        z.object({
            // group, directoryRole, administrativeUnit...
            "@odata.type": z.string(),
            id: z.uuid(),
            displayName: z.string().nullish()
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

export class AzureDirectorySyncProvider extends IDPAPIProvider {
    async fetchUserGroups(
        user: Pick<IDPDirectoryUser, "externalId">
    ): Promise<IDPGroup[]> {
        const idpId = this.idp.idp.idpId;
        const token = await this.#getToken(this.idp);

        // `transitiveMemberOf` already expands nested groups, it also returns
        //    directory roles and administrative units which we filter out
        const sp = new URLSearchParams({
            $select: "id,displayName",
            $top: "999"
        });
        let nextUrl: string | undefined =
            `${this.#microsoftGraphBaseUrl}/users/${encodeURIComponent(user.externalId)}/transitiveMemberOf?${sp.toString()}`;
        const groups = new Map<string, IDPGroup>();

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
                    `IdP API: Entra user groups request for user ${user.externalId} of IdP ${idpId} failed (HTTP ${res.status}): ${reason}`
                );
            }

            try {
                const response = memberOfBodySchema.parse(body);
                for (const entry of response.value) {
                    if (entry["@odata.type"] !== "#microsoft.graph.group") {
                        continue;
                    }
                    groups.set(entry.id, {
                        id: entry.id,
                        displayName: entry.displayName ?? null
                    });
                }
                nextUrl = response["@odata.nextLink"];

                // Sometimes, microsoft graph will send empty pages with a `@odata.nextLink` even
                // though they are the last page, in that case, we stop the loop because this shouldn't happen
                // DO NOT ASK ME WHY THIS IS THE CASE, IDK ¯\_(ツ)_/¯
                if (response.value.length === 0) {
                    nextUrl = undefined;
                }
            } catch (e) {
                throw new Error(
                    `IdP API: unexpected Entra user groups response for user ${user.externalId} of IdP ${idpId}: ${fromError(e).toString()}`,
                    { cause: e }
                );
            }
        }

        return [...groups.values()];
    }

    externalIdFromClaims(claims: Record<string, unknown>): string | null {
        // the token `oid` is the Graph user `id` (`sub` is pairwise per app)
        return claims.oid?.toString() ?? null;
    }

    toClaims(user: IDPDirectoryUser): object {
        return {
            iss: `https://login.microsoftonline.com/${this.#tenantId}/v2.0`,
            oid: user.externalId,
            tid: this.#tenantId,
            name: user.name,
            email: user.email,
            preferred_username: user.email,
            groups: user.groups.map((g) => g.id),
            groupNames: user.groups.map((g) => g.displayName)
        };
    }
    #microsoftGraphBaseUrl = "https://graph.microsoft.com/v1.0";

    get #tenantId() {
        let tenantId = "";
        if (this.idp.idpOidcConfig?.authUrl) {
            const tenantMatch = this.idp.idpOidcConfig.authUrl.match(
                /login\.microsoftonline\.com\/([^/]+)\/oauth2/
            );
            if (tenantMatch) {
                tenantId = tenantMatch[1];
            }
        }
        return tenantId;
    }

    async fetchAllDirectoryUsers(): Promise<IDPDirectoryFetchResult> {
        const directoryUsers: Record<string, IDPDirectoryUser> = {};
        // 0. fetch idp and check that it is valid
        const idpRes = this.idp;

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

            // kept without an email rather than dropped: a dropped user would look
            // like they left the directory and lose their memberships
            if (!email) {
                logger.debug(
                    `Directory sync: Entra user ${user.userPrincipalName} (id: ${user.id}) for IdP ${idpRes.idp.idpId} has no email in \`mail\`, \`otherMails\` or \`userPrincipalName\``
                );
            }
            directoryUsers[user.id] = {
                email: email ?? null,
                externalId: user.id,
                enabled: user.accountEnabled ?? true,
                name: user.displayName ?? null,
                username: email ?? user.userPrincipalName ?? user.id,
                groups: []
            };
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
            if (group["@removed"]) {
                continue;
            }

            const node = getGroupNode(group.id);
            if (group.displayName) {
                node.displayName = group.displayName;
            }

            for (const member of group["members@delta"]) {
                if (member["@removed"]) {
                    continue;
                }

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

    async testConnection(): Promise<IdpApiTestResult> {
        // a valid token without the Graph permission gives "Insufficient privileges"
        const reasonOf = (permission: string) => (body: any) => {
            const message: string | undefined =
                body.error?.message ?? body.error?.code;
            if (body.error?.code === "Authorization_RequestDenied") {
                return `${message} Add the Microsoft Graph permission ${permission} to the app registration as an Application permission (not Delegated) and grant admin consent for the tenant, then test again.`;
            }
            return message;
        };

        return runApiIntegrationTest({
            getToken: () => this.#getToken(this.idp, { skipCache: true }),
            readUsers: async (token) => {
                const body = await readOrThrow(
                    `${this.#microsoftGraphBaseUrl}/users?$top=1&$select=id`,
                    token,
                    "Microsoft Graph users",
                    reasonOf("User.Read.All")
                );
                return body.value?.[0]?.id;
            },
            readGroups: (token) =>
                readOrThrow(
                    `${this.#microsoftGraphBaseUrl}/groups?$top=1&$select=id`,
                    token,
                    "Microsoft Graph groups",
                    reasonOf("GroupMember.Read.All (or Group.Read.All)")
                ),
            // same call as the sign-in group lookup (`fetchUserGroups`)
            readUserGroups: (token, userId) =>
                readOrThrow(
                    `${this.#microsoftGraphBaseUrl}/users/${encodeURIComponent(userId)}/transitiveMemberOf?$top=1&$select=id`,
                    token,
                    "Microsoft Graph user groups",
                    reasonOf("GroupMember.Read.All (or Group.Read.All)")
                )
        });
    }

    /**
     * Drops the trace/correlation IDs and timestamp Entra appends to every error,
     * and adds what to do for the common AADSTS codes.
     */
    #explainTokenError(description: string, clientId: string): string {
        const message = description.replace(/\s*Trace ID:[\s\S]*$/, "").trim();
        const tenant = this.#tenantId;
        const code = message.match(/AADSTS(\d+)/)?.[1];

        let hint: string | undefined;
        if (["common", "organizations", "consumers"].includes(tenant)) {
            hint = `The tenant is "${tenant}", which can't be used to read a directory. Set the identity provider's Tenant ID to your tenant's ID (the Directory (tenant) ID on the app registration's Overview page).`;
        } else if (code === "7000215") {
            hint =
                "The client secret is wrong. Paste the secret's Value (only shown once, when it's created), not its Secret ID, into the identity provider's Client Secret.";
        } else if (code === "7000222") {
            hint =
                "The client secret has expired, so sign-in is failing too. Create a new secret under Certificates & secrets and paste its Value into the identity provider's Client Secret.";
        } else if (code === "700016") {
            hint = `There's no app with client ID "${clientId}" in tenant "${tenant}". Use the Application (client) ID from the Overview page of an app registered in this tenant.`;
        } else if (code === "90002") {
            hint = `Tenant "${tenant}" doesn't exist. Use the Directory (tenant) ID from the app registration's Overview page.`;
        }

        return hint ? `${message} ${hint}` : message;
    }

    async #getToken(
        idpRes: IDPAPIProviderIdp,
        { skipCache = false }: { skipCache?: boolean } = {}
    ): Promise<string> {
        const cacheKey = idpApiTokenCacheKey("azure", idpRes.idp.idpId);
        const cached =
            skipCache || this.options.tokenCache === false
                ? null
                : await cache.get<string>(cacheKey);

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
            const reason = this.#explainTokenError(
                body.error_description ??
                    body.error ??
                    res.statusText ??
                    "no error details in response",
                clientId
            );
            throw new Error(
                `Directory sync: Entra token request for IdP ${idpRes.idp.idpId} failed (HTTP ${res.status}): ${reason}`
            );
        }

        try {
            const tokenResponse = tokenBodySchema.parse(body);
            if (this.options.tokenCache !== false) {
                await cache.set(
                    cacheKey,
                    tokenResponse.access_token,
                    tokenResponse.expires_in - 30 // keep the response 30 seconds less than the token to make sure to always have a fresh token
                );
            }

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
