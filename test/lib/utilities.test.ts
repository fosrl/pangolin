import { describe, it, expect } from "vitest";
import { normalizePostAuthPath } from "@server/lib/normalizePostAuthPath";
import stoi from "@server/lib/stoi";

describe("normalizePostAuthPath", () => {
    // ─── Normal paths ───────────────────────────────────────────────────
    it("returns path with leading slash", () => {
        expect(normalizePostAuthPath("/dashboard")).toBe("/dashboard");
    });

    it("adds leading slash if missing", () => {
        expect(normalizePostAuthPath("dashboard")).toBe("/dashboard");
    });

    it("preserves nested paths", () => {
        expect(normalizePostAuthPath("/admin/settings")).toBe(
            "/admin/settings"
        );
    });

    // ─── Null/Undefined/Empty ───────────────────────────────────────────
    it("returns null for null", () => {
        expect(normalizePostAuthPath(null)).toBe(null);
    });

    it("returns null for undefined", () => {
        expect(normalizePostAuthPath(undefined)).toBe(null);
    });

    it("returns null for empty string", () => {
        expect(normalizePostAuthPath("")).toBe(null);
    });

    it("returns null for whitespace-only string", () => {
        expect(normalizePostAuthPath("   ")).toBe(null);
    });

    // ─── Open redirect prevention ───────────────────────────────────────
    it("returns null for protocol-relative URLs (//)", () => {
        expect(normalizePostAuthPath("//evil.com")).toBe(null);
    });

    it("returns null for scheme URLs", () => {
        expect(normalizePostAuthPath("https://evil.com")).toBe(null);
        expect(normalizePostAuthPath("http://evil.com")).toBe(null);
        expect(normalizePostAuthPath("javascript:alert(1)")).toBe(null);
    });

    it("returns null for path with colon", () => {
        expect(normalizePostAuthPath("data:text/html")).toBe(null);
    });

    // ─── Trimming ───────────────────────────────────────────────────────
    it("trims leading/trailing whitespace", () => {
        expect(normalizePostAuthPath("  /dashboard  ")).toBe("/dashboard");
    });
});

describe("stoi (string-to-integer)", () => {
    it("converts string to integer", () => {
        expect(stoi("42")).toBe(42);
    });

    it("converts string with leading zeros", () => {
        expect(stoi("007")).toBe(7);
    });

    it("returns NaN for non-numeric string", () => {
        expect(stoi("abc")).toBeNaN();
    });

    it("passes through non-string values", () => {
        expect(stoi(42)).toBe(42);
        expect(stoi(0)).toBe(0);
        expect(stoi(null)).toBe(null);
        expect(stoi(undefined)).toBe(undefined);
    });

    it("converts negative number strings", () => {
        expect(stoi("-5")).toBe(-5);
    });

    it("truncates float strings (parseInt behavior)", () => {
        expect(stoi("3.14")).toBe(3);
    });
});
