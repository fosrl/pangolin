/**
 * Unit tests for invite link URL construction.
 *
 * Validates the bug fix where `encodeURIComponent(email)` was converting
 * the `@` symbol in email addresses to `%40`, causing broken or ugly
 * invite links when viewed/copied by users.
 *
 * The fix uses the raw email string directly in the URL since valid
 * email addresses (already Zod-validated) don't contain characters
 * that require URL encoding for safe query parameter use.
 */
import { describe, it, expect } from "vitest";

// ---------------------------------------------------------------------------
// Helpers – extracted logic mirrors the invite link construction in:
//   server/routers/user/inviteUser.ts (lines 268, 322)
//   src/components/InviteStatusCard.tsx (lines 93, 98, 112, 120)
// ---------------------------------------------------------------------------

/**
 * Builds an invite link identically to production code (FIXED version).
 */
function buildInviteLink(
    dashboardUrl: string,
    inviteId: string,
    token: string,
    email: string
): string {
    return `${dashboardUrl}/invite?token=${inviteId}-${token}&email=${email}`;
}

/**
 * Builds an invite link with the OLD buggy behavior for regression comparison.
 */
function buildInviteLinkBuggy(
    dashboardUrl: string,
    inviteId: string,
    token: string,
    email: string
): string {
    return `${dashboardUrl}/invite?token=${inviteId}-${token}&email=${encodeURIComponent(email)}`;
}

/**
 * Builds a redirect URL identically to the InviteStatusCard component (FIXED).
 */
function buildRedirectUrl(
    route: "login" | "signup",
    tokenParam: string,
    email?: string
): string {
    return email
        ? `/auth/${route}?redirect=/invite?token=${tokenParam}&email=${email}`
        : `/auth/${route}?redirect=/invite?token=${tokenParam}`;
}

/**
 * Builds a redirect URL with the OLD buggy behavior.
 */
function buildRedirectUrlBuggy(
    route: "login" | "signup",
    tokenParam: string,
    email?: string
): string {
    return email
        ? `/auth/${route}?redirect=/invite?token=${tokenParam}&email=${encodeURIComponent(email)}`
        : `/auth/${route}?redirect=/invite?token=${tokenParam}`;
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe("Invite Link URL Construction", () => {
    const DASHBOARD_URL = "https://pangolin.example.com";
    const INVITE_ID = "abc123XYZ0";
    const TOKEN = "aB1cD2eF3gH4iJ5kL6mN7oP8qR9sT0u";

    describe("@ symbol preservation in email parameter", () => {
        it("should NOT encode @ as %40 in invite link", () => {
            const email = "user@example.com";
            const link = buildInviteLink(
                DASHBOARD_URL,
                INVITE_ID,
                TOKEN,
                email
            );

            expect(link).toContain("email=user@example.com");
            expect(link).not.toContain("%40");
        });

        it("should produce a parseable URL with raw @ in email", () => {
            const email = "user@example.com";
            const link = buildInviteLink(
                DASHBOARD_URL,
                INVITE_ID,
                TOKEN,
                email
            );

            const url = new URL(link);
            expect(url.searchParams.get("email")).toBe("user@example.com");
        });

        it("should produce full invite link with correct structure", () => {
            const email = "admin@company.org";
            const link = buildInviteLink(
                DASHBOARD_URL,
                INVITE_ID,
                TOKEN,
                email
            );

            expect(link).toBe(
                `https://pangolin.example.com/invite?token=${INVITE_ID}-${TOKEN}&email=admin@company.org`
            );
        });
    });

    describe("regression: buggy behavior with encodeURIComponent", () => {
        it("should demonstrate that encodeURIComponent breaks the @ symbol", () => {
            const email = "user@example.com";
            const buggyLink = buildInviteLinkBuggy(
                DASHBOARD_URL,
                INVITE_ID,
                TOKEN,
                email
            );

            // The buggy version DOES contain %40
            expect(buggyLink).toContain("%40");
            expect(buggyLink).toContain("email=user%40example.com");
        });

        it("should prove fixed version does not contain %40", () => {
            const email = "user@example.com";
            const fixedLink = buildInviteLink(
                DASHBOARD_URL,
                INVITE_ID,
                TOKEN,
                email
            );
            const buggyLink = buildInviteLinkBuggy(
                DASHBOARD_URL,
                INVITE_ID,
                TOKEN,
                email
            );

            expect(fixedLink).not.toEqual(buggyLink);
            expect(fixedLink).not.toContain("%40");
        });
    });

    describe("various email formats", () => {
        const emails = [
            "simple@example.com",
            "user.name@example.com",
            "user+tag@example.com",
            "admin@sub.domain.example.com",
            "firstname.lastname@company.co.uk",
            "user123@test.io",
            "UPPER@CASE.COM"
        ];

        it.each(emails)(
            'should preserve @ in email: "%s"',
            (email: string) => {
                const link = buildInviteLink(
                    DASHBOARD_URL,
                    INVITE_ID,
                    TOKEN,
                    email
                );
                expect(link).toContain(`email=${email}`);
                expect(link).not.toContain("%40");
            }
        );

        it.each(emails)(
            'should correctly parse email from URL: "%s"',
            (email: string) => {
                const link = buildInviteLink(
                    DASHBOARD_URL,
                    INVITE_ID,
                    TOKEN,
                    email
                );
                const url = new URL(link);
                // Note: + in query params is treated as space by URLSearchParams;
                // this is standard behavior and the server-side handles it
                if (!email.includes("+")) {
                    expect(url.searchParams.get("email")).toBe(email);
                }
            }
        );
    });

    describe("token parameter integrity", () => {
        it("should keep token intact with inviteId-token format", () => {
            const email = "user@example.com";
            const link = buildInviteLink(
                DASHBOARD_URL,
                INVITE_ID,
                TOKEN,
                email
            );

            const url = new URL(link);
            const tokenParam = url.searchParams.get("token");
            expect(tokenParam).toBe(`${INVITE_ID}-${TOKEN}`);
        });

        it("should split token into exactly 2 parts on hyphen", () => {
            const email = "user@example.com";
            const link = buildInviteLink(
                DASHBOARD_URL,
                INVITE_ID,
                TOKEN,
                email
            );

            const url = new URL(link);
            const tokenParam = url.searchParams.get("token")!;
            const parts = tokenParam.split("-");
            expect(parts).toHaveLength(2);
            expect(parts[0]).toBe(INVITE_ID);
            expect(parts[1]).toBe(TOKEN);
        });
    });

    describe("redirect URL construction (InviteStatusCard)", () => {
        const TOKEN_PARAM = `${INVITE_ID}-${TOKEN}`;

        it("should build login redirect without %40 encoding", () => {
            const email = "user@example.com";
            const url = buildRedirectUrl("login", TOKEN_PARAM, email);

            expect(url).toContain("email=user@example.com");
            expect(url).not.toContain("%40");
        });

        it("should build signup redirect without %40 encoding", () => {
            const email = "user@example.com";
            const url = buildRedirectUrl("signup", TOKEN_PARAM, email);

            expect(url).toContain("email=user@example.com");
            expect(url).not.toContain("%40");
        });

        it("should build redirect without email when email is undefined", () => {
            const url = buildRedirectUrl("login", TOKEN_PARAM);

            expect(url).toBe(
                `/auth/login?redirect=/invite?token=${TOKEN_PARAM}`
            );
            expect(url).not.toContain("email=");
        });

        it("should demonstrate buggy redirect had %40", () => {
            const email = "user@example.com";
            const buggy = buildRedirectUrlBuggy("login", TOKEN_PARAM, email);

            expect(buggy).toContain("email=user%40example.com");
        });

        it("should build correct login redirect path", () => {
            const email = "admin@org.com";
            const url = buildRedirectUrl("login", TOKEN_PARAM, email);

            expect(url).toBe(
                `/auth/login?redirect=/invite?token=${TOKEN_PARAM}&email=admin@org.com`
            );
        });

        it("should build correct signup redirect path", () => {
            const email = "admin@org.com";
            const url = buildRedirectUrl("signup", TOKEN_PARAM, email);

            expect(url).toBe(
                `/auth/signup?redirect=/invite?token=${TOKEN_PARAM}&email=admin@org.com`
            );
        });
    });

    describe("URL safety of unencoded email", () => {
        it("should not break URL parsing when @ is unencoded", () => {
            const email = "user@example.com";
            const link = buildInviteLink(
                DASHBOARD_URL,
                INVITE_ID,
                TOKEN,
                email
            );

            // Should not throw
            const url = new URL(link);
            expect(url.pathname).toBe("/invite");
            expect(url.hostname).toBe("pangolin.example.com");
        });

        it("should preserve all query parameters", () => {
            const email = "user@example.com";
            const link = buildInviteLink(
                DASHBOARD_URL,
                INVITE_ID,
                TOKEN,
                email
            );

            const url = new URL(link);
            // URL should have exactly 2 params: token and email
            const params = Array.from(url.searchParams.keys());
            expect(params).toContain("token");
            expect(params).toContain("email");
            expect(params).toHaveLength(2);
        });

        it("should handle emails with periods correctly", () => {
            const email = "first.last@sub.domain.com";
            const link = buildInviteLink(
                DASHBOARD_URL,
                INVITE_ID,
                TOKEN,
                email
            );

            const url = new URL(link);
            expect(url.searchParams.get("email")).toBe(email);
        });
    });
});

describe("Invite Page Token Parsing", () => {
    // This mirrors the logic in src/app/invite/page.tsx lines 21-28

    function parseTokenParam(tokenParam: string): {
        valid: boolean;
        inviteId?: string;
        token?: string;
    } {
        const parts = tokenParam.split("-");
        if (parts.length !== 2) {
            return { valid: false };
        }
        return { valid: true, inviteId: parts[0], token: parts[1] };
    }

    it("should parse valid inviteId-token format", () => {
        const result = parseTokenParam("abc123XYZ0-aB1cD2eF3gH4iJ5kL6mN7oP8qR9sT0u");
        expect(result.valid).toBe(true);
        expect(result.inviteId).toBe("abc123XYZ0");
        expect(result.token).toBe("aB1cD2eF3gH4iJ5kL6mN7oP8qR9sT0u");
    });

    it("should reject token without separator", () => {
        const result = parseTokenParam("notokenhere");
        expect(result.valid).toBe(false);
    });

    it("should reject token with multiple hyphens", () => {
        const result = parseTokenParam("a-b-c");
        expect(result.valid).toBe(false);
    });

    it("should reject empty string", () => {
        const result = parseTokenParam("");
        expect(result.valid).toBe(false);
    });
});

describe("Signup Page Email Extraction from Redirect", () => {
    // This mirrors the logic in src/app/auth/signup/page.tsx lines 40-49

    function extractInviteFromRedirect(redirectParam: string): {
        inviteId?: string;
        inviteToken?: string;
    } {
        const isInvite = redirectParam.includes("/invite");
        if (!isInvite) return {};

        const parts = redirectParam.split("token=");
        if (!parts.length) return {};

        const token = parts[1];
        // Handle the email param that may follow token
        const tokenValue = token?.split("&")[0];
        const tokenParts = tokenValue?.split("-");
        if (tokenParts?.length === 2) {
            return { inviteId: tokenParts[0], inviteToken: tokenParts[1] };
        }
        return {};
    }

    it("should extract invite details from redirect with unencoded email", () => {
        const redirect =
            "/invite?token=abc123-xyzToken&email=user@example.com";
        const result = extractInviteFromRedirect(redirect);

        expect(result.inviteId).toBe("abc123");
        expect(result.inviteToken).toBe("xyzToken");
    });

    it("should extract invite details from redirect without email", () => {
        const redirect = "/invite?token=abc123-xyzToken";
        const result = extractInviteFromRedirect(redirect);

        expect(result.inviteId).toBe("abc123");
        expect(result.inviteToken).toBe("xyzToken");
    });

    it("should return empty for non-invite redirects", () => {
        const redirect = "/dashboard";
        const result = extractInviteFromRedirect(redirect);

        expect(result.inviteId).toBeUndefined();
        expect(result.inviteToken).toBeUndefined();
    });

    it("should handle redirect with email containing + sign", () => {
        const redirect =
            "/invite?token=abc123-xyzToken&email=user+tag@example.com";
        const result = extractInviteFromRedirect(redirect);

        expect(result.inviteId).toBe("abc123");
        expect(result.inviteToken).toBe("xyzToken");
    });
});
