/**
 * Auth Schema Tests
 *
 * Tests the Zod validation schemas used by auth route handlers.
 * Schemas are re-defined here to avoid importing modules that
 * transitively load config/db dependencies.
 */
import { describe, it, expect } from "vitest";
import { z } from "zod";
import { passwordSchema } from "@server/auth/passwordSchema";

// ─── Schema re-definitions (from source) ──────────────────────────────

// From login.ts
const loginBodySchema = z.strictObject({
    email: z.email().toLowerCase(),
    password: z.string(),
    code: z.string().optional(),
    resourceGuid: z.string().optional()
});

// From signup.ts
const signupBodySchema = z.strictObject({
    email: z.email().toLowerCase(),
    password: passwordSchema,
    inviteToken: z.string().optional(),
    inviteId: z.string().optional(),
    termsAcceptedTimestamp: z.string().nullable().optional(),
    marketingEmailConsent: z.boolean().optional()
});

// From resetPassword.ts
const resetPasswordBody = z.strictObject({
    email: z.email().toLowerCase(),
    token: z.string(),
    newPassword: passwordSchema,
    code: z.string().optional()
});

// From changePassword.ts
const changePasswordBody = z.strictObject({
    oldPassword: z.string(),
    newPassword: passwordSchema,
    code: z.string().optional()
});

// From requestTotpSecret.ts
const requestTotpSecretBody = z.strictObject({
    password: z.string(),
    email: z.email().optional()
});

// From verifyTotp.ts
const verifyTotpBody = z.strictObject({
    email: z.email().optional(),
    password: z.string().optional(),
    code: z.string()
});

// From disable2fa.ts
const disable2faBody = z.strictObject({
    password: z.string(),
    code: z.string().optional()
});

// A password that satisfies passwordSchema constraints
const VALID_PASSWORD = "TestPassword1!";

describe("Auth Schemas", () => {
    // ─── Login Schema ───────────────────────────────────────────────────
    describe("loginBodySchema", () => {
        it("accepts valid login body", () => {
            const result = loginBodySchema.safeParse({
                email: "user@example.com",
                password: "mypassword"
            });
            expect(result.success).toBe(true);
        });

        it("lowercases email", () => {
            const result = loginBodySchema.safeParse({
                email: "User@Example.COM",
                password: "mypassword"
            });
            expect(result.success).toBe(true);
            if (result.success) {
                expect(result.data.email).toBe("user@example.com");
            }
        });

        it("accepts optional code for 2FA", () => {
            const result = loginBodySchema.safeParse({
                email: "user@example.com",
                password: "mypassword",
                code: "123456"
            });
            expect(result.success).toBe(true);
        });

        it("accepts optional resourceGuid", () => {
            const result = loginBodySchema.safeParse({
                email: "user@example.com",
                password: "mypassword",
                resourceGuid: "some-guid-123"
            });
            expect(result.success).toBe(true);
        });

        it("rejects invalid email", () => {
            const result = loginBodySchema.safeParse({
                email: "not-an-email",
                password: "mypassword"
            });
            expect(result.success).toBe(false);
        });

        it("rejects missing password", () => {
            const result = loginBodySchema.safeParse({
                email: "user@example.com"
            });
            expect(result.success).toBe(false);
        });

        it("rejects missing email", () => {
            const result = loginBodySchema.safeParse({
                password: "mypassword"
            });
            expect(result.success).toBe(false);
        });

        it("rejects extra fields (strictObject)", () => {
            const result = loginBodySchema.safeParse({
                email: "user@example.com",
                password: "mypassword",
                extraField: "should-fail"
            });
            expect(result.success).toBe(false);
        });

        it("rejects empty body", () => {
            const result = loginBodySchema.safeParse({});
            expect(result.success).toBe(false);
        });
    });

    // ─── Signup Schema ──────────────────────────────────────────────────
    describe("signupBodySchema", () => {
        it("accepts valid signup body", () => {
            const result = signupBodySchema.safeParse({
                email: "newuser@example.com",
                password: VALID_PASSWORD
            });
            expect(result.success).toBe(true);
        });

        it("lowercases email", () => {
            const result = signupBodySchema.safeParse({
                email: "NewUser@Example.COM",
                password: VALID_PASSWORD
            });
            expect(result.success).toBe(true);
            if (result.success) {
                expect(result.data.email).toBe("newuser@example.com");
            }
        });

        it("accepts invite token and id", () => {
            const result = signupBodySchema.safeParse({
                email: "newuser@example.com",
                password: VALID_PASSWORD,
                inviteToken: "abc123",
                inviteId: "invite-1"
            });
            expect(result.success).toBe(true);
        });

        it("accepts termsAcceptedTimestamp for SaaS", () => {
            const result = signupBodySchema.safeParse({
                email: "newuser@example.com",
                password: VALID_PASSWORD,
                termsAcceptedTimestamp: "2025-01-01T00:00:00Z"
            });
            expect(result.success).toBe(true);
        });

        it("accepts null termsAcceptedTimestamp", () => {
            const result = signupBodySchema.safeParse({
                email: "newuser@example.com",
                password: VALID_PASSWORD,
                termsAcceptedTimestamp: null
            });
            expect(result.success).toBe(true);
        });

        it("accepts marketingEmailConsent", () => {
            const result = signupBodySchema.safeParse({
                email: "newuser@example.com",
                password: VALID_PASSWORD,
                marketingEmailConsent: true
            });
            expect(result.success).toBe(true);
        });

        it("rejects weak password (no uppercase)", () => {
            const result = signupBodySchema.safeParse({
                email: "newuser@example.com",
                password: "weakpassword1!"
            });
            expect(result.success).toBe(false);
        });

        it("rejects weak password (no digit)", () => {
            const result = signupBodySchema.safeParse({
                email: "newuser@example.com",
                password: "WeakPassword!"
            });
            expect(result.success).toBe(false);
        });

        it("rejects weak password (no special char)", () => {
            const result = signupBodySchema.safeParse({
                email: "newuser@example.com",
                password: "WeakPassword1"
            });
            expect(result.success).toBe(false);
        });

        it("rejects short password (< 8 chars)", () => {
            const result = signupBodySchema.safeParse({
                email: "newuser@example.com",
                password: "Aa1!"
            });
            expect(result.success).toBe(false);
        });

        it("rejects long password (> 128 chars)", () => {
            // Construct a 129-char password that meets all other requirements
            const longPassword = "A".repeat(121) + "a1!bcdef"; // 121 + 8 = 129
            const result = signupBodySchema.safeParse({
                email: "newuser@example.com",
                password: longPassword
            });
            expect(result.success).toBe(false);
        });

        it("rejects invalid email", () => {
            const result = signupBodySchema.safeParse({
                email: "not-an-email",
                password: VALID_PASSWORD
            });
            expect(result.success).toBe(false);
        });

        it("rejects missing email", () => {
            const result = signupBodySchema.safeParse({
                password: VALID_PASSWORD
            });
            expect(result.success).toBe(false);
        });

        it("rejects missing password", () => {
            const result = signupBodySchema.safeParse({
                email: "newuser@example.com"
            });
            expect(result.success).toBe(false);
        });
    });

    // ─── Reset Password Schema ──────────────────────────────────────────
    describe("resetPasswordBody", () => {
        it("accepts valid reset body", () => {
            const result = resetPasswordBody.safeParse({
                email: "user@example.com",
                token: "reset-token-123",
                newPassword: VALID_PASSWORD
            });
            expect(result.success).toBe(true);
        });

        it("lowercases email", () => {
            const result = resetPasswordBody.safeParse({
                email: "User@Example.COM",
                token: "reset-token-123",
                newPassword: VALID_PASSWORD
            });
            expect(result.success).toBe(true);
            if (result.success) {
                expect(result.data.email).toBe("user@example.com");
            }
        });

        it("accepts optional 2FA code", () => {
            const result = resetPasswordBody.safeParse({
                email: "user@example.com",
                token: "reset-token-123",
                newPassword: VALID_PASSWORD,
                code: "123456"
            });
            expect(result.success).toBe(true);
        });

        it("enforces password schema on newPassword", () => {
            const result = resetPasswordBody.safeParse({
                email: "user@example.com",
                token: "reset-token-123",
                newPassword: "weak"
            });
            expect(result.success).toBe(false);
        });

        it("rejects missing token", () => {
            const result = resetPasswordBody.safeParse({
                email: "user@example.com",
                newPassword: VALID_PASSWORD
            });
            expect(result.success).toBe(false);
        });

        it("rejects extra fields (strictObject)", () => {
            const result = resetPasswordBody.safeParse({
                email: "user@example.com",
                token: "reset-token-123",
                newPassword: VALID_PASSWORD,
                extraField: "nope"
            });
            expect(result.success).toBe(false);
        });
    });

    // ─── Change Password Schema ─────────────────────────────────────────
    describe("changePasswordBody", () => {
        it("accepts valid change password body", () => {
            const result = changePasswordBody.safeParse({
                oldPassword: "OldPassword1!",
                newPassword: VALID_PASSWORD
            });
            expect(result.success).toBe(true);
        });

        it("accepts optional 2FA code", () => {
            const result = changePasswordBody.safeParse({
                oldPassword: "OldPassword1!",
                newPassword: VALID_PASSWORD,
                code: "123456"
            });
            expect(result.success).toBe(true);
        });

        it("enforces password schema on newPassword", () => {
            const result = changePasswordBody.safeParse({
                oldPassword: "OldPassword1!",
                newPassword: "weak"
            });
            expect(result.success).toBe(false);
        });

        it("rejects missing oldPassword", () => {
            const result = changePasswordBody.safeParse({
                newPassword: VALID_PASSWORD
            });
            expect(result.success).toBe(false);
        });

        it("rejects extra fields (strictObject)", () => {
            const result = changePasswordBody.safeParse({
                oldPassword: "OldPassword1!",
                newPassword: VALID_PASSWORD,
                extraField: "nope"
            });
            expect(result.success).toBe(false);
        });
    });

    // ─── Request TOTP Secret Schema ─────────────────────────────────────
    describe("requestTotpSecretBody", () => {
        it("accepts valid body with password only", () => {
            const result = requestTotpSecretBody.safeParse({
                password: "mypassword"
            });
            expect(result.success).toBe(true);
        });

        it("accepts optional email", () => {
            const result = requestTotpSecretBody.safeParse({
                password: "mypassword",
                email: "user@example.com"
            });
            expect(result.success).toBe(true);
        });

        it("rejects missing password", () => {
            const result = requestTotpSecretBody.safeParse({
                email: "user@example.com"
            });
            expect(result.success).toBe(false);
        });

        it("rejects invalid email format", () => {
            const result = requestTotpSecretBody.safeParse({
                password: "mypassword",
                email: "not-an-email"
            });
            expect(result.success).toBe(false);
        });

        it("rejects extra fields (strictObject)", () => {
            const result = requestTotpSecretBody.safeParse({
                password: "mypassword",
                extra: "nope"
            });
            expect(result.success).toBe(false);
        });
    });

    // ─── Verify TOTP Schema ─────────────────────────────────────────────
    describe("verifyTotpBody", () => {
        it("accepts valid body with code only", () => {
            const result = verifyTotpBody.safeParse({
                code: "123456"
            });
            expect(result.success).toBe(true);
        });

        it("accepts optional email and password", () => {
            const result = verifyTotpBody.safeParse({
                code: "123456",
                email: "user@example.com",
                password: "mypassword"
            });
            expect(result.success).toBe(true);
        });

        it("rejects missing code", () => {
            const result = verifyTotpBody.safeParse({
                email: "user@example.com",
                password: "mypassword"
            });
            expect(result.success).toBe(false);
        });

        it("rejects extra fields (strictObject)", () => {
            const result = verifyTotpBody.safeParse({
                code: "123456",
                extra: "nope"
            });
            expect(result.success).toBe(false);
        });
    });

    // ─── Disable 2FA Schema ─────────────────────────────────────────────
    describe("disable2faBody", () => {
        it("accepts valid body with password", () => {
            const result = disable2faBody.safeParse({
                password: "mypassword"
            });
            expect(result.success).toBe(true);
        });

        it("accepts optional 2FA code", () => {
            const result = disable2faBody.safeParse({
                password: "mypassword",
                code: "123456"
            });
            expect(result.success).toBe(true);
        });

        it("rejects missing password", () => {
            const result = disable2faBody.safeParse({});
            expect(result.success).toBe(false);
        });

        it("rejects extra fields (strictObject)", () => {
            const result = disable2faBody.safeParse({
                password: "mypassword",
                extra: "nope"
            });
            expect(result.success).toBe(false);
        });
    });
});
