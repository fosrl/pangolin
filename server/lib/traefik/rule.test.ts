import { assertEquals } from "../../../test/assert";
import {
    appendPathMatch,
    buildHostRule,
    computeRedirectPriority,
    computeRoutePriority,
    matchesPath,
    pickResourceForHost,
    ruleValue
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

    console.log("Running rule quoting tests...");

    // Ordinary values keep the backtick form
    assertEquals(ruleValue("/api"), "`/api`", "plain value");
    assertEquals(
        buildHostRule("app.example.com"),
        "Host(`app.example.com`)",
        "plain host"
    );
    assertEquals(
        buildHostRule("*.example.com", true),
        "HostRegexp(`^[^.]+\\.example\\.com$`)",
        "wildcard host"
    );
    assertEquals(
        buildHostRule("*.example.com", true, false),
        "HostRegexp(`^[^.]+\\.example\\.com$`)",
        "wildcard host without its base"
    );
    assertEquals(
        buildHostRule("*.apps.example.com", true, true),
        "HostRegexp(`^([^.]+\\.)?apps\\.example\\.com$`)",
        "wildcard host with its base"
    );
    assertEquals(
        buildHostRule("app.example.com", false, true),
        "Host(`app.example.com`)",
        "matchBaseDomain is ignored without a wildcard"
    );

    const withBase = new RegExp("^([^.]+\\.)?apps\\.example\\.com$");
    assertEquals(withBase.test("apps.example.com"), true, "matches the base");
    assertEquals(withBase.test("a.apps.example.com"), true, "matches a label");
    assertEquals(
        withBase.test("a.b.apps.example.com"),
        false,
        "one label only"
    );
    assertEquals(withBase.test("xapps.example.com"), false, "no suffix match");

    // The path clause has to bind to both hosts, which an || would not
    assertEquals(
        appendPathMatch(
            buildHostRule("*.example.com", true, true),
            "/x",
            "exact"
        ),
        "HostRegexp(`^([^.]+\\.)?example\\.com$`) && Path(`/x`)",
        "path applies to the wildcard and its base"
    );

    const pick = (host: string, rows: string[]) =>
        pickResourceForHost(rows, host, (r) => r);
    assertEquals(
        pick("a.example.com", ["*.example.com", "a.example.com"]),
        "a.example.com",
        "exact beats wildcard"
    );
    assertEquals(
        pick("apps.example.com", ["*.example.com", "*.apps.example.com"]),
        "*.apps.example.com",
        "base of the narrower wildcard beats the broader wildcard"
    );
    assertEquals(
        pick("a.b.example.com", ["*.example.com", "*.b.example.com"]),
        "*.b.example.com",
        "most specific wildcard wins"
    );
    assertEquals(pick("a.example.com", []), undefined, "no match");

    assertEquals(
        appendPathMatch("Host(`a.com`)", "/x", "exact"),
        "Host(`a.com`) && Path(`/x`)",
        "plain exact path"
    );
    assertEquals(
        appendPathMatch("Host(`a.com`)", "^/v[0-9]+/", "regex"),
        "Host(`a.com`) && PathRegexp(`^/v[0-9]+/`)",
        "plain regex path"
    );

    // A backtick must not be able to close the literal and inject matchers
    const injectedPath = "/a`) || Host(`victim.example.com`) && PathPrefix(`/";
    assertEquals(
        appendPathMatch("Host(`attacker.example.com`)", injectedPath, "exact"),
        'Host(`attacker.example.com`) && Path("/a`) || Host(`victim.example.com`) && PathPrefix(`/")',
        "injected exact path stays one literal"
    );
    assertEquals(
        appendPathMatch("Host(`a.com`)", "`) || HostRegexp(`.+", "regex"),
        'Host(`a.com`) && PathRegexp("`) || HostRegexp(`.+")',
        "injected regex path stays one literal"
    );
    assertEquals(
        buildHostRule("x`) || Host(`victim.example.com"),
        'Host("x`) || Host(`victim.example.com")',
        "injected host stays one literal"
    );

    // Double-quoted form escapes quotes, backslashes and control characters
    assertEquals(
        ruleValue('`"\\\n'),
        '"`\\"\\\\\\n"',
        "escapes in quoted form"
    );

    console.log("All rule quoting tests passed!");
}

try {
    runTests();
} catch (error) {
    console.error("Test failed:", error);
    process.exit(1);
}
