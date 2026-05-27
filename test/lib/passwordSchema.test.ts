import { describe, it, expect } from "vitest";
import { passwordSchema } from "@server/auth/passwordSchema";

describe("passwordSchema", () => {
    // ─── Valid passwords ────────────────────────────────────────────────
    it("accepts valid password with all requirements", () => {
        expect(passwordSchema.safeParse("TestPassword1!").success).toBe(true);
    });

    it("accepts password at minimum length (8 chars)", () => {
        expect(passwordSchema.safeParse("Aa1!xxxx").success).toBe(true);
    });

    it("accepts password at maximum length (128 chars)", () => {
        const pw = "Aa1!" + "x".repeat(124);
        expect(passwordSchema.safeParse(pw).success).toBe(true);
    });

    it("accepts various special characters", () => {
        const specials = [
            "~", "!", "`", "@", "#", "$", "%", "^", "&", "*",
            "(", ")", "_", "-", "+", "=", "{", "}", "[", "]",
            "|", "\\", ":", ";", '"', "'", "<", ">", ",", ".",
            "/", "?"
        ];
        for (const s of specials) {
            const pw = `Aa1${s}xxxx`;
            const result = passwordSchema.safeParse(pw);
            expect(result.success).toBe(true);
        }
    });

    // ─── Missing requirements ───────────────────────────────────────────
    it("rejects password without uppercase", () => {
        expect(passwordSchema.safeParse("testpassword1!").success).toBe(false);
    });

    it("rejects password without lowercase", () => {
        expect(passwordSchema.safeParse("TESTPASSWORD1!").success).toBe(false);
    });

    it("rejects password without digit", () => {
        expect(passwordSchema.safeParse("TestPassword!x").success).toBe(false);
    });

    it("rejects password without special character", () => {
        expect(passwordSchema.safeParse("TestPassword1x").success).toBe(false);
    });

    // ─── Length violations ──────────────────────────────────────────────
    it("rejects password under 8 chars", () => {
        expect(passwordSchema.safeParse("Aa1!xxx").success).toBe(false);
    });

    it("rejects password over 128 chars", () => {
        const pw = "Aa1!" + "x".repeat(125);
        expect(pw.length).toBe(129);
        expect(passwordSchema.safeParse(pw).success).toBe(false);
    });

    // ─── Edge cases ─────────────────────────────────────────────────────
    it("rejects empty string", () => {
        expect(passwordSchema.safeParse("").success).toBe(false);
    });

    it("rejects non-string types", () => {
        expect(passwordSchema.safeParse(12345678).success).toBe(false);
        expect(passwordSchema.safeParse(null).success).toBe(false);
        expect(passwordSchema.safeParse(undefined).success).toBe(false);
    });
});
