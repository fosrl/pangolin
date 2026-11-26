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

import { IDPAPIProvider } from "./types";
import { readOrThrow, runApiIntegrationTest } from "./testConnection";
import type {
    IdpApiTestResult,
    DirectoryFetchContext,
    IDPDirectoryFetchResult,
    IDPDirectoryUser,
    IDPGroup
} from "./types";
import type { IDPAPIProviderIdp } from "./types";

import { createSign } from "node:crypto";
import cache from "@server/lib/cache";
import { idpApiTokenCacheKey } from "@server/lib/idp/apiTokenCache";
import logger from "@server/logger";
import { decryptIDPAPIConfig } from "./config";
import z from "zod";
import {
    googleIDPAPIConfigSchema,
    type GoogleIDPAPIConfig
} from "@app/lib/idpApiConfig";
import { fromError } from "zod-validation-error";

const SCOPES = [
    "https://www.googleapis.com/auth/admin.directory.user.readonly",
    "https://www.googleapis.com/auth/admin.directory.group.readonly",
    "https://www.googleapis.com/auth/admin.directory.group.member.readonly"
].join(" ");

function b64url(input: string | Buffer) {
    return Buffer.from(input).toString("base64url");
}

const tokenBodySchema = z.object({
    expires_in: z.int(),
    access_token: z.string()
});

const userBodySchema = z.object({
    nextPageToken: z.string().optional(),
    // omitted when the page is empty
    users: z
        .array(
            z.object({
                id: z.string(),
                primaryEmail: z.string(),
                name: z.object({ fullName: z.string().nullish() }).nullish(),
                suspended: z.boolean().nullish(),
                archived: z.boolean().nullish()
            })
        )
        .default([])
});

const groupBodySchema = z.object({
    nextPageToken: z.string().optional(),
    groups: z
        .array(
            z.object({
                id: z.string(),
                name: z.string().nullish(),
                email: z.string().nullish()
            })
        )
        .default([])
});

const memberBodySchema = z.object({
    nextPageToken: z.string().optional(),
    members: z
        .array(
            z.object({
                id: z.string(),
                // USER, GROUP or CUSTOMER
                type: z.string()
            })
        )
        .default([])
});

type GoogleUser = z.output<typeof userBodySchema>["users"][number];
type GoogleGroup = z.output<typeof groupBodySchema>["groups"][number];
type GoogleMember = z.output<typeof memberBodySchema>["members"][number];

export class GoogleDirectorySyncProvider extends IDPAPIProvider {
    #googleAPIBaseUrl = "https://admin.googleapis.com/admin/directory/v1";
    // number of groups whose members are fetched in parallel
    #MEMBERS_FETCH_CONCURRENCY = 5;
    // retries on rate limiting (429) and transient server errors (5xx)
    #MAX_RETRIES = 3;

    externalIdFromClaims(claims: Record<string, unknown>): string | null {
        // the token `sub` is the Directory user `id`
        return claims.sub?.toString() ?? null;
    }

    toClaims(user: IDPDirectoryUser): object {
        const splitted = user.email?.split("@") ?? [];
        const baseDomain = splitted.at(-1);
        return {
            iss: "https://accounts.google.com",
            sub: user.externalId,
            name: user.name,
            email: user.email,
            email_verified: true,
            hd: baseDomain,
            groups: user.groups.map((g) => g.id),
            groupNames: user.groups.map((g) => g.displayName)
        };
    }

    async fetchUserGroups(
        user: Pick<IDPDirectoryUser, "externalId">
    ): Promise<IDPGroup[]> {
        const idpRes = this.idp;
        const idpId = idpRes.idp.idpId;
        const token = await this.#getToken(idpRes, this.#getAPIConfig(idpRes));

        // a member's groups are direct ones only, but a group can be a member
        //    too, so we walk up the tree one level at a time to get the same
        //    transitive groups as sync (`includeDerivedMembership`)
        const groups = new Map<string, IDPGroup>();
        let frontier = [user.externalId];

        while (frontier.length > 0) {
            const parentsPerKey = await mapWithConcurrency(
                frontier,
                this.#MEMBERS_FETCH_CONCURRENCY,
                (key) => {
                    return this.#fetchAllPages<GoogleGroup>({
                        url: this.#memberGroupsUrl(key, "200"),
                        token,
                        idpId,
                        label: `groups of ${key}`,
                        parse: (body) => {
                            const res = groupBodySchema.parse(body);
                            return {
                                items: res.groups,
                                nextPageToken: res.nextPageToken
                            };
                        }
                    });
                }
            );

            frontier = [];
            for (const group of parentsPerKey.flat()) {
                // already visited (diamond or cycle in the group tree)
                if (groups.has(group.id)) {
                    continue;
                }
                groups.set(group.id, {
                    id: group.id,
                    displayName: group.name ?? group.email ?? null
                });
                frontier.push(group.id);
            }
        }

        return [...groups.values()];
    }

    /**
     * The groups `memberKey` (a user or group ID) is a direct member of. Uses
     * `customer` + a `memberKey` query rather than `userKey`: without a customer
     * or domain, `userKey` makes Google take the caller's domain, and a service
     * account calling as itself (no admin email) has none ("Domain not found").
     */
    #memberGroupsUrl(memberKey: string, maxResults: string): string {
        const sp = new URLSearchParams({
            customer: this.#getAPIConfig(this.idp).customerId ?? "my_customer",
            query: `memberKey=${memberKey}`,
            maxResults,
            fields: "nextPageToken,groups(id,name,email)"
        });
        return `${this.#googleAPIBaseUrl}/groups?${sp.toString()}`;
    }

    async fetchAllDirectoryUsers(): Promise<IDPDirectoryFetchResult> {
        const directoryUsers: Record<string, IDPDirectoryUser> = {};
        // 0. fetch idp and check that it is valid
        const idpRes = this.idp;

        const idpId = idpRes.idp.idpId;
        const apiConfig = this.#getAPIConfig(idpRes);
        const customer = apiConfig.customerId ?? "my_customer";

        // 1. get access token (and cache)
        const token = await this.#getToken(idpRes, apiConfig);

        // 2. get users & groups
        const usersSearchParams = new URLSearchParams({
            customer,
            maxResults: "500",
            fields: "nextPageToken,users(id,primaryEmail,name/fullName,suspended,archived)"
        });
        const groupsSearchParams = new URLSearchParams({
            customer,
            maxResults: "200",
            fields: "nextPageToken,groups(id,name,email)"
        });
        const [users, groups] = await Promise.all([
            this.#fetchAllPages<GoogleUser>({
                url: `${this.#googleAPIBaseUrl}/users?${usersSearchParams.toString()}`,
                token,
                idpId,
                label: "users",
                parse: (body) => {
                    const res = userBodySchema.parse(body);
                    return {
                        items: res.users,
                        nextPageToken: res.nextPageToken
                    };
                }
            }),
            this.#fetchAllPages<GoogleGroup>({
                url: `${this.#googleAPIBaseUrl}/groups?${groupsSearchParams.toString()}`,
                token,
                idpId,
                label: "groups",
                parse: (body) => {
                    const res = groupBodySchema.parse(body);
                    return {
                        items: res.groups,
                        nextPageToken: res.nextPageToken
                    };
                }
            })
        ]);

        for (const user of users) {
            directoryUsers[user.id] = {
                email: user.primaryEmail,
                externalId: user.id,
                // archived users can't sign in, same as suspended ones
                enabled: !user.suspended && !user.archived,
                name: user.name?.fullName ?? null,
                username: user.primaryEmail,
                groups: []
            };
        }

        // 3. get the members of each group, `includeDerivedMembership` makes google
        //    expand nested groups so users get every group above their direct ones
        const groupMembers = await mapWithConcurrency(
            groups,
            this.#MEMBERS_FETCH_CONCURRENCY,
            (group) => {
                const sp = new URLSearchParams({
                    maxResults: "200",
                    includeDerivedMembership: "true",
                    fields: "nextPageToken,members(id,type)"
                });
                return this.#fetchAllPages<GoogleMember>({
                    url: `${this.#googleAPIBaseUrl}/groups/${encodeURIComponent(group.id)}/members?${sp.toString()}`,
                    token,
                    idpId,
                    label: `members of group ${group.email ?? group.id}`,
                    parse: (body) => {
                        const res = memberBodySchema.parse(body);
                        return {
                            items: res.members,
                            nextPageToken: res.nextPageToken
                        };
                    }
                });
            }
        );

        groups.forEach((group, i) => {
            const memberUserIds = new Set(
                groupMembers[i]
                    .filter((member) => member.type === "USER")
                    .map((member) => member.id)
            );
            for (const userId of memberUserIds) {
                directoryUsers[userId]?.groups.push({
                    id: group.id,
                    displayName: group.name ?? group.email ?? null
                });
            }
        });

        return {
            users: Object.values(directoryUsers)
        };
    }

    #getAPIConfig(idpRes: IDPAPIProviderIdp): GoogleIDPAPIConfig {
        try {
            return googleIDPAPIConfigSchema.parse(
                decryptIDPAPIConfig(idpRes.idp.apiConfig)
            );
        } catch (e) {
            throw new Error(
                `Directory sync: invalid directory sync config for Google IdP ${idpRes.idp.idpId}: ${fromError(e).toString()}`,
                { cause: e }
            );
        }
    }

    async testConnection(): Promise<IdpApiTestResult> {
        const searchParams = (fields: string) =>
            new URLSearchParams({
                customer:
                    this.#getAPIConfig(this.idp).customerId ?? "my_customer",
                maxResults: "1",
                fields
            }).toString();
        const reasonOf = (body: any) => {
            const message: string | undefined = body.error?.message;
            // an unknown `customer` gives "Invalid Input" (users) or "Domain not found" (groups)
            const customerId = this.#getAPIConfig(this.idp).customerId;
            if (customerId && [400, 404].includes(body.error?.code)) {
                return `${message ?? "no error details in response"}. Check the Customer ID "${customerId}": it must be the ID from the Google Admin console (Account > Account settings, like C01abc23d), not a domain. Leave it empty to use the admin's own customer.`;
            }
            // the token worked, so the delegated scopes are fine: the impersonated admin lacks rights
            if (
                body.error?.code === 403 &&
                message?.startsWith("Not Authorized")
            ) {
                const { adminEmail, serviceAccountKey } = this.#getAPIConfig(
                    this.idp
                );
                if (adminEmail) {
                    return `${message}. The admin email "${adminEmail}" must be an admin of this Google Workspace with read access to users and groups (Super Admin, or a role with Admin API privileges Users > Read and Groups > Read).`;
                }
                // service accounts can't be Super Admin, and `my_customer` doesn't resolve for them
                return `${message}. Without an admin email, the service account "${serviceAccountKey.client_email}" calls the API as itself: a super admin must assign it a custom admin role with Admin API privileges Users > Read and Groups > Read (Account > Admin roles > the role > Admins > Assign service accounts).${customerId ? "" : " Also set the Customer ID: the default (the admin's own customer) doesn't apply to a service account."}`;
            }
            return message;
        };

        return runApiIntegrationTest({
            getToken: () =>
                this.#getToken(this.idp, this.#getAPIConfig(this.idp), {
                    skipCache: true
                }),
            readUsers: async (token) => {
                const body = await readOrThrow(
                    `${this.#googleAPIBaseUrl}/users?${searchParams("users(id)")}`,
                    token,
                    "Google Workspace users",
                    reasonOf
                );
                return body.users?.[0]?.id;
            },
            readGroups: (token) =>
                readOrThrow(
                    `${this.#googleAPIBaseUrl}/groups?${searchParams("groups(id)")}`,
                    token,
                    "Google Workspace groups",
                    reasonOf
                ),
            readUserGroups: (token, userId) =>
                readOrThrow(
                    this.#memberGroupsUrl(userId, "1"),
                    token,
                    "Google Workspace user groups",
                    reasonOf
                )
        });
    }

    async #getToken(
        idpRes: IDPAPIProviderIdp,
        apiConfig: GoogleIDPAPIConfig,
        { skipCache = false }: { skipCache?: boolean } = {}
    ): Promise<string> {
        const cacheKey = idpApiTokenCacheKey("google", idpRes.idp.idpId);
        const cached =
            skipCache || this.options.tokenCache === false
                ? null
                : await cache.get<string>(cacheKey);

        if (cached) {
            logger.info("Returning cached access token");
            return cached;
        }

        logger.info("Fetching fresh access token");
        const key = apiConfig.serviceAccountKey;

        const now = Math.floor(Date.now() / 1000);
        const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
        const claims = b64url(
            JSON.stringify({
                iss: key.client_email,
                sub: apiConfig.adminEmail, // only with domain-wide delegation
                scope: SCOPES,
                aud: key.token_uri,
                iat: now,
                exp: now + 3600 // max 1h
            })
        );
        const signature = createSign("RSA-SHA256")
            .update(`${header}.${claims}`)
            .sign(key.private_key, "base64url");

        const res = await fetch(key.token_uri, {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: new URLSearchParams({
                grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
                assertion: `${header}.${claims}.${signature}`
            })
        });
        const body: any = await res.json().catch(() => ({}));
        if (!res.ok) {
            let reason =
                body.error_description ??
                body.error ??
                res.statusText ??
                "no error details in response";
            // impersonating `adminEmail` needs domain-wide delegation for every requested scope
            if (body.error === "unauthorized_client" && apiConfig.adminEmail) {
                reason += `. Domain-wide delegation isn't set up for this service account: a super admin must open https://admin.google.com/ac/owl/domainwidedelegation (Security > Access and data control > API controls > Manage Domain Wide Delegation) and add its Client ID (the "client_id" in the key JSON) with these scopes: ${SCOPES.split(" ").join(", ")}. Changes can take a few minutes to apply.`;
            }
            throw new Error(
                `Directory sync: Google Workspace token request for IdP ${idpRes.idp.idpId} failed (HTTP ${res.status}): ${reason}`
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
                `Directory sync: unexpected Google Workspace token response for IdP ${idpRes.idp.idpId}: ${fromError(e).toString()}`,
                { cause: e }
            );
        }
    }

    async #fetchAllPages<T>({
        url,
        token,
        idpId,
        label,
        parse
    }: {
        url: string;
        token: string;
        idpId: number;
        label: string;
        parse: (body: unknown) => { items: T[]; nextPageToken?: string };
    }): Promise<T[]> {
        // we need to follow `nextPageToken` until it is absent
        const items: T[] = [];
        let pageToken: string | undefined;

        do {
            const pageUrl = new URL(url);
            if (pageToken) {
                pageUrl.searchParams.set("pageToken", pageToken);
            }

            logger.info(`Fetching URL: ${pageUrl}`);
            const res = await this.#fetchWithRetry(pageUrl, token);

            const body: any = await res.json().catch(() => ({}));
            if (!res.ok) {
                const reason =
                    body.error?.message ??
                    res.statusText ??
                    "no error details in response";
                throw new Error(
                    `Directory sync: Google Workspace ${label} request for IdP ${idpId} failed (HTTP ${res.status}): ${reason}`
                );
            }

            try {
                const page = parse(body);
                items.push(...page.items);
                pageToken = page.nextPageToken;
            } catch (e) {
                throw new Error(
                    `Directory sync: unexpected Google Workspace ${label} response for IdP ${idpId}: ${fromError(e).toString()}`,
                    { cause: e }
                );
            }
        } while (pageToken);

        logger.info(`Fetched ${items.length} ${label} from Google Workspace`);
        return items;
    }

    async #fetchWithRetry(url: URL, token: string): Promise<Response> {
        for (let attempt = 0; ; attempt++) {
            const res = await fetch(url, {
                headers: { Authorization: `Bearer ${token}` }
            });

            const retryable = res.status === 429 || res.status >= 500;
            if (!retryable || attempt >= this.#MAX_RETRIES) {
                return res;
            }

            // exponential backoff, unless google tells us how long to wait
            const retryAfter = Number(res.headers.get("retry-after"));
            const delayMs =
                retryAfter > 0 ? retryAfter * 1000 : 2 ** attempt * 1000;
            logger.warn(
                `Directory sync: Google Workspace returned HTTP ${res.status}, retrying in ${delayMs}ms`
            );
            await new Promise((resolve) => setTimeout(resolve, delayMs));
        }
    }
}

async function mapWithConcurrency<T, R>(
    items: T[],
    concurrency: number,
    fn: (item: T) => Promise<R>
): Promise<R[]> {
    const results = new Array<R>(items.length);
    let nextIndex = 0;

    const worker = async () => {
        while (nextIndex < items.length) {
            const index = nextIndex++;
            results[index] = await fn(items[index]);
        }
    };

    await Promise.all(
        Array.from({ length: Math.min(concurrency, items.length) }, worker)
    );
    return results;
}
