import { describe, it, expect } from "vitest";
import {
    isValidCIDR,
    isValidIP,
    isValidUrlGlobPattern,
    isValidDomain,
    isSecondLevelDomain,
    isUrlValid,
    isTargetValid,
    validateHeaders
} from "@server/lib/validators";

describe("Validators", () => {
    // ─── isValidCIDR ────────────────────────────────────────────────────
    describe("isValidCIDR", () => {
        it("accepts valid IPv4 CIDRs", () => {
            expect(isValidCIDR("10.0.0.0/8")).toBe(true);
            expect(isValidCIDR("192.168.1.0/24")).toBe(true);
            expect(isValidCIDR("172.16.0.0/16")).toBe(true);
            expect(isValidCIDR("0.0.0.0/0")).toBe(true);
        });

        it("rejects invalid CIDRs", () => {
            expect(isValidCIDR("10.0.0.0")).toBe(false);
            expect(isValidCIDR("not-a-cidr")).toBe(false);
            expect(isValidCIDR("")).toBe(false);
        });
    });

    // ─── isValidIP ──────────────────────────────────────────────────────
    describe("isValidIP", () => {
        it("accepts valid IPv4", () => {
            expect(isValidIP("10.0.0.1")).toBe(true);
            expect(isValidIP("192.168.1.1")).toBe(true);
            expect(isValidIP("0.0.0.0")).toBe(true);
            expect(isValidIP("255.255.255.255")).toBe(true);
        });

        it("rejects invalid IPs", () => {
            expect(isValidIP("")).toBe(false);
            expect(isValidIP("not-an-ip")).toBe(false);
            expect(isValidIP("256.0.0.1")).toBe(false);
            expect(isValidIP("10.0.0")).toBe(false);
        });
    });

    // ─── isValidUrlGlobPattern ───────────────────────────────────────────
    describe("isValidUrlGlobPattern", () => {
        // Valid patterns
        it("accepts simple path", () => {
            expect(isValidUrlGlobPattern("simple")).toBe(true);
        });

        it("accepts path with slash", () => {
            expect(isValidUrlGlobPattern("path/to/resource")).toBe(true);
        });

        it("accepts leading slash", () => {
            expect(isValidUrlGlobPattern("/leading/slash")).toBe(true);
        });

        it("accepts trailing slash", () => {
            expect(isValidUrlGlobPattern("path/")).toBe(true);
        });

        it("accepts root path", () => {
            expect(isValidUrlGlobPattern("/")).toBe(true);
        });

        it("accepts wildcards", () => {
            expect(isValidUrlGlobPattern("path/*")).toBe(true);
            expect(isValidUrlGlobPattern("*")).toBe(true);
            expect(isValidUrlGlobPattern("*/subpath")).toBe(true);
            expect(isValidUrlGlobPattern("prefix*suffix")).toBe(true);
        });

        it("accepts special allowed characters", () => {
            expect(isValidUrlGlobPattern("path-with-dash")).toBe(true);
            expect(isValidUrlGlobPattern("path_with_underscore")).toBe(true);
            expect(isValidUrlGlobPattern("path.with.dots")).toBe(true);
            expect(isValidUrlGlobPattern("path~with~tilde")).toBe(true);
            expect(isValidUrlGlobPattern("path@with@at")).toBe(true);
            expect(isValidUrlGlobPattern("path:with:colon")).toBe(true);
        });

        it("accepts percent-encoded sequences", () => {
            expect(isValidUrlGlobPattern("path%20with%20spaces")).toBe(true);
        });

        // Invalid patterns
        it("rejects empty string", () => {
            expect(isValidUrlGlobPattern("")).toBe(false);
        });

        it("rejects double slashes", () => {
            expect(isValidUrlGlobPattern("//double/slash")).toBe(false);
            expect(isValidUrlGlobPattern("path//end")).toBe(false);
        });

        it("rejects angle brackets", () => {
            expect(isValidUrlGlobPattern("invalid<char>")).toBe(false);
        });

        it("rejects pipe character", () => {
            expect(isValidUrlGlobPattern("invalid|char")).toBe(false);
        });

        it("rejects backtick", () => {
            expect(isValidUrlGlobPattern("invalid`char")).toBe(false);
        });

        it("rejects square brackets", () => {
            expect(isValidUrlGlobPattern("invalid[char]")).toBe(false);
        });

        it("rejects curly braces", () => {
            expect(isValidUrlGlobPattern("invalid{char}")).toBe(false);
        });

        it("rejects invalid percent encoding", () => {
            expect(isValidUrlGlobPattern("invalid%2")).toBe(false);
            expect(isValidUrlGlobPattern("invalid%GZ")).toBe(false);
            expect(isValidUrlGlobPattern("invalid%")).toBe(false);
        });
    });

    // ─── isValidDomain ──────────────────────────────────────────────────
    describe("isValidDomain", () => {
        it("accepts valid domains", () => {
            expect(isValidDomain("example.com")).toBe(true);
            expect(isValidDomain("sub.example.com")).toBe(true);
            expect(isValidDomain("deep.sub.example.com")).toBe(true);
        });

        it("rejects domains without TLD", () => {
            expect(isValidDomain("localhost")).toBe(false);
        });

        it("rejects domains starting with dot", () => {
            expect(isValidDomain(".example.com")).toBe(false);
        });

        it("rejects domains ending with dot", () => {
            expect(isValidDomain("example.com.")).toBe(false);
        });

        it("rejects domains with double dots", () => {
            expect(isValidDomain("example..com")).toBe(false);
        });

        it("rejects labels starting with hyphen", () => {
            expect(isValidDomain("-example.com")).toBe(false);
        });

        it("rejects labels ending with hyphen", () => {
            expect(isValidDomain("example-.com")).toBe(false);
        });

        it("rejects domain over 253 chars", () => {
            const longDomain = "a".repeat(250) + ".com";
            expect(isValidDomain(longDomain)).toBe(false);
        });

        it("rejects labels over 63 chars", () => {
            const longLabel = "a".repeat(64) + ".com";
            expect(isValidDomain(longLabel)).toBe(false);
        });

        it("rejects TLD with numbers only", () => {
            expect(isValidDomain("example.123")).toBe(false);
        });
    });

    // ─── isSecondLevelDomain ────────────────────────────────────────────
    describe("isSecondLevelDomain", () => {
        it("returns true for second-level domains", () => {
            expect(isSecondLevelDomain("example.com")).toBe(true);
            expect(isSecondLevelDomain("google.io")).toBe(true);
        });

        it("returns false for subdomains", () => {
            expect(isSecondLevelDomain("sub.example.com")).toBe(false);
        });

        it("returns false for TLD only", () => {
            expect(isSecondLevelDomain("com")).toBe(false);
        });

        it("handles case insensitivity", () => {
            expect(isSecondLevelDomain("EXAMPLE.COM")).toBe(true);
        });

        it("returns false for empty/null inputs", () => {
            expect(isSecondLevelDomain("")).toBe(false);
            expect(isSecondLevelDomain(null as any)).toBe(false);
            expect(isSecondLevelDomain(undefined as any)).toBe(false);
        });
    });

    // ─── isUrlValid ─────────────────────────────────────────────────────
    describe("isUrlValid", () => {
        it("accepts valid URLs", () => {
            expect(isUrlValid("https://example.com")).toBe(true);
            expect(isUrlValid("http://example.com")).toBe(true);
            expect(isUrlValid("https://sub.example.com/path")).toBe(true);
        });

        it("returns true for empty/undefined (optional)", () => {
            expect(isUrlValid(undefined)).toBe(true);
            expect(isUrlValid("")).toBe(true);
        });

        it("rejects invalid URLs", () => {
            expect(isUrlValid("not a url")).toBe(false);
            expect(isUrlValid("ftp://example.com")).toBe(false);
        });
    });

    // ─── isTargetValid ──────────────────────────────────────────────────
    describe("isTargetValid", () => {
        it("returns true for valid IPs", () => {
            expect(isTargetValid("10.0.0.1")).toBe(true);
            expect(isTargetValid("192.168.1.1")).toBe(true);
        });

        it("returns true for valid domains", () => {
            expect(isTargetValid("example.com")).toBe(true);
            expect(isTargetValid("sub.example.com")).toBe(true);
        });

        it("returns true for undefined (optional)", () => {
            expect(isTargetValid(undefined)).toBe(true);
        });

        it("rejects invalid targets", () => {
            expect(isTargetValid("not a valid target!")).toBe(false);
        });
    });

    // ─── validateHeaders ────────────────────────────────────────────────
    describe("validateHeaders", () => {
        it("accepts valid header pairs", () => {
            expect(validateHeaders("X-Custom-Header: value")).toBe(true);
            expect(
                validateHeaders("Authorization: Bearer token123")
            ).toBe(true);
        });

        it("accepts simple header", () => {
            expect(validateHeaders("X-Key: myvalue")).toBe(true);
        });

        it("accepts multiple comma-separated headers", () => {
            expect(
                validateHeaders("X-Header1: val1, X-Header2: val2")
            ).toBe(true);
        });

        it("rejects headers without colon", () => {
            expect(validateHeaders("invalid-header")).toBe(false);
        });

        it("rejects empty header name", () => {
            expect(validateHeaders(": value")).toBe(false);
        });

        it("rejects empty header value", () => {
            expect(validateHeaders("Header:")).toBe(false);
        });

        it("rejects header value with colon", () => {
            expect(validateHeaders("Header: value:extra")).toBe(false);
        });

        it("rejects multiple colons per pair", () => {
            expect(validateHeaders("Header: value: more")).toBe(false);
        });
    });
});
