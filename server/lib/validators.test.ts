import { isValidUrlGlobPattern } from "./validators";
import { assertEquals } from "@test/assert";

function runTests() {
    console.log("Running URL pattern validation tests...");

    // Test valid patterns
    assertEquals(
        isValidUrlGlobPattern("simple"),
        true,
        "Simple path segment should be valid"
    );
    assertEquals(
        isValidUrlGlobPattern("simple/path"),
        true,
        "Simple path with slash should be valid"
    );
    assertEquals(
        isValidUrlGlobPattern("/leading/slash"),
        true,
        "Path with leading slash should be valid"
    );
    assertEquals(
        isValidUrlGlobPattern("path/"),
        true,
        "Path with trailing slash should be valid"
    );
    assertEquals(
        isValidUrlGlobPattern("path/*"),
        true,
        "Path with wildcard segment should be valid"
    );
    assertEquals(
        isValidUrlGlobPattern("*"),
        true,
        "Single wildcard should be valid"
    );
    assertEquals(
        isValidUrlGlobPattern("*/subpath"),
        true,
        "Wildcard with subpath should be valid"
    );
    assertEquals(
        isValidUrlGlobPattern("path/*/more"),
        true,
        "Path with wildcard in the middle should be valid"
    );

    // Test with special characters
    assertEquals(
        isValidUrlGlobPattern("path-with-dash"),
        true,
        "Path with dash should be valid"
    );
    assertEquals(
        isValidUrlGlobPattern("path_with_underscore"),
        true,
        "Path with underscore should be valid"
    );
    assertEquals(
        isValidUrlGlobPattern("path.with.dots"),
        true,
        "Path with dots should be valid"
    );
    assertEquals(
        isValidUrlGlobPattern("path~with~tilde"),
        true,
        "Path with tilde should be valid"
    );
    assertEquals(
        isValidUrlGlobPattern("path!with!exclamation"),
        true,
        "Path with exclamation should be valid"
    );
    assertEquals(
        isValidUrlGlobPattern("path$with$dollar"),
        true,
        "Path with dollar should be valid"
    );
    assertEquals(
        isValidUrlGlobPattern("path&with&ampersand"),
        true,
        "Path with ampersand should be valid"
    );
    assertEquals(
        isValidUrlGlobPattern("path'with'quote"),
        true,
        "Path with quote should be valid"
    );
    assertEquals(
        isValidUrlGlobPattern("path(with)parentheses"),
        true,
        "Path with parentheses should be valid"
    );
    assertEquals(
        isValidUrlGlobPattern("path+with+plus"),
        true,
        "Path with plus should be valid"
    );
    assertEquals(
        isValidUrlGlobPattern("path,with,comma"),
        true,
        "Path with comma should be valid"
    );
    assertEquals(
        isValidUrlGlobPattern("path;with;semicolon"),
        true,
        "Path with semicolon should be valid"
    );
    assertEquals(
        isValidUrlGlobPattern("path=with=equals"),
        true,
        "Path with equals should be valid"
    );
    assertEquals(
        isValidUrlGlobPattern("path:with:colon"),
        true,
        "Path with colon should be valid"
    );
    assertEquals(
        isValidUrlGlobPattern("path@with@at"),
        true,
        "Path with at should be valid"
    );

    // Test with percent encoding
    assertEquals(
        isValidUrlGlobPattern("path%20with%20spaces"),
        true,
        "Path with percent-encoded spaces should be valid"
    );
    assertEquals(
        isValidUrlGlobPattern("path%2Fwith%2Fencoded%2Fslashes"),
        true,
        "Path with percent-encoded slashes should be valid"
    );

    // Test with wildcards in segments (the fixed functionality)
    assertEquals(
        isValidUrlGlobPattern("padbootstrap*"),
        true,
        "Path with wildcard at the end of segment should be valid"
    );
    assertEquals(
        isValidUrlGlobPattern("pad*bootstrap"),
        true,
        "Path with wildcard in the middle of segment should be valid"
    );
    assertEquals(
        isValidUrlGlobPattern("*bootstrap"),
        true,
        "Path with wildcard at the start of segment should be valid"
    );
    assertEquals(
        isValidUrlGlobPattern("multiple*wildcards*in*segment"),
        true,
        "Path with multiple wildcards in segment should be valid"
    );
    assertEquals(
        isValidUrlGlobPattern("wild*/cards/in*/different/seg*ments"),
        true,
        "Path with wildcards in different segments should be valid"
    );

    // Test invalid patterns
    assertEquals(
        isValidUrlGlobPattern(""),
        false,
        "Empty string should be invalid"
    );
    assertEquals(
        isValidUrlGlobPattern("//double/slash"),
        false,
        "Path with double slash should be invalid"
    );
    assertEquals(
        isValidUrlGlobPattern("path//end"),
        false,
        "Path with double slash in the middle should be invalid"
    );
    assertEquals(
        isValidUrlGlobPattern("invalid<char>"),
        false,
        "Path with invalid characters should be invalid"
    );
    assertEquals(
        isValidUrlGlobPattern("invalid|char"),
        false,
        "Path with invalid pipe character should be invalid"
    );
    assertEquals(
        isValidUrlGlobPattern('invalid"char'),
        false,
        "Path with invalid quote character should be invalid"
    );
    assertEquals(
        isValidUrlGlobPattern("invalid`char"),
        false,
        "Path with invalid backtick character should be invalid"
    );
    assertEquals(
        isValidUrlGlobPattern("invalid^char"),
        false,
        "Path with invalid caret character should be invalid"
    );
    assertEquals(
        isValidUrlGlobPattern("invalid\\char"),
        false,
        "Path with invalid backslash character should be invalid"
    );
    assertEquals(
        isValidUrlGlobPattern("invalid[char]"),
        false,
        "Path with invalid square brackets should be invalid"
    );
    assertEquals(
        isValidUrlGlobPattern("invalid{char}"),
        false,
        "Path with invalid curly braces should be invalid"
    );

    // Test invalid percent encoding
    assertEquals(
        isValidUrlGlobPattern("invalid%2"),
        false,
        "Path with incomplete percent encoding should be invalid"
    );
    assertEquals(
        isValidUrlGlobPattern("invalid%GZ"),
        false,
        "Path with invalid hex in percent encoding should be invalid"
    );
    assertEquals(
        isValidUrlGlobPattern("invalid%"),
        false,
        "Path with isolated percent sign should be invalid"
    );

    // Test query string support
    assertEquals(
        isValidUrlGlobPattern("/login?autoLaunch=0"),
        true,
        "Path with query string should be valid"
    );
    assertEquals(
        isValidUrlGlobPattern("/audiobookshelf/login/?autoLaunch=0"),
        true,
        "Path with trailing slash and query string should be valid"
    );
    assertEquals(
        isValidUrlGlobPattern("/auth/login?autoLaunch=0"),
        true,
        "Path with query param should be valid"
    );
    assertEquals(
        isValidUrlGlobPattern("/path?key=value&other=123"),
        true,
        "Path with multiple query params should be valid"
    );
    assertEquals(
        isValidUrlGlobPattern("/path?key=*"),
        true,
        "Path with wildcard query param value should be valid"
    );
    assertEquals(
        isValidUrlGlobPattern("?onlyQuery=1"),
        false,
        "Query string without path should be invalid"
    );

    console.log("All tests passed!");
}

// Run all tests
try {
    runTests();
} catch (error) {
    console.error("Test failed:", error);
}
