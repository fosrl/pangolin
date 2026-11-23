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
 * Runs the token step, then the read steps in parallel. Steps never throw: a
 * failure is reported on its check so every permission problem shows at once.
 */
export async function runApiIntegrationTest({
    getToken,
    readUsers,
    readGroups
}: {
    getToken: () => Promise<string>;
    readUsers: (token: string) => Promise<void>;
    readGroups: (token: string) => Promise<void>;
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
        read: (token: string) => Promise<void>
    ): Promise<IdpApiTestCheck> => {
        try {
            await read(token);
            return { check, ok: true };
        } catch (e) {
            return { check, ok: false, error: errorMessage(e) };
        }
    };

    const checks: IdpApiTestCheck[] = [
        { check: "token", ok: true },
        ...(await Promise.all([
            run("users", readUsers),
            run("groups", readGroups)
        ]))
    ];
    return { ok: checks.every((c) => c.ok), checks };
}

/** GETs a provider URL, throwing with the provider's error message on a non-2xx. */
export async function readOrThrow(
    url: string,
    token: string,
    label: string,
    reasonOf: (body: any) => string | undefined
): Promise<void> {
    const res = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` }
    });
    if (res.ok) {
        return;
    }
    const body: any = await res.json().catch(() => ({}));
    throw new Error(
        `${label} request failed (HTTP ${res.status}): ${reasonOf(body) ?? res.statusText ?? "no error details in response"}`
    );
}
