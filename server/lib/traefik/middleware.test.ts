import { assertEquals } from "../../../test/assert";
import createPathRewriteMiddleware from "./middleware";

// Traefik's replacePathRegex rewrites a path only when the regex matches it,
// and then replaces the matched part. This mirrors that with JS regexes,
// which behave the same as Go's for the patterns used here.
function applyRewrite(
    middleware: { replacePathRegex?: { regex: string; replacement: string } },
    requestPath: string
): string {
    const rule = middleware.replacePathRegex;
    if (!rule) {
        throw new Error("expected a replacePathRegex middleware");
    }
    const regex = new RegExp(rule.regex);
    if (!regex.test(requestPath)) {
        return requestPath;
    }
    const replacement = rule.replacement.replace(/\$(\d+)/g, "$$$1");
    return requestPath.replace(new RegExp(rule.regex, "g"), replacement);
}

function rewrite(
    path: string,
    pathMatchType: string,
    rewritePath: string,
    rewritePathType: string,
    requestPath: string
): string {
    const name = "rewrite-r1-test";
    const { middlewares } = createPathRewriteMiddleware(
        name,
        path,
        pathMatchType,
        rewritePath,
        rewritePathType
    );
    return applyRewrite(middlewares[name], requestPath);
}

function runTests() {
    console.log("Running path rewrite middleware tests...");

    // Test 1: exact match + exact rewrite
    assertEquals(
        rewrite("/old", "exact", "/new", "exact", "/old"),
        "/new",
        "exact match with exact rewrite should replace the path"
    );
    console.log("  PASS: exact match + exact rewrite");

    // Test 2: prefix match + exact rewrite
    assertEquals(
        rewrite("/old", "prefix", "/new", "exact", "/old"),
        "/new",
        "prefix match with exact rewrite should replace the prefix path"
    );
    console.log("  PASS: prefix match + exact rewrite");

    // Test 3: prefix match + prefix rewrite keeps the rest of the path
    assertEquals(
        rewrite("/old", "prefix", "/new", "prefix", "/old/a/b"),
        "/new/a/b",
        "prefix match with prefix rewrite should keep the suffix"
    );
    console.log("  PASS: prefix match + prefix rewrite");

    // Test 4: regex match + regex rewrite uses the regex as written
    assertEquals(
        rewrite("^/api/(.*)$", "regex", "/v2/$1", "regex", "/api/users"),
        "/v2/users",
        "regex match with regex rewrite should use capture groups"
    );
    console.log("  PASS: regex match + regex rewrite");

    // Test 5: regex match + exact rewrite must rewrite every path the
    // router's PathRegexp sends to it, not treat the regex as a literal path
    assertEquals(
        rewrite(
            "^/api/v[0-9]+/status$",
            "regex",
            "/health",
            "exact",
            "/api/v1/status"
        ),
        "/health",
        "regex match with exact rewrite should replace the matched path"
    );
    assertEquals(
        rewrite("^/legacy/.*", "regex", "/", "exact", "/legacy/page/1"),
        "/",
        "regex match with exact rewrite should replace the whole path"
    );
    console.log("  PASS: regex match + exact rewrite");

    console.log("All path rewrite middleware tests passed!");
}

try {
    runTests();
} catch (error) {
    console.error("Test failed:", error);
    process.exit(1);
}
