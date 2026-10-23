import "@server/extendZod";
// the database is imported first, it breaks the circular import between the
// config and the logger
import "@server/db";
import { assertEquals } from "@test/assert";
import { isDomainCoveredByWildcard } from "./TraefikConfigManager";

function runTests() {
    console.log("Running wildcard domain coverage tests...");

    // Test case 1: Basic wildcard certificate at example.com
    const basicWildcardCerts = new Map([
        ["example.com", { exists: true, wildcard: true }]
    ]);

    // Should match first-level subdomains
    assertEquals(
        isDomainCoveredByWildcard("level1.example.com", basicWildcardCerts),
        true,
        "Wildcard cert at example.com should match level1.example.com"
    );

    assertEquals(
        isDomainCoveredByWildcard("api.example.com", basicWildcardCerts),
        true,
        "Wildcard cert at example.com should match api.example.com"
    );

    assertEquals(
        isDomainCoveredByWildcard("www.example.com", basicWildcardCerts),
        true,
        "Wildcard cert at example.com should match www.example.com"
    );

    // Should match the root domain (exact match)
    assertEquals(
        isDomainCoveredByWildcard("example.com", basicWildcardCerts),
        true,
        "Wildcard cert at example.com should match example.com itself"
    );

    // Should NOT match second-level subdomains
    assertEquals(
        isDomainCoveredByWildcard(
            "level2.level1.example.com",
            basicWildcardCerts
        ),
        false,
        "Wildcard cert at example.com should NOT match level2.level1.example.com"
    );

    assertEquals(
        isDomainCoveredByWildcard(
            "deep.nested.subdomain.example.com",
            basicWildcardCerts
        ),
        false,
        "Wildcard cert at example.com should NOT match deep.nested.subdomain.example.com"
    );

    // Should NOT match different domains
    assertEquals(
        isDomainCoveredByWildcard("test.otherdomain.com", basicWildcardCerts),
        false,
        "Wildcard cert at example.com should NOT match test.otherdomain.com"
    );

    assertEquals(
        isDomainCoveredByWildcard("notexample.com", basicWildcardCerts),
        false,
        "Wildcard cert at example.com should NOT match notexample.com"
    );

    // Test case 2: Multiple wildcard certificates
    const multipleWildcardCerts = new Map([
        ["example.com", { exists: true, wildcard: true }],
        ["test.org", { exists: true, wildcard: true }],
        ["api.service.net", { exists: true, wildcard: true }]
    ]);

    assertEquals(
        isDomainCoveredByWildcard("app.example.com", multipleWildcardCerts),
        true,
        "Should match subdomain of first wildcard cert"
    );

    assertEquals(
        isDomainCoveredByWildcard("staging.test.org", multipleWildcardCerts),
        true,
        "Should match subdomain of second wildcard cert"
    );

    assertEquals(
        isDomainCoveredByWildcard("v1.api.service.net", multipleWildcardCerts),
        true,
        "Should match subdomain of third wildcard cert"
    );

    assertEquals(
        isDomainCoveredByWildcard(
            "deep.nested.api.service.net",
            multipleWildcardCerts
        ),
        false,
        "Should NOT match multi-level subdomain of third wildcard cert"
    );

    // Test exact domain matches for multiple certs
    assertEquals(
        isDomainCoveredByWildcard("example.com", multipleWildcardCerts),
        true,
        "Should match exact domain of first wildcard cert"
    );

    assertEquals(
        isDomainCoveredByWildcard("test.org", multipleWildcardCerts),
        true,
        "Should match exact domain of second wildcard cert"
    );

    assertEquals(
        isDomainCoveredByWildcard("api.service.net", multipleWildcardCerts),
        true,
        "Should match exact domain of third wildcard cert"
    );

    // Test case 3: Non-wildcard certificates (should not match anything)
    const nonWildcardCerts = new Map([
        ["example.com", { exists: true, wildcard: false }],
        ["specific.domain.com", { exists: true, wildcard: false }]
    ]);

    assertEquals(
        isDomainCoveredByWildcard("sub.example.com", nonWildcardCerts),
        false,
        "Non-wildcard cert should not match subdomains"
    );

    assertEquals(
        isDomainCoveredByWildcard("example.com", nonWildcardCerts),
        false,
        "Non-wildcard cert should not match even exact domain via this function"
    );

    // Test case 4: Non-existent certificates (should not match)
    const nonExistentCerts = new Map([
        ["example.com", { exists: false, wildcard: true }],
        ["missing.com", { exists: false, wildcard: true }]
    ]);

    assertEquals(
        isDomainCoveredByWildcard("sub.example.com", nonExistentCerts),
        false,
        "Non-existent wildcard cert should not match"
    );

    // Test case 5: Edge cases with special domain names
    const specialDomainCerts = new Map([
        ["localhost", { exists: true, wildcard: true }],
        ["127-0-0-1.nip.io", { exists: true, wildcard: true }],
        ["xn--e1afmkfd.xn--p1ai", { exists: true, wildcard: true }] // IDN domain
    ]);

    assertEquals(
        isDomainCoveredByWildcard("app.localhost", specialDomainCerts),
        true,
        "Should match subdomain of localhost wildcard"
    );

    assertEquals(
        isDomainCoveredByWildcard("test.127-0-0-1.nip.io", specialDomainCerts),
        true,
        "Should match subdomain of nip.io wildcard"
    );

    assertEquals(
        isDomainCoveredByWildcard(
            "sub.xn--e1afmkfd.xn--p1ai",
            specialDomainCerts
        ),
        true,
        "Should match subdomain of IDN wildcard"
    );

    // Test case 6: Empty input and edge cases
    const emptyCerts = new Map();

    assertEquals(
        isDomainCoveredByWildcard("any.domain.com", emptyCerts),
        false,
        "Empty certificate map should not match any domain"
    );

    // Test case 7: Domains with single character components
    const singleCharCerts = new Map([
        ["a.com", { exists: true, wildcard: true }],
        ["x.y.z", { exists: true, wildcard: true }]
    ]);

    assertEquals(
        isDomainCoveredByWildcard("b.a.com", singleCharCerts),
        true,
        "Should match single character subdomain"
    );

    assertEquals(
        isDomainCoveredByWildcard("w.x.y.z", singleCharCerts),
        true,
        "Should match single character subdomain of multi-part domain"
    );

    assertEquals(
        isDomainCoveredByWildcard("v.w.x.y.z", singleCharCerts),
        false,
        "Should NOT match multi-level subdomain of single char domain"
    );

    // Test case 8: Domains with numbers and hyphens
    const numericCerts = new Map([
        ["api-v2.service-1.com", { exists: true, wildcard: true }],
        ["123.456.net", { exists: true, wildcard: true }]
    ]);

    assertEquals(
        isDomainCoveredByWildcard("staging.api-v2.service-1.com", numericCerts),
        true,
        "Should match subdomain with hyphens and numbers"
    );

    assertEquals(
        isDomainCoveredByWildcard("test.123.456.net", numericCerts),
        true,
        "Should match subdomain with numeric components"
    );

    assertEquals(
        isDomainCoveredByWildcard(
            "deep.staging.api-v2.service-1.com",
            numericCerts
        ),
        false,
        "Should NOT match multi-level subdomain with hyphens and numbers"
    );

    console.log("All wildcard domain coverage tests passed!");
}

// Run all tests
try {
    runTests();
} catch (error) {
    console.error("Test failed:", error);
    process.exit(1);
}
