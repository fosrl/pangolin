import { assertEquals, assertEqualsObj } from "@test/assert";
import {
    buildAuditLogEntry,
    extractUserAgent,
    redactSensitiveHeaders,
    type LogRequestAuditBody,
    type LogRequestAuditData
} from "./auditLogEntry";

function baseBody(
    overrides: Partial<LogRequestAuditBody> = {}
): LogRequestAuditBody {
    return {
        path: "/",
        originalRequestURL: "https://app.example.com/",
        scheme: "https",
        host: "app.example.com",
        method: "GET",
        tls: true,
        ...overrides
    };
}

function baseData(
    overrides: Partial<LogRequestAuditData> = {}
): LogRequestAuditData {
    return {
        action: true,
        reason: 100,
        resourceId: 1,
        orgId: "org_1",
        ...overrides
    };
}

function runTests() {
    // extractUserAgent

    assertEquals(
        extractUserAgent({ "user-agent": "Mozilla/5.0" }),
        "Mozilla/5.0",
        "Lowercase user-agent header should be extracted"
    );
    assertEquals(
        extractUserAgent({ "User-Agent": "curl/8.1.2" }),
        "curl/8.1.2",
        "Header lookup should be case-insensitive"
    );
    assertEquals(
        extractUserAgent({ Accept: "*/*" }),
        undefined,
        "Headers without a User-Agent key should return undefined"
    );
    assertEquals(
        extractUserAgent(undefined),
        undefined,
        "Missing headers object should return undefined, not throw"
    );

    // buildAuditLogEntry: this is the regression this PR fixes -
    // userAgent/headers/query used to be silently dropped even though the
    // schema and the read-side query already expected them.

    const requestHeaders = {
        "user-agent": "Mozilla/5.0 (X11; Linux x86_64)",
        accept: "text/html"
    };
    const requestQuery = { redirect: "/dashboard" };

    const entry = buildAuditLogEntry(
        baseData(),
        baseBody({ headers: requestHeaders, query: requestQuery }),
        "203.0.113.10"
    );

    assertEquals(
        entry.userAgent,
        "Mozilla/5.0 (X11; Linux x86_64)",
        "buildAuditLogEntry should populate userAgent from request headers"
    );
    assertEquals(
        entry.headers,
        JSON.stringify(requestHeaders),
        "buildAuditLogEntry should persist the raw headers as JSON"
    );
    assertEquals(
        entry.query,
        JSON.stringify(requestQuery),
        "buildAuditLogEntry should persist the raw query params as JSON"
    );
    assertEquals(
        entry.ip,
        "203.0.113.10",
        "buildAuditLogEntry should keep using the pre-resolved client IP"
    );

    // When the caller has no headers/query at all (e.g. no-auth allow path),
    // the new fields should stay undefined rather than throwing on
    // JSON.stringify(undefined).

    const bareEntry = buildAuditLogEntry(baseData(), baseBody(), undefined);
    assertEquals(
        bareEntry.userAgent,
        undefined,
        "userAgent should be undefined when no headers were supplied"
    );
    assertEquals(
        bareEntry.headers,
        undefined,
        "headers should be undefined when no headers were supplied"
    );
    assertEquals(
        bareEntry.query,
        undefined,
        "query should be undefined when no query params were supplied"
    );

    // Existing actor-resolution behavior must be unchanged by the refactor.

    const userEntry = buildAuditLogEntry(
        baseData({
            user: { username: "alice", userId: "user_1" },
            apiKey: undefined
        }),
        baseBody(),
        undefined
    );
    assertEquals(userEntry.actorType, "user", "User actor type preserved");
    assertEquals(userEntry.actor, "alice", "User actor name preserved");
    assertEquals(userEntry.actorId, "user_1", "User actor id preserved");

    const apiKeyEntry = buildAuditLogEntry(
        baseData({ apiKey: { name: "CI key", apiKeyId: "ak_1" } }),
        baseBody(),
        undefined
    );
    assertEquals(
        apiKeyEntry.actorType,
        "apiKey",
        "API key actor type preserved"
    );
    assertEquals(apiKeyEntry.actor, "CI key", "API key actor name preserved");

    // Headers/query are attacker-controlled input that is now persisted to
    // the DB for the first time - prove sanitizeString is still applied to
    // the serialized JSON so a malicious header can't inject a null byte.
    // (Built via String.fromCharCode so the source file itself stays plain
    // text - an embedded raw NUL byte makes git/GitHub treat the file as
    // binary and hide the diff.)

    const nullByte = String.fromCharCode(0);
    const maliciousEntry = buildAuditLogEntry(
        baseData(),
        baseBody({ headers: { "x-evil": `value${nullByte}withNull` } }),
        undefined
    );
    assertEquals(
        maliciousEntry.headers?.includes(nullByte),
        false,
        "Null bytes in header values must be stripped before persisting"
    );

    // Credential-bearing headers must never reach the DB in plaintext - the
    // audit log is for investigating requests, not a second place session
    // cookies/API keys get stored.

    assertEqualsObj(
        redactSensitiveHeaders({
            Cookie: "session=super-secret-token",
            Authorization: "Bearer abc123",
            "user-agent": "Mozilla/5.0"
        }),
        {
            Cookie: "[REDACTED]",
            Authorization: "[REDACTED]",
            "user-agent": "Mozilla/5.0"
        },
        "Cookie/Authorization should be redacted case-insensitively; unrelated headers untouched"
    );

    const sessionEntry = buildAuditLogEntry(
        baseData(),
        baseBody({
            headers: {
                cookie: "session=super-secret-token",
                "user-agent": "Mozilla/5.0"
            }
        }),
        undefined
    );
    assertEquals(
        sessionEntry.headers?.includes("super-secret-token"),
        false,
        "buildAuditLogEntry must not persist a live session cookie value"
    );
    assertEquals(
        sessionEntry.userAgent,
        "Mozilla/5.0",
        "userAgent extraction should be unaffected by header redaction"
    );

    console.log("All request audit log entry tests passed!");
    console.log(
        "Example row now written to requestAuditLog:\n" +
            JSON.stringify(entry, null, 2)
    );
}

try {
    runTests();
} catch (error) {
    console.error("Request audit log entry test failed:", error);
    process.exit(1);
}
