import { assertEquals } from "../../../test/assert";
import {
    computeRedirectPriority,
    computeRoutePriority,
    matchesPath
} from "./rule";

function runTests() {
    console.log("Running matchesPath tests...");

    // No path config matches everything
    assertEquals(matchesPath("/anything", null, null), true, "null path");
    assertEquals(matchesPath("/anything", "/a", null), true, "null type");
    assertEquals(
        matchesPath("/anything", null, "prefix"),
        true,
        "null path w/ type"
    );

    // exact
    assertEquals(matchesPath("/api", "/api", "exact"), true, "exact match");
    assertEquals(
        matchesPath("/api/", "/api", "exact"),
        false,
        "exact trailing slash"
    );
    assertEquals(matchesPath("/api/x", "/api", "exact"), false, "exact child");
    assertEquals(
        matchesPath("/api", "api", "exact"),
        true,
        "exact leading slash added"
    );

    // prefix (segment-aware, like Traefik v3 PathPrefix)
    assertEquals(
        matchesPath("/products", "/products", "prefix"),
        true,
        "prefix itself"
    );
    assertEquals(
        matchesPath("/products/", "/products", "prefix"),
        true,
        "prefix slash"
    );
    assertEquals(
        matchesPath("/products/shoes", "/products", "prefix"),
        true,
        "prefix child"
    );
    assertEquals(
        matchesPath("/productsforsale", "/products", "prefix"),
        false,
        "prefix partial segment"
    );
    assertEquals(
        matchesPath("/products/shoes", "/products/", "prefix"),
        true,
        "prefix with trailing slash"
    );
    assertEquals(
        matchesPath("/products", "/products/", "prefix"),
        false,
        "trailing-slash prefix vs bare"
    );
    assertEquals(
        matchesPath("/other", "/products", "prefix"),
        false,
        "prefix miss"
    );

    // regex (unanchored, like PathRegexp)
    assertEquals(
        matchesPath("/api/v1/x", "^/api/.*", "regex"),
        true,
        "regex anchored"
    );
    assertEquals(
        matchesPath("/x/api/v1", "/api/", "regex"),
        true,
        "regex unanchored"
    );
    assertEquals(matchesPath("/foo", "^/api", "regex"), false, "regex miss");
    assertEquals(
        matchesPath("/foo", "(", "regex"),
        false,
        "invalid regex never matches"
    );

    console.log("All matchesPath tests passed!");

    console.log("Running priority tests...");

    // Resource routers: explicit override, else derived from path specificity
    assertEquals(computeRoutePriority(null, null, null), 100, "default");
    assertEquals(computeRoutePriority(100, null, null), 100, "100 is auto");
    assertEquals(computeRoutePriority(500, "/a", "exact"), 500, "explicit");
    assertEquals(computeRoutePriority(null, "/a", "exact"), 115, "exact");
    assertEquals(computeRoutePriority(null, "/a", "prefix"), 113, "prefix");
    assertEquals(computeRoutePriority(null, "/a", "regex"), 112, "regex");
    assertEquals(computeRoutePriority(null, "/", "prefix"), 1, "catch-all");

    // Redirect routers always land above any resource router (max 1000)
    assertEquals(
        computeRedirectPriority(null, null, null),
        1100,
        "redirect default"
    );
    assertEquals(
        computeRedirectPriority(null, "/", "prefix"),
        1001,
        "redirect catch-all"
    );
    assertEquals(
        computeRedirectPriority(1, null, null),
        1001,
        "redirect lowest explicit"
    );
    assertEquals(
        computeRedirectPriority(1000, null, null),
        2000,
        "redirect highest explicit"
    );
    assertEquals(
        computeRedirectPriority(1, "/", "prefix") >
            computeRoutePriority(1000, "/a", "exact"),
        true,
        "weakest redirect beats strongest resource"
    );

    console.log("All priority tests passed!");
}

try {
    runTests();
} catch (error) {
    console.error("Test failed:", error);
    process.exit(1);
}
