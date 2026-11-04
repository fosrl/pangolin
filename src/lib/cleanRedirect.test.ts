import { assertEquals } from "@test/assert";
import { cleanRedirect } from "./cleanRedirect";

function testOpenRedirectRejection() {
    console.log("Running open redirect rejection tests...");

    // Absolute URLs with external schemes/hosts must fall back
    assertEquals(
        cleanRedirect("https://attacker.example/phish"),
        "/",
        "External https URL must fall back to /"
    );
    assertEquals(
        cleanRedirect("http://evil.com"),
        "/",
        "External http URL must fall back to /"
    );

    // Protocol-relative URLs must fall back
    assertEquals(
        cleanRedirect("//attacker.example/phish"),
        "/",
        "Protocol-relative URL must fall back to /"
    );

    // JavaScript and data pseudo-schemes must fall back
    assertEquals(
        cleanRedirect("javascript:alert(1)"),
        "/",
        "javascript: URI must fall back to /"
    );
    assertEquals(
        cleanRedirect("data:text/html,test"),
        "/",
        "data: URI must fall back to /"
    );
}

function testSafeRelativeRedirects() {
    console.log("Running safe relative redirect tests...");

    assertEquals(cleanRedirect("/"), "/", "Root path must be preserved");
    assertEquals(
        cleanRedirect("/dashboard"),
        "/dashboard",
        "Simple relative path must be preserved"
    );
    assertEquals(
        cleanRedirect("/org/123/settings"),
        "/org/123/settings",
        "Nested relative path must be preserved"
    );
    assertEquals(
        cleanRedirect("/auth/callback?code=xyz&redirect=/home"),
        "/auth/callback?code=xyz&redirect=%2Fhome",
        "Relative path with allowed query parameters must be preserved"
    );
    assertEquals(
        cleanRedirect("/path?custom=123", { allowAllQueryParams: true }),
        "/path?custom=123",
        "All query params preserved when allowAllQueryParams is true"
    );
    assertEquals(
        cleanRedirect("https://attacker.example", {
            fallback: "/custom-fallback"
        }),
        "/custom-fallback",
        "Custom fallback is respected when rejecting unsafe URL"
    );
}

try {
    testOpenRedirectRejection();
    testSafeRelativeRedirects();
    console.log("All cleanRedirect tests passed successfully!");
} catch (error) {
    console.error("cleanRedirect test failed:", error);
    process.exit(1);
}
