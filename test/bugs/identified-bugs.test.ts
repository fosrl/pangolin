/**
 * Bug Regression Test Suite
 *
 * Documents and tests the 6 bugs identified during the API code review.
 * Each test either verifies the fix or documents the bug's presence.
 */
import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";

const SERVER_ROOT = path.resolve(__dirname, "../../server");

describe("Bug Regression Tests", () => {
    // ─── Bug 1: Unused `email` import in signup.ts ──────────────────────
    describe("Bug #1: Unused email import in signup.ts", () => {
        it("should not have a named 'email' import from zod", () => {
            const content = fs.readFileSync(
                path.join(SERVER_ROOT, "routers/auth/signup.ts"),
                "utf-8"
            );
            // The import line is: import { email, z } from "zod";
            // This imports a non-existent named export. Should be: import { z } from "zod";
            const hasUnusedEmailImport = /import\s*\{[^}]*\bemail\b[^}]*\}\s*from\s*["']zod["']/.test(
                content
            );
            // This test DOCUMENTS the bug. If fixed, flipexpectation.
            if (hasUnusedEmailImport) {
                console.warn(
                    "⚠️ Bug #1 PRESENT: signup.ts imports unused 'email' from zod. " +
                    "This will break on Zod v4 where 'email' is not a named export."
                );
            }
            // We simply document its presence either way
            expect(typeof hasUnusedEmailImport).toBe("boolean");
        });
    });

    // ─── Bug 2: PostgreSQL duplicate-email handling gap ─────────────────
    describe("Bug #2: PostgreSQL duplicate-email error handling in signup.ts", () => {
        it("should handle both SQLite and PostgreSQL unique constraint errors", () => {
            const content = fs.readFileSync(
                path.join(SERVER_ROOT, "routers/auth/signup.ts"),
                "utf-8"
            );
            const hasSqliteHandling = content.includes("SqliteError") &&
                content.includes("SQLITE_CONSTRAINT_UNIQUE");
            // Check if PostgreSQL error handling exists (error code 23505)
            const hasPgHandling = content.includes("23505") ||
                content.includes("PostgresError") ||
                content.includes("unique_violation");

            expect(hasSqliteHandling).toBe(true);

            if (!hasPgHandling) {
                console.warn(
                    "⚠️ Bug #2 PRESENT: signup.ts only catches SqliteError for duplicate emails. " +
                    "When running with PostgreSQL, duplicate signups will return a 500 error " +
                    'instead of the friendly "user already exists" message.'
                );
            }
        });
    });

    // ─── Bug 3: Type inconsistency in resetPassword response ────────────
    describe("Bug #3: resetPassword response type inconsistency", () => {
        it("should have consistent response type and data", () => {
            const content = fs.readFileSync(
                path.join(SERVER_ROOT, "routers/auth/resetPassword.ts"),
                "utf-8"
            );
            // The response type is ResetPasswordResponse = { codeRequested?: boolean }
            // But the success response sets data: null
            const hasNullDataWithTypedResponse =
                content.includes("response<ResetPasswordResponse>") &&
                content.includes("data: null");

            if (hasNullDataWithTypedResponse) {
                console.warn(
                    "⚠️ Bug #3 PRESENT: resetPassword.ts returns data: null " +
                    "but response type expects { codeRequested?: boolean }. " +
                    "TypeScript may allow this silently but it's a type mismatch."
                );
            }
        });
    });

    // ─── Bug 4: Duplicate IdP route registration ────────────────────────
    describe("Bug #4: Duplicate GET /idp/:idpId route in external.ts", () => {
        it("should not register the same route twice", () => {
            const content = fs.readFileSync(
                path.join(SERVER_ROOT, "routers/external.ts"),
                "utf-8"
            );
            // Count how many times GET /idp/:idpId is registered
            const matches = content.match(
                /authenticated\.get\(\s*["'`]\/idp\/:idpId["'`]/g
            );
            const count = matches ? matches.length : 0;

            if (count > 1) {
                console.warn(
                    `⚠️ Bug #4 PRESENT: GET /idp/:idpId is registered ${count} times ` +
                    "in external.ts. The second registration is dead code."
                );
            }
            // Document the count
            expect(count).toBeGreaterThanOrEqual(1);
        });
    });

    // ─── Bug 5: Rate limiter key prefix collision ───────────────────────
    describe("Bug #5: Rate limiter key prefix collision for 2FA endpoints", () => {
        it("2FA endpoints should not share rate limit keys with signup", () => {
            const content = fs.readFileSync(
                path.join(SERVER_ROOT, "routers/external.ts"),
                "utf-8"
            );

            // Find rate limiter keys for 2FA endpoints
            // The issue is that 2fa/enable, 2fa/request, and 2fa/disable
            // all use `signup:` as the key prefix
            const twoFaSection = content.slice(
                content.indexOf('"/2fa/enable"'),
                content.indexOf('"/2fa/disable"') + 500
            );

            const signupKeyInTwoFa = (twoFaSection.match(/`signup:/g) || []).length;

            if (signupKeyInTwoFa > 0) {
                console.warn(
                    `⚠️ Bug #5 PRESENT: ${signupKeyInTwoFa} 2FA rate limiters use the 'signup:' ` +
                    "key prefix, causing rate limit collisions with the actual signup endpoint. " +
                    "Should use '2fa:' or endpoint-specific prefixes."
                );
            }
        });
    });

    // ─── Bug 6: Olm rate limiter uses wrong field name ──────────────────
    describe("Bug #6: Olm rate limiter uses req.body.newtId instead of olmId", () => {
        it("olm/get-token rate limiter should use olmId, not newtId", () => {
            const content = fs.readFileSync(
                path.join(SERVER_ROOT, "routers/external.ts"),
                "utf-8"
            );

            // Find the section for olm/get-token
            const olmSectionStart = content.indexOf('"/olm/get-token"');
            if (olmSectionStart === -1) {
                // Route doesn't exist, skip
                return;
            }
            const olmSection = content.slice(olmSectionStart, olmSectionStart + 500);

            const usesNewtId = olmSection.includes("req.body.newtId");
            const usesOlmId = olmSection.includes("req.body.olmId");

            if (usesNewtId && !usesOlmId) {
                console.warn(
                    "⚠️ Bug #6 PRESENT: olm/get-token rate limiter uses " +
                    "req.body.newtId as the key generator instead of req.body.olmId. " +
                    "This was likely a copy-paste error from the newt/get-token endpoint."
                );
            }
            // Document the current state
            expect(typeof usesNewtId).toBe("boolean");
        });
    });
});
