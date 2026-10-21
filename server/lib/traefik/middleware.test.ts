import { assertEquals } from "../../../test/assert";
import { rewriteRequestPath } from "./middleware";

function runTests() {
    console.log("Running rewriteRequestPath tests...");

    // no rewrite configured
    assertEquals(
        rewriteRequestPath("/a/b", "/a", "prefix", null, null),
        "/a/b",
        "no rewrite type"
    );

    // exact rewrite
    assertEquals(
        rewriteRequestPath("/old", "/old", "exact", "/new", "exact"),
        "/new",
        "exact -> exact"
    );
    assertEquals(
        rewriteRequestPath("/old/x", "/old", "exact", "/new", "exact"),
        "/old/x",
        "exact rewrite only on exact match"
    );
    assertEquals(
        rewriteRequestPath("/old", "/old", "exact", "new", "exact"),
        "/new",
        "leading slash added to rewrite"
    );
    assertEquals(
        rewriteRequestPath("/anything", null, null, "/new", "exact"),
        "/new",
        "no match path + exact rewrite replaces path"
    );

    // prefix rewrite
    assertEquals(
        rewriteRequestPath("/old/a/b", "/old", "prefix", "/new", "prefix"),
        "/new/a/b",
        "prefix -> prefix keeps rest"
    );
    assertEquals(
        rewriteRequestPath("/old", "/old", "prefix", "/new", "prefix"),
        "/new",
        "prefix -> prefix bare"
    );
    assertEquals(
        rewriteRequestPath("/old", "/old", "exact", "/new", "prefix"),
        "/new",
        "exact -> prefix"
    );
    assertEquals(
        rewriteRequestPath(
            "/api/v1/users",
            "^/api/v1/(.*)",
            "regex",
            "/v2/$1",
            "prefix"
        ),
        "/v2/users",
        "regex -> prefix uses capture"
    );

    // regex rewrite
    assertEquals(
        rewriteRequestPath(
            "/blog/2020/post",
            "^/blog/(\\d+)/(.*)$",
            "regex",
            "/archive/$2-$1",
            "regex"
        ),
        "/archive/post-2020",
        "regex -> regex"
    );
    assertEquals(
        rewriteRequestPath("/old/x", "/old", "prefix", "/new$1", "regex"),
        "/new/x",
        "prefix -> regex has (.*) capture"
    );
    assertEquals(
        rewriteRequestPath("/old", "/old", "exact", "/new", "regex"),
        "/new",
        "exact -> regex"
    );

    // stripPrefix
    assertEquals(
        rewriteRequestPath("/old/a", "/old", "prefix", null, "stripPrefix"),
        "/a",
        "stripPrefix"
    );
    assertEquals(
        rewriteRequestPath("/old", "/old", "prefix", null, "stripPrefix"),
        "/",
        "stripPrefix to root"
    );
    assertEquals(
        rewriteRequestPath("/old/a", "/old", "prefix", "/new", "stripPrefix"),
        "/new/a",
        "stripPrefix + addPrefix"
    );
    assertEquals(
        rewriteRequestPath("/old", "/old", "exact", null, "stripPrefix"),
        "/",
        "stripPrefix exact"
    );
    // Same result the replacePathRegex middleware produces for this config
    // (regex `^/old` -> `/`), quirky double slash included.
    assertEquals(
        rewriteRequestPath("/old/a", "^/old", "regex", null, "stripPrefix"),
        "//a",
        "stripPrefix regex mirrors Traefik"
    );
    assertEquals(
        rewriteRequestPath("/old/a", "^/old/", "regex", null, "stripPrefix"),
        "/a",
        "stripPrefix regex with trailing slash"
    );
    assertEquals(
        rewriteRequestPath("/a/b", null, null, null, "stripPrefix"),
        "/a/b",
        "stripPrefix without match path is a no-op"
    );

    console.log("All rewriteRequestPath tests passed!");
}

try {
    runTests();
} catch (error) {
    console.error("Test failed:", error);
    process.exit(1);
}
