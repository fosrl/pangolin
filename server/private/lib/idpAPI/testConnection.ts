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

import type { IdpApiTestCheck, IdpApiTestResult } from "./types";

function errorMessage(e: unknown): string {
    return e instanceof Error ? e.message : String(e);
}

/**
 * Runs the token step, then the read steps in parallel, then the sign-in group
 * lookup on the first user read (skipped when there's none). Steps never throw:
 * a failure is reported on its check so every permission problem shows at once.
 */
export async function runApiIntegrationTest({
    getToken,
    readUsers,
    readGroups,
    readUserGroups
}: {
    getToken: () => Promise<string>;
    /** Returns the ID of the first user, for `readUserGroups`. */
    readUsers: (token: string) => Promise<string | undefined>;
    readGroups: (token: string) => Promise<void>;
    readUserGroups: (token: string, userId: string) => Promise<void>;
}): Promise<IdpApiTestResult> {
    let token: string;
    try {
        token = await getToken();
    } catch (e) {
        return {
            ok: false,
            checks: [{ check: "token", ok: false, error: errorMessage(e) }]
        };
    }

    const run = async (
        check: IdpApiTestCheck["check"],
        read: () => Promise<unknown>
    ): Promise<IdpApiTestCheck> => {
        try {
            await read();
            return { check, ok: true };
        } catch (e) {
            return { check, ok: false, error: errorMessage(e) };
        }
    };

    let firstUserId: string | undefined;
    const checks: IdpApiTestCheck[] = [
        { check: "token", ok: true },
        ...(await Promise.all([
            run("users", async () => {
                firstUserId = await readUsers(token);
            }),
            run("groups", () => readGroups(token))
        ]))
    ];
    if (firstUserId) {
        const userId = firstUserId;
        checks.push(
            await run("userGroups", () => readUserGroups(token, userId))
        );
    }
    return { ok: checks.every((c) => c.ok), checks };
}

/** GETs a provider URL and returns the JSON body, throwing with the provider's error message on a non-2xx. */
export async function readOrThrow(
    url: string,
    token: string,
    label: string,
    reasonOf: (body: any) => string | undefined
): Promise<any> {
    const res = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` }
    });
    const body: any = await res.json().catch(() => ({}));
    if (res.ok) {
        return body;
    }
    throw new Error(
        `${label} request failed (HTTP ${res.status}): ${reasonOf(body) ?? res.statusText ?? "no error details in response"}`
    );
}
