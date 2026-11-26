import { isPathAllowed } from "./pathMatch";
import { assertEquals } from "@test/assert";

function runTests() {
    console.log("Running path matching tests...");

    assertEquals(
        isPathAllowed("/login", "/login"),
        true,
        "Exact path match should be allowed"
    );
    assertEquals(
        isPathAllowed("/login/*", "/login/sso"),
        true,
        "Wildcard segment should match"
    );
    assertEquals(
        isPathAllowed("/login", "/logout"),
        false,
        "Different path should not match"
    );

    console.log("Running query matching tests (issue #839)...");

    // The original bug report: a rule meant to block
    // /audiobookshelf/login/?autoLaunch=0 never matched, because the path
    // matcher had no concept of a query string at all.
    assertEquals(
        isPathAllowed(
            "/audiobookshelf/login/?autoLaunch=0",
            "/audiobookshelf/login/",
            { autoLaunch: "0" }
        ),
        true,
        "Path + matching query param should be allowed"
    );
    assertEquals(
        isPathAllowed(
            "/audiobookshelf/login/?autoLaunch=0",
            "/audiobookshelf/login/",
            { autoLaunch: "1" }
        ),
        false,
        "Path match with a different query value should not match"
    );
    assertEquals(
        isPathAllowed(
            "/audiobookshelf/login/?autoLaunch=0",
            "/audiobookshelf/login/",
            {}
        ),
        false,
        "Path match with no query params at all should not match a rule with a query component"
    );
    assertEquals(
        isPathAllowed(
            "/audiobookshelf/login/?autoLaunch=0",
            "/audiobookshelf/login/",
            undefined
        ),
        false,
        "Path match with undefined query should not match a rule with a query component"
    );
    assertEquals(
        isPathAllowed(
            "/login?userId=*",
            "/login",
            { userId: "12345" }
        ),
        true,
        "Query value wildcard should match any value for that key"
    );
    assertEquals(
        isPathAllowed(
            "/login?autoLaunch=0&source=app",
            "/login",
            { autoLaunch: "0", source: "app" }
        ),
        true,
        "All query pairs in the rule must match, and they do here"
    );
    assertEquals(
        isPathAllowed(
            "/login?autoLaunch=0&source=app",
            "/login",
            { autoLaunch: "0", source: "web" }
        ),
        false,
        "All query pairs in the rule must match; one mismatching pair should fail"
    );
    assertEquals(
        isPathAllowed("/login", "/login", { anything: "ignored" }),
        true,
        "A rule with no query component should ignore extra query params on the request"
    );

    console.log("All tests passed!");
}

try {
    runTests();
} catch (error) {
    console.error("Test failed:", error);
    process.exit(1);
}
