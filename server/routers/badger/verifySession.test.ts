import { assertEquals } from "@test/assert";
import { REGIONS } from "@server/db/regions";
import { isPathAllowed } from "./pathMatching";

function isIpInRegion(
    ipCountryCode: string | undefined,
    checkRegionCode: string
): boolean {
    if (!ipCountryCode) {
        return false;
    }

    const upperCode = ipCountryCode.toUpperCase();

    for (const region of REGIONS) {
        // Check if it's a top-level region (continent)
        if (region.id === checkRegionCode) {
            for (const subregion of region.includes) {
                if (subregion.countries.includes(upperCode)) {
                    return true;
                }
            }
            return false;
        }

        // Check subregions
        for (const subregion of region.includes) {
            if (subregion.id === checkRegionCode) {
                return subregion.countries.includes(upperCode);
            }
        }
    }

    return false;
}

function runTests() {
    console.log("Running path matching tests...");

    // Test exact matching
    assertEquals(
        isPathAllowed("foo", "foo"),
        true,
        "Exact match should be allowed"
    );
    assertEquals(
        isPathAllowed("foo", "bar"),
        false,
        "Different segments should not match"
    );
    assertEquals(
        isPathAllowed("foo/bar", "foo/bar"),
        true,
        "Exact multi-segment match should be allowed"
    );
    assertEquals(
        isPathAllowed("foo/bar", "foo/baz"),
        false,
        "Partial multi-segment match should not be allowed"
    );

    // Test with leading and trailing slashes
    assertEquals(
        isPathAllowed("/foo", "foo"),
        true,
        "Pattern with leading slash should match"
    );
    assertEquals(
        isPathAllowed("foo/", "foo"),
        true,
        "Pattern with trailing slash should match"
    );
    assertEquals(
        isPathAllowed("/foo/", "foo"),
        true,
        "Pattern with both leading and trailing slashes should match"
    );
    assertEquals(
        isPathAllowed("foo", "/foo/"),
        true,
        "Path with leading and trailing slashes should match"
    );

    // Test simple wildcard matching
    assertEquals(
        isPathAllowed("*", "foo"),
        true,
        "Single wildcard should match any single segment"
    );
    assertEquals(
        isPathAllowed("*", "foo/bar"),
        true,
        "Single wildcard should match multiple segments"
    );
    assertEquals(
        isPathAllowed("*/bar", "foo/bar"),
        true,
        "Wildcard prefix should match"
    );
    assertEquals(
        isPathAllowed("foo/*", "foo/bar"),
        true,
        "Wildcard suffix should match"
    );
    assertEquals(
        isPathAllowed("foo/*/baz", "foo/bar/baz"),
        true,
        "Wildcard in middle should match"
    );

    // Test multiple wildcards
    assertEquals(
        isPathAllowed("*/*", "foo/bar"),
        true,
        "Multiple wildcards should match corresponding segments"
    );
    assertEquals(
        isPathAllowed("*/*/*", "foo/bar/baz"),
        true,
        "Three wildcards should match three segments"
    );
    assertEquals(
        isPathAllowed("foo/*/*", "foo/bar/baz"),
        true,
        "Specific prefix with wildcards should match"
    );
    assertEquals(
        isPathAllowed("*/*/baz", "foo/bar/baz"),
        true,
        "Wildcards with specific suffix should match"
    );

    // Test wildcard consumption behavior
    assertEquals(
        isPathAllowed("*", ""),
        true,
        "Wildcard should optionally consume segments"
    );
    assertEquals(
        isPathAllowed("foo/*", "foo"),
        true,
        "Trailing wildcard should be optional"
    );
    assertEquals(
        isPathAllowed("*/*", "foo"),
        true,
        "Multiple wildcards can match fewer segments"
    );
    assertEquals(
        isPathAllowed("*/*/*", "foo/bar"),
        true,
        "Extra wildcards can be skipped"
    );

    // Test complex nested paths
    assertEquals(
        isPathAllowed("api/*/users", "api/v1/users"),
        true,
        "API versioning pattern should match"
    );
    assertEquals(
        isPathAllowed("api/*/users/*", "api/v1/users/123"),
        true,
        "API resource pattern should match"
    );
    assertEquals(
        isPathAllowed("api/*/users/*/profile", "api/v1/users/123/profile"),
        true,
        "Nested API pattern should match"
    );

    // Test for the requested padbootstrap* pattern
    assertEquals(
        isPathAllowed("padbootstrap*", "padbootstrap"),
        true,
        "padbootstrap* should match padbootstrap"
    );
    assertEquals(
        isPathAllowed("padbootstrap*", "padbootstrapv1"),
        true,
        "padbootstrap* should match padbootstrapv1"
    );
    assertEquals(
        isPathAllowed("padbootstrap*", "padbootstrap/files"),
        false,
        "padbootstrap* should not match padbootstrap/files"
    );
    assertEquals(
        isPathAllowed("padbootstrap*/*", "padbootstrap/files"),
        true,
        "padbootstrap*/* should match padbootstrap/files"
    );
    assertEquals(
        isPathAllowed("padbootstrap*/files", "padbootstrapv1/files"),
        true,
        "padbootstrap*/files should not match padbootstrapv1/files (wildcard is segment-based, not partial)"
    );

    // Test wildcard edge cases
    assertEquals(
        isPathAllowed("*/*/*/*/*/*", "a/b"),
        true,
        "Many wildcards can match few segments"
    );
    assertEquals(
        isPathAllowed("a/*/b/*/c", "a/anything/b/something/c"),
        true,
        "Multiple wildcards in pattern should match corresponding segments"
    );

    // Test patterns with partial segment matches
    assertEquals(
        isPathAllowed("padbootstrap*", "padbootstrap-123"),
        true,
        "Wildcards in isPathAllowed should be segment-based, not character-based"
    );
    assertEquals(
        isPathAllowed("test*", "testuser"),
        true,
        "Asterisk as part of segment name is treated as a literal, not a wildcard"
    );
    assertEquals(
        isPathAllowed("my*app", "myapp"),
        true,
        "Asterisk in middle of segment name is treated as a literal, not a wildcard"
    );

    assertEquals(
        isPathAllowed("/", "/"),
        true,
        "Root path should match root path"
    );
    assertEquals(
        isPathAllowed("/", "/test"),
        false,
        "Root path should not match non-root path"
    );

    // Query string matching (issue #839)
    assertEquals(
        isPathAllowed("/auth/login?autoLaunch=0", "/auth/login", {
            autoLaunch: "0"
        }),
        true,
        "Exact query param match should be allowed"
    );
    assertEquals(
        isPathAllowed(
            "/audiobookshelf/login/?autoLaunch=0",
            "/audiobookshelf/login/",
            {
                autoLaunch: "0"
            }
        ),
        true,
        "Query param with trailing slash path should match"
    );
    assertEquals(
        isPathAllowed("/auth/login?autoLaunch=0", "/auth/login", {
            autoLaunch: "1"
        }),
        false,
        "Wrong query param value should not match"
    );
    assertEquals(
        isPathAllowed("/auth/login?autoLaunch=0", "/auth/login", {}),
        false,
        "Missing query param should not match"
    );
    assertEquals(
        isPathAllowed("/auth/login?autoLaunch=0", "/auth/login", undefined),
        false,
        "No query object should not match when param required"
    );
    assertEquals(
        isPathAllowed("/auth/login?autoLaunch=0", "/other/path", {
            autoLaunch: "0"
        }),
        false,
        "Wrong path should not match even if query matches"
    );
    assertEquals(
        isPathAllowed("/auth/login", "/auth/login", { autoLaunch: "0" }),
        true,
        "Pattern without query string matches regardless of request query params"
    );
    assertEquals(
        isPathAllowed("/path?key=*", "/path", { key: "anything" }),
        true,
        "Wildcard query param value should match any value"
    );
    assertEquals(
        isPathAllowed("/path?a=1&b=2", "/path", { a: "1", b: "2" }),
        true,
        "Multiple query params all present should match"
    );
    assertEquals(
        isPathAllowed("/path?a=1&b=2", "/path", { a: "1" }),
        false,
        "Multiple query params with one missing should not match"
    );
    assertEquals(
        isPathAllowed("/*/login?autoLaunch=0", "/audiobookshelf/login", {
            autoLaunch: "0"
        }),
        true,
        "Path wildcard combined with query param should match"
    );

    console.log("All path matching tests passed!");
}

function runRegionTests() {
    console.log("\nRunning isIpInRegion tests...");

    // Test undefined country code
    assertEquals(
        isIpInRegion(undefined, "150"),
        false,
        "Undefined country code should return false"
    );

    // Test subregion matching (Western Europe)
    assertEquals(
        isIpInRegion("DE", "155"),
        true,
        "Country should match its subregion"
    );
    assertEquals(
        isIpInRegion("GB", "155"),
        false,
        "Country should NOT match wrong subregion"
    );

    // Test continent matching (Europe)
    assertEquals(
        isIpInRegion("DE", "150"),
        true,
        "Country should match its continent"
    );
    assertEquals(
        isIpInRegion("GB", "150"),
        true,
        "Different European country should match Europe"
    );
    assertEquals(
        isIpInRegion("US", "150"),
        false,
        "Non-European country should NOT match Europe"
    );

    // Test case insensitivity
    assertEquals(
        isIpInRegion("de", "155"),
        true,
        "Lowercase country code should work"
    );

    // Test invalid region code
    assertEquals(
        isIpInRegion("DE", "999"),
        false,
        "Invalid region code should return false"
    );

    console.log("All region tests passed!");
}

// Run all tests
try {
    runTests();
    runRegionTests();
    console.log("\n✅ All tests passed!");
} catch (error) {
    console.error("❌ Test failed:", error);
    process.exit(1);
}
