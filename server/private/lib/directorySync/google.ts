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

import type {
    DirectoryFetchContext,
    DirectoryFetchResult,
    DirectorySyncProvider,
    DirectoryUser
} from "./types";
import { ensureValidIdp, type IdpDbResponse } from "./ensureValidIdp";

import { createSign } from "node:crypto";
import cache from "@server/lib/cache";
import logger from "@server/logger";
import { decryptDirectorySyncConfig } from "./config";
import z from "zod";
import {
    googleDirectorySyncConfigSchema,
    type GoogleDirectorySyncConfig
} from "@app/lib/idpDirectorySyncConfig";
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

export class GoogleDirectorySyncProvider implements DirectorySyncProvider {
    #TOKEN_CACHE_KEY_PREFIX = "googleDirectorySyncToken";
    #googleAPIBaseUrl = "https://admin.googleapis.com/admin/directory/v1";
    // number of groups whose members are fetched in parallel
    #MEMBERS_FETCH_CONCURRENCY = 5;
    // retries on rate limiting (429) and transient server errors (5xx)
    #MAX_RETRIES = 3;

    async fetch(ctx: DirectoryFetchContext): Promise<DirectoryFetchResult> {
        const directoryUsers: Record<string, DirectoryUser> = {};
        // 0. fetch idp and check that it is valid
        const idpRes = await ensureValidIdp(ctx.idpId, "google");
        const idpId = idpRes.idp.idpId;
        const syncConfig = this.#getSyncConfig(idpRes);
        const customer = syncConfig.customerId ?? "my_customer";

        // 1. get access token (and cache)
        const token = await this.#getToken(idpRes, syncConfig);

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

    #getSyncConfig(idpRes: IdpDbResponse): GoogleDirectorySyncConfig {
        try {
            return googleDirectorySyncConfigSchema.parse(
                decryptDirectorySyncConfig(idpRes.idp.directorySyncConfig)
            );
        } catch (e) {
            throw new Error(
                `Directory sync: invalid directory sync config for Google IdP ${idpRes.idp.idpId}: ${fromError(e).toString()}`,
                { cause: e }
            );
        }
    }

    async #getToken(
        idpRes: IdpDbResponse,
        syncConfig: GoogleDirectorySyncConfig
    ): Promise<string> {
        const cacheKey = `${this.#TOKEN_CACHE_KEY_PREFIX}:${idpRes.idp.idpId}`;
        const cached = await cache.get<string>(cacheKey);

        if (cached) {
            logger.info("Returning cached access token");
            return cached;
        }

        logger.info("Fetching fresh access token");
        const key = syncConfig.serviceAccountKey;

        const now = Math.floor(Date.now() / 1000);
        const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
        const claims = b64url(
            JSON.stringify({
                iss: key.client_email,
                sub: syncConfig.adminEmail, // only with domain-wide delegation
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
            const reason =
                body.error_description ??
                body.error ??
                res.statusText ??
                "no error details in response";
            throw new Error(
                `Directory sync: Google Workspace token request for IdP ${idpRes.idp.idpId} failed (HTTP ${res.status}): ${reason}`
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
