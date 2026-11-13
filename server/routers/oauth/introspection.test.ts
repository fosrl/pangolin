// RFC 7662 introspection leak-rule matrix for server/routers/oauth/introspection.ts
// This file is the ONLY enforcement of the leak contract: every absent/expired/revoked/cross-client answer must be exactly {"active":false} — one member, no reason text.

import { randomUUID } from "node:crypto";
import type { Request, Response } from "express";
import {
    db,
    oauthAccessTokens,
    oauthClients,
    oauthRefreshTokens,
    orgs,
    users
} from "@server/db";
import { hashToken } from "@server/lib/oauth/tokens";
import { introspectToken } from "./introspection";
import { assertEquals, assertEqualsObj } from "@test/assert";

let rows = 0;
const ENABLE_LOGGING = false;

function reportTestFailure(reason: unknown): never {
    console.error("TEST FAILURE:", reason);
    process.exit(1);
}
process.prependListener("uncaughtException", (err) => reportTestFailure(err));
process.prependListener("unhandledRejection", (err) => reportTestFailure(err));

class MockOAuthRes {
    statusCode = 200;
    body: unknown = undefined;
    headers: Record<string, string> = {};
    status(code: number): this {
        this.statusCode = code;
        return this;
    }
    json(b: unknown): this {
        this.body = JSON.parse(JSON.stringify(b));
        return this;
    }
    send(b: unknown): this {
        if (typeof b === "string") {
            try {
                this.body = JSON.parse(b);
            } catch {
                this.body = b;
            }
        } else {
            this.body = b;
        }
        return this;
    }
    setHeader(name: string, value: string): void {
        this.headers[name] = value;
    }
}

function makeRequest(body: Record<string, string>, clientId?: string): Request {
    const req: Record<string, unknown> = { body, headers: {} };
    if (clientId !== undefined) {
        req.oauthClient = { clientId };
    }
    return req as unknown as Request;
}

async function runRow(
    label: string,
    body: Record<string, string>,
    clientId?: string
): Promise<MockOAuthRes> {
    ++rows;
    const res = new MockOAuthRes();
    await introspectToken(
        makeRequest(body, clientId),
        res as unknown as Response
    );
    if (ENABLE_LOGGING) {
        console.log(
            "row " +
                label +
                ": status=" +
                res.statusCode +
                " body=" +
                JSON.stringify(res.body)
        );
    }
    return res;
}

// leak rule: HTTP 200, exactly one member, no-store header pair.
async function expectInactive(
    label: string,
    body: Record<string, string>,
    clientId?: string
): Promise<void> {
    const res = await runRow(label, body, clientId);
    assertEquals(res.statusCode, 200, label + ": status");
    assertEquals(
        res.headers["Cache-Control"],
        "no-store",
        label + ": Cache-Control"
    );
    assertEquals(res.headers["Pragma"], "no-cache", label + ": Pragma");
    const keys = Object.keys((res.body ?? {}) as Record<string, unknown>);
    assertEquals(
        keys.length,
        1,
        label + ": inactive body must have exactly one member (leak rule)"
    );
    assertEqualsObj(res.body, { active: false }, label + ": inactive body");
}

// claim shape + emission order for a live row.
async function expectActive(
    label: string,
    body: Record<string, string>,
    clientId: string,
    expected: Record<string, unknown>
): Promise<void> {
    const res = await runRow(label, body, clientId);
    assertEquals(res.statusCode, 200, label + ": status");
    assertEquals(
        res.headers["Cache-Control"],
        "no-store",
        label + ": Cache-Control"
    );
    assertEquals(res.headers["Pragma"], "no-cache", label + ": Pragma");
    const actual = (res.body ?? {}) as Record<string, unknown>;
    assertEqualsObj(actual, expected, label + ": active body deep-equal");
    assertEquals(
        Object.keys(actual).join(","),
        Object.keys(expected).join(","),
        label + ": claim emission order"
    );
}

async function main(): Promise<void> {
    const runSuffix = randomUUID();
    const now = Date.now();
    const future = now + 3_600_000;
    const past = now - 60_000;
    const createdAt = now - 60_000;

    // Fixtures: unique per run (org → clients → users → token rows), so no cleanup is needed.
    const testOrgId = "introspection-test-org-" + runSuffix;
    await db
        .insert(orgs)
        .values({ orgId: testOrgId, name: "introspection-test-org" });

    const clientA = "client-a-" + runSuffix;
    const clientB = "client-b-" + runSuffix;
    for (const clientId of [clientA, clientB]) {
        await db.insert(oauthClients).values({
            clientId,
            clientSecret: null,
            lastChars: "",
            clientName: "introspection test " + clientId,
            redirectUris: ["https://example.com/oauth/callback"],
            scopes: "openid profile email",
            pkceRequired: false,
            enabled: true,
            logoutTerminatesPangolinSession: false,
            orgId: testOrgId,
            createdAt: Date.now(),
            updatedAt: Date.now(),
            clientAuthenticationMethod: "client_secret_basic"
        });
    }

    const userA = "user-a-" + runSuffix;
    const userB = "user-b-" + runSuffix;
    const userC = "user-c-" + runSuffix;
    for (const userId of [userA, userB, userC]) {
        await db.insert(users).values({
            userId,
            email: userId + "@example.com",
            username: userId,
            type: "internal",
            dateCreated: new Date().toISOString()
        });
    }

    async function insertAccessToken(over: {
        clientId: string;
        userId: string;
        scope: string;
        expiresAt: number;
    }): Promise<string> {
        const raw = "at-" + randomUUID();
        await db.insert(oauthAccessTokens).values({
            accessTokenId: randomUUID(),
            grantId: randomUUID(),
            tokenHash: hashToken(raw),
            clientId: over.clientId,
            userId: over.userId,
            scope: over.scope,
            expiresAt: over.expiresAt,
            createdAt
        });
        return raw;
    }

    async function insertRefreshToken(over: {
        clientId: string;
        userId: string;
        scope: string;
        expiresAt: number;
        revokedAt?: number | null;
    }): Promise<string> {
        const raw = "rt-" + randomUUID();
        await db.insert(oauthRefreshTokens).values({
            refreshTokenId: randomUUID(),
            grantId: randomUUID(),
            tokenHash: hashToken(raw),
            clientId: over.clientId,
            userId: over.userId,
            scope: over.scope,
            expiresAt: over.expiresAt,
            revokedAt: over.revokedAt ?? null,
            createdAt
        });
        return raw;
    }

    const accessFull = await insertAccessToken({
        clientId: clientA,
        userId: userA,
        scope: "openid profile email",
        expiresAt: future
    });
    const refreshLive = await insertRefreshToken({
        clientId: clientA,
        userId: userC,
        scope: "openid",
        expiresAt: future,
        revokedAt: null
    });
    const accessOtherClient = await insertAccessToken({
        clientId: clientB,
        userId: userC,
        scope: "openid",
        expiresAt: future
    });
    const accessExpired = await insertAccessToken({
        clientId: clientA,
        userId: userB,
        scope: "offline_access",
        expiresAt: past
    });
    const refreshRevoked = await insertRefreshToken({
        clientId: clientA,
        userId: userB,
        scope: "",
        expiresAt: future,
        revokedAt: past
    });

    // full claim set + emission order.
    await expectActive(
        "A access-full no-hint",
        { token: accessFull },
        clientA,
        {
            active: true,
            client_id: clientA,
            scope: "openid profile email",
            sub: userA,
            exp: Math.floor(future / 1000),
            iat: Math.floor(createdAt / 1000)
        }
    );

    // fallback: refresh row found via no-hint second lookup.
    await expectActive(
        "B refresh-live no-hint (fallback)",
        { token: refreshLive },
        clientA,
        {
            active: true,
            client_id: clientA,
            scope: "openid",
            sub: userC,
            exp: Math.floor(future / 1000),
            iat: Math.floor(createdAt / 1000)
        }
    );

    // explicit matching hint.
    await expectActive(
        "C access-full hint=access_token",
        { token: accessFull, token_type_hint: "access_token" },
        clientA,
        {
            active: true,
            client_id: clientA,
            scope: "openid profile email",
            sub: userA,
            exp: Math.floor(future / 1000),
            iat: Math.floor(createdAt / 1000)
        }
    );

    // cross-client: row belongs to client-b, caller is client-a — opaque inactive, never an error.
    await expectInactive(
        "D cross-client",
        { token: accessOtherClient },
        clientA
    );

    // expired access.
    await expectInactive("E expired-access", { token: accessExpired }, clientA);

    // revoked refresh (revokedAt set).
    await expectInactive(
        "F revoked-refresh",
        { token: refreshRevoked },
        clientA
    );

    // Absent token, both tables searched — opaque inactive.
    await expectInactive(
        "G absent-token no-hint",
        { token: "at-" + randomUUID() },
        clientA
    );

    // Unknown non-null hint is treated as no hint — fallback still finds the live refresh row.
    await expectActive(
        "H refresh-live unknown-hint=id_token",
        { token: refreshLive, token_type_hint: "id_token" },
        clientA,
        {
            active: true,
            client_id: clientA,
            scope: "openid",
            sub: userC,
            exp: Math.floor(future / 1000),
            iat: Math.floor(createdAt / 1000)
        }
    );

    // the one non-200 path in this handler.
    {
        const res = await runRow("I missing-token", {}, clientA);
        assertEquals(res.statusCode, 400, "I: status");
        assertEqualsObj(
            res.body,
            {
                error: "invalid_request",
                error_description: "Missing required parameter 'token'"
            },
            "I: body"
        );
    }

    console.log(`PASS introspection.test.ts (${rows} rows)`);
    setTimeout(() => process.exit(0), 50);
}

main().catch(reportTestFailure);
