import { assertEquals } from "@test/assert";
import { fillBlockPageText, parseBlockedDomain } from "./dnsBlockPage";

function runTests() {
    assertEquals(
        parseBlockedDomain("WWW.Instagram.com."),
        "www.instagram.com",
        "Domains are lowercased and lose a trailing dot"
    );
    assertEquals(
        parseBlockedDomain("instagram.com"),
        "instagram.com",
        "A plain domain is accepted"
    );
    assertEquals(
        parseBlockedDomain("<script>alert(1)</script>.com"),
        null,
        "Markup is rejected"
    );
    assertEquals(
        parseBlockedDomain("instagram.com is blocked, call 555-0100"),
        null,
        "Free text is rejected"
    );
    assertEquals(
        parseBlockedDomain("localhost"),
        null,
        "A single label is rejected"
    );
    assertEquals(
        parseBlockedDomain(["a.com", "b.com"]),
        null,
        "Repeated params are rejected"
    );
    assertEquals(
        parseBlockedDomain(undefined),
        null,
        "A missing param is null"
    );
    assertEquals(
        parseBlockedDomain(`${"a".repeat(64)}.com`),
        null,
        "Labels longer than 63 characters are rejected"
    );

    const vars = { domain: "instagram.com", orgName: "Acme" };
    assertEquals(
        fillBlockPageText("{{domain}} is blocked by {{ orgName }}.", vars),
        "instagram.com is blocked by Acme.",
        "Both placeholders are filled, with or without inner spaces"
    );
    assertEquals(
        fillBlockPageText("{{unknown}} {domain}", vars),
        "{{unknown}} {domain}",
        "Other braces are left alone"
    );

    console.log("All DNS block page tests passed!");
}

try {
    runTests();
} catch (error) {
    console.error("DNS block page test failed:", error);
    process.exit(1);
}
