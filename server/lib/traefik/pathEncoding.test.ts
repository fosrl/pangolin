import { assertEquals } from "../../../test/assert";
import { buildResourceRouterKey, encodePath as realEncodePath } from "./utils";

// ── Pure function copies (inlined to avoid pulling in server dependencies) ──

function sanitize(input: string | null | undefined): string | undefined {
    if (!input) return undefined;
    if (input.length > 50) {
        input = input.substring(0, 50);
    }
    return input
        .replace(/[^a-zA-Z0-9-]/g, "-")
        .replace(/-+/g, "-")
        .replace(/^-|-$/g, "");
}

function encodePath(path: string | null | undefined): string {
    if (!path) return "";
    return path.replace(/[^a-zA-Z0-9]/g, (ch) => {
        return ch.charCodeAt(0).toString(16);
    });
}

// ── Helpers ──────────────────────────────────────────────────────────

/**
 * Exact replica of the OLD key computation from upstream main.
 * Uses sanitize() for paths - this is what had the collision bug.
 */
function oldKeyComputation(
    resourceId: number,
    path: string | null,
    pathMatchType: string | null,
    rewritePath: string | null,
    rewritePathType: string | null
): string {
    const targetPath = sanitize(path) || "";
    const pmt = pathMatchType || "";
    const rp = rewritePath || "";
    const rpt = rewritePathType || "";
    const pathKey = [targetPath, pmt, rp, rpt].filter(Boolean).join("-");
    const mapKey = [resourceId, pathKey].filter(Boolean).join("-");
    return sanitize(mapKey) || "";
}

/**
 * Replica of the NEW key computation from our fix.
 * Uses encodePath() for paths - collision-free.
 */
function newKeyComputation(
    resourceId: number,
    path: string | null,
    pathMatchType: string | null,
    rewritePath: string | null,
    rewritePathType: string | null
): string {
    const targetPath = encodePath(path);
    const pmt = pathMatchType || "";
    const rp = rewritePath || "";
    const rpt = rewritePathType || "";
    const pathKey = [targetPath, pmt, rp, rpt].filter(Boolean).join("-");
    const mapKey = [resourceId, pathKey].filter(Boolean).join("-");
    return sanitize(mapKey) || "";
}

// ── Tests ────────────────────────────────────────────────────────────

function runTests() {
    console.log("Running path encoding tests...\n");

    let passed = 0;

    // ── encodePath unit tests ────────────────────────────────────────

    // Test 1: null/undefined/empty
    {
        assertEquals(encodePath(null), "", "null should return empty");
        assertEquals(
            encodePath(undefined),
            "",
            "undefined should return empty"
        );
        assertEquals(encodePath(""), "", "empty string should return empty");
        console.log("  PASS: encodePath handles null/undefined/empty");
        passed++;
    }

    // Test 2: root path
    {
        assertEquals(encodePath("/"), "2f", "/ should encode to 2f");
        console.log("  PASS: encodePath encodes root path");
        passed++;
    }

    // Test 3: alphanumeric passthrough
    {
        assertEquals(encodePath("/api"), "2fapi", "/api encodes slash only");
        assertEquals(encodePath("/v1"), "2fv1", "/v1 encodes slash only");
        assertEquals(encodePath("abc"), "abc", "plain alpha passes through");
        console.log("  PASS: encodePath preserves alphanumeric chars");
        passed++;
    }

    // Test 4: all special chars produce unique hex
    {
        const paths = ["/a/b", "/a-b", "/a.b", "/a_b", "/a b"];
        const results = paths.map((p) => encodePath(p));
        const unique = new Set(results);
        assertEquals(
            unique.size,
            paths.length,
            "all special-char paths must produce unique encodings"
        );
        console.log(
            "  PASS: encodePath produces unique output for different special chars"
        );
        passed++;
    }

    // Test 5: output is always alphanumeric (safe for Traefik names)
    {
        const paths = [
            "/",
            "/api",
            "/a/b",
            "/a-b",
            "/a.b",
            "/complex/path/here"
        ];
        for (const p of paths) {
            const e = encodePath(p);
            assertEquals(
                /^[a-zA-Z0-9]+$/.test(e),
                true,
                `encodePath("${p}") = "${e}" must be alphanumeric`
            );
        }
        console.log("  PASS: encodePath output is always alphanumeric");
        passed++;
    }

    // Test 6: deterministic
    {
        assertEquals(
            encodePath("/api"),
            encodePath("/api"),
            "same input same output"
        );
        assertEquals(
            encodePath("/a/b/c"),
            encodePath("/a/b/c"),
            "same input same output"
        );
        console.log("  PASS: encodePath is deterministic");
        passed++;
    }

    // Test 7: many distinct paths never collide
    {
        const paths = [
            "/",
            "/api",
            "/api/v1",
            "/api/v2",
            "/a/b",
            "/a-b",
            "/a.b",
            "/a_b",
            "/health",
            "/health/check",
            "/admin",
            "/admin/users",
            "/api/v1/users",
            "/api/v1/posts",
            "/app",
            "/app/dashboard"
        ];
        const encoded = new Set(paths.map((p) => encodePath(p)));
        assertEquals(
            encoded.size,
            paths.length,
            `expected ${paths.length} unique encodings, got ${encoded.size}`
        );
        console.log("  PASS: 16 realistic paths all produce unique encodings");
        passed++;
    }

    // ── Collision fix: the actual bug we're fixing ───────────────────

    // Test 8: /a/b and /a-b now have different keys (THE BUG FIX)
    {
        const keyAB = newKeyComputation(1, "/a/b", "prefix", null, null);
        const keyDash = newKeyComputation(1, "/a-b", "prefix", null, null);
        assertEquals(
            keyAB !== keyDash,
            true,
            "/a/b and /a-b MUST have different keys"
        );
        console.log("  PASS: collision fix - /a/b vs /a-b have different keys");
        passed++;
    }

    // Test 9: demonstrate the old bug - old code maps /a/b and /a-b to same key
    {
        const oldKeyAB = oldKeyComputation(1, "/a/b", "prefix", null, null);
        const oldKeyDash = oldKeyComputation(1, "/a-b", "prefix", null, null);
        assertEquals(
            oldKeyAB,
            oldKeyDash,
            "old code MUST have this collision (confirms the bug exists)"
        );
        console.log("  PASS: confirmed old code bug - /a/b and /a-b collided");
        passed++;
    }

    // Test 10: /api/v1 and /api-v1 - old code collision, new code fixes it
    {
        const oldKey1 = oldKeyComputation(1, "/api/v1", "prefix", null, null);
        const oldKey2 = oldKeyComputation(1, "/api-v1", "prefix", null, null);
        assertEquals(
            oldKey1,
            oldKey2,
            "old code collision for /api/v1 vs /api-v1"
        );

        const newKey1 = newKeyComputation(1, "/api/v1", "prefix", null, null);
        const newKey2 = newKeyComputation(1, "/api-v1", "prefix", null, null);
        assertEquals(
            newKey1 !== newKey2,
            true,
            "new code must separate /api/v1 and /api-v1"
        );
        console.log("  PASS: collision fix - /api/v1 vs /api-v1");
        passed++;
    }

    // Test 11: /app.v2 and /app/v2 and /app-v2 - three-way collision fixed
    {
        const a = newKeyComputation(1, "/app.v2", "prefix", null, null);
        const b = newKeyComputation(1, "/app/v2", "prefix", null, null);
        const c = newKeyComputation(1, "/app-v2", "prefix", null, null);
        const keys = new Set([a, b, c]);
        assertEquals(
            keys.size,
            3,
            "three paths must produce three unique keys"
        );
        console.log(
            "  PASS: collision fix - three-way /app.v2, /app/v2, /app-v2"
        );
        passed++;
    }

    // ── Edge cases ───────────────────────────────────────────────────

    // Test 12: same path in different resources - always separate
    {
        const key1 = newKeyComputation(1, "/api", "prefix", null, null);
        const key2 = newKeyComputation(2, "/api", "prefix", null, null);
        assertEquals(
            key1 !== key2,
            true,
            "different resources with same path must have different keys"
        );
        console.log("  PASS: edge case - same path, different resources");
        passed++;
    }

    // Test 13: same resource, different pathMatchType - separate keys
    {
        const exact = newKeyComputation(1, "/api", "exact", null, null);
        const prefix = newKeyComputation(1, "/api", "prefix", null, null);
        assertEquals(
            exact !== prefix,
            true,
            "exact vs prefix must have different keys"
        );
        console.log("  PASS: edge case - same path, different match types");
        passed++;
    }

    // Test 14: same resource and path, different rewrite config - separate keys
    {
        const noRewrite = newKeyComputation(1, "/api", "prefix", null, null);
        const withRewrite = newKeyComputation(
            1,
            "/api",
            "prefix",
            "/backend",
            "prefix"
        );
        assertEquals(
            noRewrite !== withRewrite,
            true,
            "with vs without rewrite must have different keys"
        );
        console.log("  PASS: edge case - same path, different rewrite config");
        passed++;
    }

    // Test 15: paths with special URL characters
    {
        const paths = ["/api?foo", "/api#bar", "/api%20baz", "/api+qux"];
        const keys = new Set(
            paths.map((p) => newKeyComputation(1, p, "prefix", null, null))
        );
        assertEquals(
            keys.size,
            paths.length,
            "special URL chars must produce unique keys"
        );
        console.log("  PASS: edge case - special URL characters in paths");
        passed++;
    }

    // Test 16: long paths on one resource must not share a router name.
    // Mirrors the key computation in getTraefikConfig.ts using the real
    // helpers: the map key is unique, but the router/service key was cut to
    // 50 characters, so both targets were written to the same router.
    {
        const routerKey = (
            resourceId: number,
            path: string,
            pathMatchType: string
        ) => {
            const pathKey = [realEncodePath(path), pathMatchType]
                .filter(Boolean)
                .join("-");
            const mapKey = [resourceId, pathKey].filter(Boolean).join("-");
            return { mapKey, key: buildResourceRouterKey(mapKey) };
        };
        const a = routerKey(
            12,
            "/api/v1/organizations/settings/notifications/email",
            "prefix"
        );
        const b = routerKey(
            12,
            "/api/v1/organizations/settings/notifications/slack",
            "prefix"
        );
        assertEquals(
            a.mapKey !== b.mapKey,
            true,
            "the two targets are separate groups"
        );
        assertEquals(
            a.key !== b.key,
            true,
            "long paths on the same resource must get different router keys"
        );
        assertEquals(
            /^[a-zA-Z0-9-]+$/.test(a.key) && /^[a-zA-Z0-9-]+$/.test(b.key),
            true,
            "router keys must stay alphanumeric with dashes"
        );
        assertEquals(
            routerKey(1, "/api", "prefix").key,
            "1-2fapi-prefix",
            "short keys must stay unchanged"
        );
        console.log("  PASS: long paths on one resource get distinct keys");
        passed++;
    }

    console.log(`\nAll ${passed} tests passed!`);
}

try {
    runTests();
} catch (error) {
    console.error("Test failed:", error);
    process.exit(1);
}
