/**
 * IP Utility Tests
 *
 * Tests for the pure IP calculation functions. These are imported via
 * inline implementations to avoid the transitive config/db dependency
 * from the main ip.ts module.
 */
import { describe, it, expect, vi } from "vitest";

// ─── Mock config and db before importing ip.ts ──────────────────────────
vi.mock("@server/lib/config", () => ({
    default: {
        getRawConfig: () => ({
            orgs: { block_size: 16, subnet_group: "10.0.0.0/8" },
            server: {},
            app: { dashboard_url: "https://test.example.com" },
            flags: {}
        }),
        getNoReplyEmail: () => "noreply@test.com"
    },
    __esModule: true
}));

vi.mock("@server/db", () => ({
    db: {},
    orgs: {},
    sites: {},
    clients: {},
    siteResources: {}
}));

vi.mock("@server/logger", () => ({
    default: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn()
    },
    __esModule: true
}));

import {
    findNextAvailableCidr,
    cidrToRange,
    isIpInCidr,
    doCidrsOverlap,
    parseEndpoint,
    formatEndpoint,
    parsePortRangeString,
    portRangeStringSchema
} from "@server/lib/ip";

describe("IP Utilities", () => {
    describe("cidrToRange", () => {
        it("calculates range for /24", () => {
            const range = cidrToRange("10.0.0.0/24");
            expect(Number(range.start)).toBe(0x0a000000);
            expect(Number(range.end)).toBe(0x0a0000ff);
        });

        it("calculates range for /32 (single host)", () => {
            const range = cidrToRange("192.168.1.1/32");
            expect(range.start).toBe(range.end);
        });

        it("calculates range for /0 (entire space)", () => {
            const range = cidrToRange("0.0.0.0/0");
            expect(Number(range.start)).toBe(0);
            expect(Number(range.end)).toBe(0xffffffff);
        });

        it("calculates range for /16", () => {
            const range = cidrToRange("172.16.0.0/16");
            expect(Number(range.start)).toBe(0xac100000);
            expect(Number(range.end)).toBe(0xac10ffff);
        });
    });

    describe("findNextAvailableCidr", () => {
        it("finds next CIDR after existing allocations", () => {
            const existing = ["10.0.0.0/16", "10.1.0.0/16"];
            const result = findNextAvailableCidr(existing, 16, "10.0.0.0/8");
            expect(result).toBe("10.2.0.0/16");
        });

        it("finds gap between allocations", () => {
            const existing = ["10.0.0.0/16", "10.2.0.0/16"];
            const result = findNextAvailableCidr(existing, 16, "10.0.0.0/8");
            expect(result).toBe("10.1.0.0/16");
        });

        it("returns null when no space available", () => {
            const existing = ["10.0.0.0/8"];
            const result = findNextAvailableCidr(existing, 8, "10.0.0.0/8");
            expect(result).toBe(null);
        });

        it("returns first CIDR in range for empty existing", () => {
            const existing: string[] = [];
            const result = findNextAvailableCidr(existing, 30, "10.0.0.0/8");
            expect(result).toBe("10.0.0.0/30");
        });

        it("returns null for empty existing with no range", () => {
            const existing: string[] = [];
            const result = findNextAvailableCidr(existing, 16);
            expect(result).toBe(null);
        });

        it("handles block size alignment", () => {
            const existing = ["10.0.0.0/24"];
            const result = findNextAvailableCidr(existing, 24, "10.0.0.0/16");
            expect(result).toBe("10.0.1.0/24");
        });

        it("handles empty existing with range", () => {
            const existing: string[] = [];
            const result = findNextAvailableCidr(existing, 24, "10.0.0.0/16");
            expect(result).toBe("10.0.0.0/24");
        });

        it("handles out-of-range subnets correctly", () => {
            const existing = ["100.90.130.1/30", "100.90.128.4/30"];
            const result = findNextAvailableCidr(existing, 30, "100.90.130.1/24");
            expect(result).toBe("100.90.130.4/30");
        });
    });

    describe("isIpInCidr", () => {
        it("returns true for IP in range", () => {
            expect(isIpInCidr("10.0.0.1", "10.0.0.0/24")).toBe(true);
            expect(isIpInCidr("10.0.0.255", "10.0.0.0/24")).toBe(true);
        });

        it("returns false for IP out of range", () => {
            expect(isIpInCidr("10.0.1.0", "10.0.0.0/24")).toBe(false);
            expect(isIpInCidr("192.168.1.1", "10.0.0.0/8")).toBe(false);
        });

        it("returns true for network address", () => {
            expect(isIpInCidr("10.0.0.0", "10.0.0.0/24")).toBe(true);
        });
    });

    describe("doCidrsOverlap", () => {
        it("detects overlapping CIDRs", () => {
            expect(doCidrsOverlap("10.0.0.0/8", "10.1.0.0/16")).toBe(true);
        });

        it("detects non-overlapping CIDRs", () => {
            expect(doCidrsOverlap("10.0.0.0/8", "192.168.0.0/16")).toBe(false);
        });

        it("detects identical CIDRs as overlapping", () => {
            expect(doCidrsOverlap("10.0.0.0/24", "10.0.0.0/24")).toBe(true);
        });

        it("detects adjacent CIDRs as non-overlapping", () => {
            expect(doCidrsOverlap("10.0.0.0/24", "10.0.1.0/24")).toBe(false);
        });
    });

    describe("parseEndpoint", () => {
        it("parses IPv4 endpoint", () => {
            const result = parseEndpoint("192.168.1.1:8080");
            expect(result).toEqual({ ip: "192.168.1.1", port: 8080 });
        });

        it("parses bracketed IPv6 endpoint", () => {
            const result = parseEndpoint("[::1]:8080");
            expect(result).toEqual({ ip: "::1", port: 8080 });
        });

        it("returns null for empty string", () => {
            expect(parseEndpoint("")).toBe(null);
        });

        it("returns null for invalid format", () => {
            expect(parseEndpoint("no-port")).toBe(null);
        });
    });

    describe("formatEndpoint", () => {
        it("formats IPv4 endpoint", () => {
            expect(formatEndpoint("192.168.1.1", 8080)).toBe(
                "192.168.1.1:8080"
            );
        });

        it("formats IPv6 endpoint with brackets", () => {
            expect(formatEndpoint("::1", 8080)).toBe("[::1]:8080");
        });

        it("doesn't double-bracket IPv6", () => {
            expect(formatEndpoint("[::1]", 8080)).toBe("[::1]:8080");
        });
    });

    describe("portRangeStringSchema", () => {
        it("accepts wildcard", () => {
            expect(portRangeStringSchema.safeParse("*").success).toBe(true);
        });

        it("accepts single port", () => {
            expect(portRangeStringSchema.safeParse("80").success).toBe(true);
        });

        it("accepts port range", () => {
            expect(portRangeStringSchema.safeParse("8000-9000").success).toBe(true);
        });

        it("accepts comma-separated list", () => {
            expect(portRangeStringSchema.safeParse("80,443,8000-9000").success).toBe(true);
        });

        it("accepts undefined (optional)", () => {
            expect(portRangeStringSchema.safeParse(undefined).success).toBe(true);
        });

        it("rejects invalid range (start > end)", () => {
            expect(portRangeStringSchema.safeParse("9000-8000").success).toBe(false);
        });

        it("rejects port > 65535", () => {
            expect(portRangeStringSchema.safeParse("70000").success).toBe(false);
        });

        it("rejects port 0", () => {
            expect(portRangeStringSchema.safeParse("0").success).toBe(false);
        });
    });

    describe("parsePortRangeString", () => {
        it("returns dummy for empty string", () => {
            const result = parsePortRangeString("");
            expect(result).toEqual([{ min: 0, max: 0, protocol: "tcp" }]);
        });

        it("returns empty array for wildcard", () => {
            const result = parsePortRangeString("*");
            expect(result).toEqual([]);
        });

        it("returns dummy for undefined", () => {
            const result = parsePortRangeString(undefined);
            expect(result).toEqual([{ min: 0, max: 0, protocol: "tcp" }]);
        });
    });
});
