// Co-located plain-script tests for server/lib/oauth/clientAuth.ts — run directly with tsx, no test framework required:
//   NODE_ENV=development ENVIRONMENT=dev npx tsx server/lib/oauth/clientAuth.test.ts
// The "@server/db" import below must stay first: it settles a config<->db module-init cycle (without it this file crashes in logger on direct runs).

import { db, oauthClients, orgs } from "@server/db";
import { createHmac, generateKeyPairSync, randomUUID } from "crypto";
import jsonwebtoken from "jsonwebtoken";
import type { Request, Response } from "express";
import { eq, inArray } from "drizzle-orm";
import config from "@server/lib/config";
import { encrypt } from "@server/lib/crypto";
import { db, oauthClients, orgs } from "@server/db";
import HttpCode from "@server/types/HttpCode";
import { getIssuerUrl } from "@server/lib/oauth/issuer";
import { sendOAuthError } from "@server/routers/oauth/token";
import { assertEquals, assertEqualsObj } from "@test/assert";
import type { OAuthClientWithSecret } from "./clientAuth";
import { CLIENT_JWT_MAX_AGE_SECONDS } from "./lifetimes";
import {
    authenticateClient,
    constantTimeEquals,
    OAuthClientWithSecret
} from "./clientAuth";
import {
    parseBasicAuthString,
    getBodyValueFromRecords
} from "@server/lib/requestParams";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRequest(
    body: Record<string, unknown> | undefined,
    authorizationHeader?: string
): Request {
    const headers: Record<string, string> = {};
    if (authorizationHeader !== undefined) {
        headers.authorization = authorizationHeader;
    }
    return { body, headers } as unknown as Request;
}

class MockOAuthRes {
    statusCode = 0;
    jsonBody?: unknown;
    headers: Record<string, string> = {};

    status(code: number): this {
        this.statusCode = code;
        return this;
    }

    json(body: unknown): void {
        this.jsonBody = body;
    }

    setHeader(name: string, value: string): void {
        this.headers[name] = value;
    }
}

type AuthOutcome =
    | { kind: "success"; client: OAuthClientWithSecret }
    | { kind: "failure"; res: MockOAuthRes };

// Mirrors the exact call-site snippet in server/routers/oauth/token.ts and
// revoke.ts, so wire-level assertions below cover what real callers observe.
async function runClientAuth(req: Request): Promise<AuthOutcome> {
    try {
        const client = await authenticateClient(req);
        return { kind: "success", client };
    } catch {
        // Call sites log the error; tests assert on wire output only.
        const res = new MockOAuthRes();

        if (req.headers.authorization) {
            res.setHeader("WWW-Authenticate", "Basic");
        }
        sendOAuthError(res as unknown as Response, HttpCode.UNAUTHORIZED, {
            error: "invalid_client",
            error_description: "Invalid client credentials"
        });

        return { kind: "failure", res };
    }
}

function expectSuccess(
    outcome: AuthOutcome,
    expectedClientId: string,
    expectedStoredSecret?: string
): void {
    if (outcome.kind !== "success") {
        throw new Error(
            `expected success for ${expectedClientId}, got a failure`
        );
    }
    assertEquals(
        outcome.client.clientId,
        expectedClientId,
        "authenticated clientId"
    );

    if (expectedStoredSecret !== undefined) {
        assertEquals(
            outcome.client.storedSecret,
            expectedStoredSecret,
            "decrypted storedSecret exposed on the authenticated client"
        );
    }
}

function expectFailure(
    outcome: AuthOutcome,
    hadAuthorizationHeader: boolean
): void {
    if (outcome.kind !== "failure") {
        throw new Error("expected a wire failure but authentication succeeded");
    }
    const res = outcome.res;

    assertEquals(res.statusCode, HttpCode.UNAUTHORIZED, "status code");
    // The wire contract is intentionally uniform across every rejection reason.
    assertEqualsObj(
        res.jsonBody,
        {
            error: "invalid_client",
            error_description: "Invalid client credentials"
        },
        "failure body"
    );

    const wwwAuthenticate = res.headers["WWW-Authenticate"];
    if (hadAuthorizationHeader) {
        assertEquals(wwwAuthenticate, "Basic", "WWW-Authenticate header");
    } else if (wwwAuthenticate !== undefined) {
        throw new Error(
            "WWW-Authenticate must not be set when no Authorization header was sent"
        );
    }
}

const errorMessage = (error: unknown): string =>
    error instanceof Error ? error.message : String(error);

async function expectAuthError(
    req: Request,
    expectedMessage: string
): Promise<void> {
    try {
        await authenticateClient(req);
    } catch (error) {
        assertEquals(errorMessage(error), expectedMessage, "thrown message");
        return;
    }
    throw new Error(
        `expected error "${expectedMessage}" but authentication succeeded`
    );
}

function assertSyncError(fn: () => unknown, expectedMessage: string): void {
    try {
        fn();
    } catch (error) {
        assertEquals(errorMessage(error), expectedMessage, "thrown message");
        return;
    }
    throw new Error(`expected error "${expectedMessage}" but none was thrown`);
}

function basicAuthHeader(clientId: string, clientSecret: string): string {
    const encoded = Buffer.from(`${clientId}:${clientSecret}`).toString(
        "base64"
    );
    return `Basic ${encoded}`;
}

const nowSec = (): number => Math.floor(Date.now() / 1000);

function signHs256(claims: Record<string, unknown>, secret: string): string {
    return jsonwebtoken.sign(claims, secret) as string;
}

// This jsonwebtoken build's sign() rejects a `noTimestamps` option, so build a well-formed HS256 JWT by
// hand to exercise verify()'s "iat required when maxAge is specified" branch (payload has no iat/exp).
function handcraftedHs256(
    claims: Record<string, unknown>,
    secret: string
): string {
    const header = Buffer.from(
        JSON.stringify({ alg: "HS256", typ: "JWT" })
    ).toString("base64url");
    const payload = Buffer.from(JSON.stringify(claims)).toString("base64url");
    const signature = createHmac("sha256", secret)
        .update(`${header}.${payload}`)
        .digest("base64url");
    return `${header}.${payload}.${signature}`;
}

// ---------------------------------------------------------------------------
// parseBasicAuth (unit — pure function, no DB)
// ---------------------------------------------------------------------------

{
    const result = parseBasicAuthString(
        basicAuthHeader("client-abc", "s3cr3t")
    );
    assertEqualsObj(
        result,
        { clientId: "client-abc", clientSecret: "s3cr3t" },
        "valid Basic header"
    );

    // Non-Basic schemes no longer return null — they throw so the caller can map them to invalid_client.
    assertSyncError(
        () => parseBasicAuthString("Bearer abc"),
        "Invalid or missing Basic Authorization header"
    );
    assertSyncError(
        () => parseBasicAuthString(""),
        "Invalid or missing Basic Authorization header"
    );

    const noColon = `Basic ${Buffer.from("no-colon-here").toString("base64")}`;
    assertSyncError(
        () => parseBasicAuthString(noColon),
        "Failed to parse Basic Authorization header"
    );
}

// ---------------------------------------------------------------------------
// getBodyValueFromRecords (unit — pure function, no DB)
// ---------------------------------------------------------------------------

{
    assertEquals(
        getBodyValueFromRecords({ client_secret: "abc" }, "client_secret"),
        "abc",
        "string body value"
    );
    assertEquals(
        getBodyValueFromRecords({ other: "x" }, "client_secret"),
        undefined,
        "missing key returns undefined"
    );

    // Body values are strictly strings now — arrays and numbers no longer fall back to a member/coerce.
    assertEquals(
        getBodyValueFromRecords(
            { client_secret: ["a", "b"] } as Record<string, unknown>,
            "client_secret"
        ),
        undefined,
        "array value returns undefined"
    );
    assertEquals(
        getBodyValueFromRecords({ client_id: 123 }, "client_id"),
        undefined,
        "number value returns undefined"
    );
}

// ---------------------------------------------------------------------------
// constantTimeEquals (unit — pure function, no DB)
// ---------------------------------------------------------------------------

{
    const UNIT_CLIENT_ID = `auth-test-${nowSec()}`; // ~40 chars: exercises the length-mismatch path
    const UNIT_SECRET = "a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6";
    const SAME_LENGTH_DIFFERENT_CHAR = "A1B2C3D4E5F6G7H8I9J0K1L2M3N4O5P6";

    assertEquals(
        constantTimeEquals(UNIT_SECRET, UNIT_SECRET),
        true,
        "identical strings must match"
    );
    assertEquals(
        constantTimeEquals(SAME_LENGTH_DIFFERENT_CHAR, UNIT_SECRET),
        false,
        "same length, different content must not match"
    );

    // timingSafeEqual() throws on unequal lengths; the hash-both-sides implementation must never do so.
    const shortCandidate = "short";
    assertEquals(
        constantTimeEquals(shortCandidate, UNIT_SECRET),
        false,
        "length mismatch must return false without throwing"
    );

    // The comparison result depends only on content equality — not on which side is shorter/longer.
    assertEquals(
        constantTimeEquals(UNIT_SECRET, shortCandidate),
        false,
        "order of arguments does not matter"
    );
}

// ---------------------------------------------------------------------------
// DB-backed flows (sqlite dev database)
// ---------------------------------------------------------------------------

const runId = randomUUID();
const validClientId = `clientAuth-test-${runId}-valid`;
const disabledClientId = `clientAuth-test-${runId}-disabled`;
const nullCredClientId = `clientAuth-test-${runId}-nullcred`;
const brokenKeyClientId = `clientAuth-test-${runId}-brokenkey`;
const postClientId = `clientAuth-test-${runId}-post`;
const jwtClientId = `clientAuth-test-${runId}-jwt`;
const seededClientIds: string[] = [
    validClientId,
    disabledClientId,
    nullCredClientId,
    brokenKeyClientId,
    postClientId,
    jwtClientId,
];

// 32 chars — the canonical minimum for a client secret.
const validSecret = "a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6";
const wrongSameLengthSecret = "A1B2C3D4E5F6G7H8I9J0K1L2M3N4O5P6";

{
    const testOrgId = `clientAuth-test-org-${runId}`;
    // orgs.orgId is a PK — the seed must not collide with config's own org.
    await db
        .insert(orgs)
        .values({ orgId: testOrgId, name: "clientAuth-test-org" });

    async function insertClient(
        clientId: string,
        enabled: boolean,
        clientSecret: string | null
    ): Promise<void> {
        await db.insert(oauthClients).values({
            clientId,
            clientSecret,
            lastChars: "",
            clientName: `clientAuth test ${clientId}`,
            redirectUris: ["https://example.com/oauth/callback"],
            scopes: "openid profile email",
            pkceRequired: false,
            enabled,
            logoutTerminatesPangolinSession: false,
            orgId: testOrgId,
            createdAt: Date.now(),
            updatedAt: Date.now()
        });
    }

    try {
        await insertClient(
            validClientId,
            true,
            encrypt(validSecret, config.getRawConfig().server.secret!)
        );
        await insertClient(
            disabledClientId,
            false,
            encrypt(validSecret, config.getRawConfig().server.secret!)
        );
        // NULL secret — a legacy/unmigrated row that can never authenticate.
        await insertClient(nullCredClientId, true, null);

        // Corrupted/mismatched ciphertext column (e.g. after rotation ran against a key that never encrypted
        // these rows). This value has no "Salted__" prefix, so crypto-js derives the AES key/IV from a fresh
        // random salt on EVERY decrypt call: the result is nondeterministic — usually an empty string (tripping
        // getClientWithSecret's empty-result guard), occasionally a CryptoJS "Malformed UTF-8 data" throw.
        // Both paths fail closed with an explicit error → uniform 401 invalid_client on the wire.
        await insertClient(
            brokenKeyClientId,
            true,
            "corrupted-not-a-valid-ciphertext"
        );

        // --- Dispatch / credential-source selection -------------------------

        await expectAuthError(makeRequest({}), "Missing client credentials");

        {
            const assertion = signHs256(jwtClaimsFor(jwtClientId), validSecret);
            // A present client_assertion takes precedence over the Authorization header.
            const outcome = await runClientAuth(
                makeRequest(
                    { client_assertion: assertion },
                    basicAuthHeader(disabledClientId, "x")
                )
            );
            expectSuccess(outcome, jwtClientId, validSecret);
        }

        // Stricter than before: a non-Basic Authorization header now rejects the request instead of
        // falling through to POST body credentials.
        await expectAuthError(
            makeRequest(
                { client_id: validClientId, client_secret: validSecret },
                "Bearer x"
            ),
            "Invalid or missing Basic Authorization header"
        );

        // --- client_secret_basic -------------------------------------------

        {
            const outcome = await runClientAuth(
                makeRequest({}, basicAuthHeader(validClientId, validSecret))
            );
            expectSuccess(outcome, validClientId, validSecret);
        }

        await expectAuthError(
            makeRequest(
                {},
                basicAuthHeader(validClientId, wrongSameLengthSecret)
            ),
            "client_secret_basic: Invalid client credentials"
        );

        // Length mismatch must not throw out of the comparison itself.
        await expectAuthError(
            makeRequest({}, basicAuthHeader(validClientId, "tooshort")),
            "client_secret_basic: Invalid client credentials"
        );

        const unknownBasicId = `clientAuth-test-${runId}-unknown`;
        await expectAuthError(
            makeRequest({}, basicAuthHeader(unknownBasicId, validSecret)),
            "Client not found or disabled"
        );

        // Disabled and NULL-secret rows are indistinguishable from unknown clients.
        await expectAuthError(
            makeRequest({}, basicAuthHeader(disabledClientId, validSecret)),
            "Client not found or disabled"
        );
        await expectAuthError(
            makeRequest({}, basicAuthHeader(nullCredClientId, validSecret)),
            "Client not found or disabled"
        );

        // Corrupted-ciphertext row: decryption of unsalted garbage is nondeterministic (random salt per call) —
        // either "" via the empty-result guard or a caught CryptoJS throw; both map to this explicit error,
        // still a uniform 401 invalid_client on the wire.
        await expectAuthError(
            makeRequest({}, basicAuthHeader(brokenKeyClientId, validSecret)),
            "Failed to decrypt client secret"
        );

        // --- client_secret_post --------------------------------------------

        {
            const outcome = await runClientAuth(
                makeRequest({
                    client_id: postClientId,
                    client_secret: validSecret
                })
            );
            expectSuccess(outcome, postClientId, validSecret);
        }

        // No Authorization header and no client_assertion → dispatch falls through to "missing credentials"
        // before the post-mode guard can fire.
        await expectAuthError(
            makeRequest({ client_id: validClientId }),
            "Missing client credentials"
        );

        // The post-mode guard still fires when a secret is present but no client_id.
        await expectAuthError(
            makeRequest({ client_secret: validSecret }),
            "client_secret_post: Missing client_id or client_secret in request body"
        );

        const unknownPostId = `clientAuth-test-${runId}-unknownpost`;
        await expectAuthError(
            makeRequest({
                client_id: unknownPostId,
                client_secret: validSecret
            }),
            "Client not found or disabled"
        );

        // --- client_secret_jwt ---------------------------------------------

        {
            const outcome = await runClientAuth(
                makeRequest({
                    client_assertion: signHs256(
                        jwtClaimsFor(jwtClientId),
                        validSecret
                    )
                })
            );
            expectSuccess(outcome, jwtClientId, validSecret);
        }

        {
            // Explicit matching client_id + a (deliberately ignored) assertion_type.
            const outcome = await runClientAuth(
                makeRequest({
                    client_assertion: signHs256(
                        jwtClaimsFor(jwtClientId),
                        validSecret
                    ),
                    client_id: jwtClientId,
                    client_assertion_type:
                        "urn:ietf:params:oauth:client-assertion-type:jwt-bearer"
                })
            );
            expectSuccess(outcome, jwtClientId);
        }

        await expectAuthError(
            makeRequest({ client_assertion: "not-a-jwt" }),
            "client_secret_jwt: not a valid JWT"
        );

        {
            const mismatched = jwtClaimsFor(validClientId);
            delete mismatched.sub;
            await expectAuthError(
                makeRequest({
                    client_assertion: signHs256(mismatched, validSecret)
                }),
                "client_secret_jwt: iss and/or sub claims invalid"
            );

            const noIss = jwtClaimsFor(validClientId);
            delete noIss.iss;
            await expectAuthError(
                makeRequest({
                    client_assertion: signHs256(noIss, validSecret)
                }),
                "client_secret_jwt: iss and/or sub claims invalid"
            );

            const crossSubject = jwtClaimsFor(validClientId);
            crossSubject.sub = `clientAuth-test-${runId}-other`;
            await expectAuthError(
                makeRequest({
                    client_assertion: signHs256(crossSubject, validSecret)
                }),
                "client_secret_jwt: iss and/or sub claims invalid"
            );
        }

        // Form-level client_id must match the assertion's issuer when present.
        await expectAuthError(
            makeRequest({
                client_assertion: signHs256(
                    jwtClaimsFor(validClientId),
                    validSecret
                ),
                client_id: `clientAuth-test-${runId}-mismatch`
            }),
            "client_secret_jwt: client_id does not match client_assertion"
        );

        const wrongJwtKey = "fedcba9876543210fedcba9876543210";
        await expectAuthError(
            makeRequest({
                client_assertion: signHs256(
                    jwtClaimsFor(jwtClientId),
                    wrongJwtKey
                )
            }),
            "client_secret_jwt: failed to verify JWT"
        );

        {
            const expired = jwtClaimsFor(jwtClientId);
            // Far outside the 30-second clockTolerance window.
            expired.iat = nowSec() - 7200;
            expired.exp = nowSec() - 3600;
            await expectAuthError(
                makeRequest({
                    client_assertion: signHs256(expired, validSecret)
                }),
                "client_secret_jwt: failed to verify JWT"
            );

            const tooOld = jwtClaimsFor(jwtClientId);
            // iat is far beyond maxAge (even with clockTolerance), exp still in the future.
            tooOld.iat = nowSec() - CLIENT_JWT_MAX_AGE_SECONDS * 10;
            tooOld.exp = nowSec() + 600;
            await expectAuthError(
                makeRequest({
                    client_assertion: signHs256(tooOld, validSecret)
                }),
                "client_secret_jwt: failed to verify JWT"
            );

            // No iat/exp in the payload at all — maxAge verification requires iat.
            const noTimestampsClaims = jwtClaimsFor(jwtClientId);
            delete noTimestampsClaims.iat;
            delete noTimestampsClaims.exp;
            await expectAuthError(
                makeRequest({
                    client_assertion: handcraftedHs256(
                        noTimestampsClaims,
                        validSecret
                    )
                }),
                "client_secret_jwt: failed to verify JWT"
            );

            // Missing aud fails closed against the audience option.
            const missingAud = jwtClaimsFor(jwtClientId);
            delete missingAud.aud;
            await expectAuthError(
                makeRequest({
                    client_assertion: signHs256(missingAud, validSecret)
                }),
                "client_secret_jwt: failed to verify JWT"
            );

            // Standard jsonwebtoken containment semantics: an aud array containing the identifier is accepted.
            const multiAud = jwtClaimsFor(jwtClientId);
            (multiAud.aud as string[]).push("some-other-audience");
            const outcome = await runClientAuth(
                makeRequest({
                    client_assertion: signHs256(multiAud, validSecret)
                })
            );
            expectSuccess(outcome, jwtClientId);
        }

        // Unknown issuer → DB lookup runs before signature verification.
        {
            const unknownIssuerClaims = jwtClaimsFor(
                `clientAuth-test-${runId}-unknownjwt`
            );
            await expectAuthError(
                makeRequest({
                    client_assertion: signHs256(
                        unknownIssuerClaims,
                        validSecret
                    )
                }),
                "Client not found or disabled"
            );
        }

        // alg=none tokens are rejected because the verifier only allows HS256.
        {
            const header = Buffer.from(
                JSON.stringify({ alg: "none", typ: "JWT" })
            ).toString("base64url");
            const payload = Buffer.from(
                JSON.stringify(jwtClaimsFor(jwtClientId))
            ).toString("base64url");
            await expectAuthError(
                makeRequest({ client_assertion: `${header}.${payload}.` }),
                "client_secret_jwt: failed to verify JWT"
            );
        }

        // RS256-signed tokens are rejected (HS256-only allowlist) — no algorithm confusion.
        {
            const { privateKey } = generateKeyPairSync("rsa", {
                modulusLength: 2048
            });
            const rsaToken = jsonwebtoken.sign(
                jwtClaimsFor(jwtClientId),
                privateKey,
                {
                    algorithm: "RS256"
                }
            ) as string;
            await expectAuthError(
                makeRequest({ client_assertion: rsaToken }),
                "client_secret_jwt: failed to verify JWT"
            );
        }

        // --- Wire contract (mirrors token.ts / revoke.ts call sites) --------

        {
            const outcome = await runClientAuth(
                makeRequest(
                    {},
                    basicAuthHeader(validClientId, wrongSameLengthSecret)
                )
            );
            expectFailure(outcome, true);
        }

        {
            // No Authorization header → no WWW-Authenticate on the wire.
            const outcome = await runClientAuth(
                makeRequest({ client_secret: validSecret })
            );
            expectFailure(outcome, false);
        }

        {
            const expired = jwtClaimsFor(jwtClientId);
            expired.iat = nowSec() - 7200;
            expired.exp = nowSec() - 3600;
            const outcome = await runClientAuth(
                makeRequest({
                    client_assertion: signHs256(expired, validSecret)
                })
            );
            expectFailure(outcome, false);
        }

        {
            // Present (unparseable-as-Basic) Authorization header → WWW-Authenticate is echoed.
            const outcome = await runClientAuth(makeRequest({}, "Bearer abc"));
            expectFailure(outcome, true);
        }

        await db
            .delete(oauthClients)
            .where(inArray(oauthClients.clientId, seededClientIds));
    } finally {
        await db.delete(orgs).where(eq(orgs.orgId, testOrgId));
    }
}

// jwtClaimsFor is declared after the block that uses it — hoisted function declaration.
function jwtClaimsFor(clientId: string): Record<string, unknown> {
    return {
        iss: clientId,
        sub: clientId,
        aud: [getIssuerUrl()],
        iat: nowSec(),
        exp: nowSec() + 60
    };
}

console.log("clientAuth.test.ts passed");
