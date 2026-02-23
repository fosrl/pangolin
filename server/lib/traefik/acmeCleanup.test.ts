import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { assertEquals } from "@test/assert";

/**
 * Standalone test for ACME JSON cleanup logic.
 *
 * Since the actual removeDomainFromAcmeJson function depends on the config
 * module (which requires DB setup), we test the core logic directly here
 * by extracting and testing the same algorithm.
 */

// ---- Core logic extracted from acmeCleanup.ts for testability ----

interface AcmeCertificate {
    domain: {
        main: string;
        sans?: string[];
    };
    certificate: string;
    key: string;
}

interface AcmeResolver {
    Account?: any;
    Certificates?: AcmeCertificate[];
}

type AcmeJson = Record<string, AcmeResolver>;

function removeDomainFromAcmeData(
    acmeData: AcmeJson,
    domain: string
): { modified: boolean; result: AcmeJson } {
    let modified = false;

    for (const resolverName of Object.keys(acmeData)) {
        const resolver = acmeData[resolverName];
        if (!resolver.Certificates || !Array.isArray(resolver.Certificates)) {
            continue;
        }

        const originalLength = resolver.Certificates.length;
        resolver.Certificates = resolver.Certificates.filter((cert) => {
            const isMatch =
                cert.domain.main === domain ||
                cert.domain.sans?.includes(domain);
            return !isMatch;
        });

        if (resolver.Certificates.length !== originalLength) {
            modified = true;
        }
    }

    return { modified, result: acmeData };
}

// ---- Tests ----

function runTests() {
    console.log("Running ACME cleanup tests...\n");

    // Test 1: Remove a domain that exists as main domain
    {
        const acmeData: AcmeJson = {
            letsencrypt: {
                Account: { email: "test@example.com" },
                Certificates: [
                    {
                        domain: { main: "app.example.com" },
                        certificate: "cert1",
                        key: "key1"
                    },
                    {
                        domain: { main: "other.example.com" },
                        certificate: "cert2",
                        key: "key2"
                    }
                ]
            }
        };

        const { modified, result } = removeDomainFromAcmeData(
            structuredClone(acmeData),
            "app.example.com"
        );

        assertEquals(modified, true, "Should detect modification");
        assertEquals(
            result.letsencrypt.Certificates!.length,
            1,
            "Should have 1 cert remaining"
        );
        assertEquals(
            result.letsencrypt.Certificates![0].domain.main,
            "other.example.com",
            "Should keep the other cert"
        );
        console.log("  PASS: Remove domain that exists as main domain");
    }

    // Test 2: Remove a domain that exists in SANs
    {
        const acmeData: AcmeJson = {
            letsencrypt: {
                Certificates: [
                    {
                        domain: {
                            main: "*.example.com",
                            sans: ["app.example.com", "api.example.com"]
                        },
                        certificate: "cert1",
                        key: "key1"
                    }
                ]
            }
        };

        const { modified, result } = removeDomainFromAcmeData(
            structuredClone(acmeData),
            "app.example.com"
        );

        assertEquals(
            modified,
            true,
            "Should detect modification for SAN match"
        );
        assertEquals(
            result.letsencrypt.Certificates!.length,
            0,
            "Should remove cert when domain is in SANs"
        );
        console.log("  PASS: Remove domain that exists in SANs");
    }

    // Test 3: Domain not found — no modification
    {
        const acmeData: AcmeJson = {
            letsencrypt: {
                Certificates: [
                    {
                        domain: { main: "other.example.com" },
                        certificate: "cert1",
                        key: "key1"
                    }
                ]
            }
        };

        const { modified, result } = removeDomainFromAcmeData(
            structuredClone(acmeData),
            "app.example.com"
        );

        assertEquals(
            modified,
            false,
            "Should not modify when domain not found"
        );
        assertEquals(
            result.letsencrypt.Certificates!.length,
            1,
            "Should keep all certs"
        );
        console.log("  PASS: No modification when domain not found");
    }

    // Test 4: Multiple resolvers
    {
        const acmeData: AcmeJson = {
            letsencrypt: {
                Certificates: [
                    {
                        domain: { main: "app.example.com" },
                        certificate: "cert1",
                        key: "key1"
                    }
                ]
            },
            customresolver: {
                Certificates: [
                    {
                        domain: { main: "app.example.com" },
                        certificate: "cert2",
                        key: "key2"
                    },
                    {
                        domain: { main: "keep.example.com" },
                        certificate: "cert3",
                        key: "key3"
                    }
                ]
            }
        };

        const { modified, result } = removeDomainFromAcmeData(
            structuredClone(acmeData),
            "app.example.com"
        );

        assertEquals(
            modified,
            true,
            "Should detect modification across resolvers"
        );
        assertEquals(
            result.letsencrypt.Certificates!.length,
            0,
            "Should remove from first resolver"
        );
        assertEquals(
            result.customresolver.Certificates!.length,
            1,
            "Should remove from second resolver but keep other cert"
        );
        assertEquals(
            result.customresolver.Certificates![0].domain.main,
            "keep.example.com",
            "Should keep unrelated cert in second resolver"
        );
        console.log("  PASS: Remove from multiple resolvers");
    }

    // Test 5: Empty Certificates array
    {
        const acmeData: AcmeJson = {
            letsencrypt: {
                Account: { email: "test@example.com" },
                Certificates: []
            }
        };

        const { modified, result } = removeDomainFromAcmeData(
            structuredClone(acmeData),
            "app.example.com"
        );

        assertEquals(modified, false, "Should not modify empty Certificates");
        assertEquals(
            result.letsencrypt.Certificates!.length,
            0,
            "Should remain empty"
        );
        console.log("  PASS: Handle empty Certificates array");
    }

    // Test 6: Resolver without Certificates key
    {
        const acmeData: AcmeJson = {
            letsencrypt: {
                Account: { email: "test@example.com" }
            }
        };

        const { modified } = removeDomainFromAcmeData(
            structuredClone(acmeData),
            "app.example.com"
        );

        assertEquals(
            modified,
            false,
            "Should not modify resolver without Certificates"
        );
        console.log("  PASS: Handle resolver without Certificates key");
    }

    // Test 7: File read/write roundtrip
    {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "acme-test-"));
        const acmeJsonPath = path.join(tmpDir, "acme.json");

        const acmeData: AcmeJson = {
            letsencrypt: {
                Account: { email: "test@example.com" },
                Certificates: [
                    {
                        domain: { main: "app.example.com" },
                        certificate: "base64cert",
                        key: "base64key"
                    },
                    {
                        domain: { main: "keep.example.com" },
                        certificate: "base64cert2",
                        key: "base64key2"
                    }
                ]
            }
        };

        // Write initial acme.json
        fs.writeFileSync(acmeJsonPath, JSON.stringify(acmeData, null, 2), {
            encoding: "utf8",
            mode: 0o600
        });

        // Read, modify, write back
        const rawContent = fs.readFileSync(acmeJsonPath, "utf8");
        const parsed: AcmeJson = JSON.parse(rawContent);
        const { modified, result } = removeDomainFromAcmeData(
            parsed,
            "app.example.com"
        );

        assertEquals(modified, true, "Should detect modification in roundtrip");

        fs.writeFileSync(acmeJsonPath, JSON.stringify(result, null, 2), {
            encoding: "utf8",
            mode: 0o600
        });

        // Verify written file
        const verifyContent = fs.readFileSync(acmeJsonPath, "utf8");
        const verifyParsed: AcmeJson = JSON.parse(verifyContent);

        assertEquals(
            verifyParsed.letsencrypt.Certificates!.length,
            1,
            "Written file should have 1 cert"
        );
        assertEquals(
            verifyParsed.letsencrypt.Certificates![0].domain.main,
            "keep.example.com",
            "Written file should keep correct cert"
        );
        assertEquals(
            verifyParsed.letsencrypt.Account.email,
            "test@example.com",
            "Account info should be preserved"
        );

        // Cleanup
        fs.rmSync(tmpDir, { recursive: true, force: true });
        console.log("  PASS: File read/write roundtrip");
    }

    // Test 8: Only exact domain match, not partial string match
    {
        const acmeData: AcmeJson = {
            letsencrypt: {
                Certificates: [
                    {
                        domain: { main: "app.example.com" },
                        certificate: "cert1",
                        key: "key1"
                    },
                    {
                        domain: { main: "myapp.example.com" },
                        certificate: "cert2",
                        key: "key2"
                    },
                    {
                        domain: { main: "app.example.com.evil.com" },
                        certificate: "cert3",
                        key: "key3"
                    }
                ]
            }
        };

        const { modified, result } = removeDomainFromAcmeData(
            structuredClone(acmeData),
            "app.example.com"
        );

        assertEquals(modified, true, "Should only remove exact match");
        assertEquals(
            result.letsencrypt.Certificates!.length,
            2,
            "Should keep non-matching certs"
        );
        assertEquals(
            result.letsencrypt.Certificates![0].domain.main,
            "myapp.example.com",
            "Should keep myapp.example.com"
        );
        assertEquals(
            result.letsencrypt.Certificates![1].domain.main,
            "app.example.com.evil.com",
            "Should keep app.example.com.evil.com"
        );
        console.log("  PASS: Only exact domain match, no partial string match");
    }

    console.log("\nAll ACME cleanup tests passed!");
}

// Run all tests
try {
    runTests();
} catch (error) {
    console.error("Test failed:", error);
    process.exit(1);
}
