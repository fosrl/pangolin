import { describe, it, expect } from "vitest";
import { sanitizeString } from "@server/lib/sanitize";

describe("sanitizeString", () => {
    // ─── Null / Undefined handling ──────────────────────────────────────
    it("returns undefined for null", () => {
        expect(sanitizeString(null)).toBe(undefined);
    });

    it("returns undefined for undefined", () => {
        expect(sanitizeString(undefined)).toBe(undefined);
    });

    // ─── Normal strings pass through ────────────────────────────────────
    it("passes through normal ASCII text", () => {
        expect(sanitizeString("Hello, World!")).toBe("Hello, World!");
    });

    it("passes through unicode text", () => {
        expect(sanitizeString("日本語テスト")).toBe("日本語テスト");
    });

    it("passes through emoji", () => {
        expect(sanitizeString("Hello 🌍")).toBe("Hello 🌍");
    });

    it("preserves allowed whitespace (tab, newline, CR)", () => {
        expect(sanitizeString("line1\nline2")).toBe("line1\nline2");
        expect(sanitizeString("col1\tcol2")).toBe("col1\tcol2");
        expect(sanitizeString("line\r\n")).toBe("line\r\n");
    });

    // ─── Null bytes ─────────────────────────────────────────────────────
    it("strips null bytes", () => {
        expect(sanitizeString("hello\x00world")).toBe("helloworld");
    });

    it("strips null bytes from path injection", () => {
        expect(sanitizeString("/path\x00.jpg")).toBe("/path.jpg");
    });

    // ─── C0 control characters ──────────────────────────────────────────
    it("strips C0 control chars (except HT, LF, CR)", () => {
        // \x01 through \x08 should be stripped
        expect(sanitizeString("a\x01b\x02c")).toBe("abc");
        // \x0B (VT), \x0C (FF) should be stripped
        expect(sanitizeString("a\x0Bb\x0Cc")).toBe("abc");
        // \x0E through \x1F should be stripped  
        expect(sanitizeString("a\x0Eb\x1Fc")).toBe("abc");
    });

    it("strips DEL character (\\x7F)", () => {
        expect(sanitizeString("hello\x7Fworld")).toBe("helloworld");
    });

    // ─── Surrogate handling ─────────────────────────────────────────────
    it("replaces lone high surrogate with replacement char", () => {
        const input = "a\uD800b"; // lone high surrogate
        const result = sanitizeString(input);
        expect(result).toBe("a\uFFFDb");
    });

    it("replaces lone low surrogate with replacement char", () => {
        const input = "a\uDC00b"; // lone low surrogate
        const result = sanitizeString(input);
        expect(result).toBe("a\uFFFDb");
    });

    it("preserves valid surrogate pairs", () => {
        // 💀 = \uD83D\uDC80 (valid pair)
        const input = "skull: 💀";
        expect(sanitizeString(input)).toBe("skull: 💀");
    });

    // ─── Empty string ───────────────────────────────────────────────────
    it("returns empty string for empty input", () => {
        expect(sanitizeString("")).toBe("");
    });

    // ─── Combined threats ───────────────────────────────────────────────
    it("handles multiple threats in one string", () => {
        const input = "malicious\x00\x01\x7Finput\uD800end";
        const result = sanitizeString(input);
        expect(result).toBe("maliciousinput\uFFFDend");
    });
});
