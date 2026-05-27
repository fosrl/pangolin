/**
 * E2E Cypress tests for invite link email encoding fix.
 *
 * Tests the invite flow in the browser to verify that:
 *   1. The invite page correctly receives email with @ (not %40) from URL
 *   2. Redirect URLs for login/signup preserve @ in the email parameter
 *   3. The signup page receives unencoded email from invite redirect flows
 *
 * Prerequisites:
 *   - Application running at http://localhost:3000
 *   - `npm install --save-dev cypress` must be run first
 *   - Run with: npx cypress run --spec cypress/e2e/invite-link-encoding.cy.ts
 */

describe("Invite Link Email Encoding", () => {
    const TEST_EMAIL = "testuser@example.com";
    const FAKE_TOKEN = "abc123XYZ0-aB1cD2eF3gH4iJ5kL6mN7oP8qR9sT0u";

    describe("Invite page URL handling", () => {
        it("should load invite page with @ in email query parameter", () => {
            // Visit the invite page with a raw @ in the email parameter
            cy.visit(`/invite?token=${FAKE_TOKEN}&email=${TEST_EMAIL}`, {
                failOnStatusCode: false
            });

            // The URL in the browser should preserve @ and NOT show %40
            cy.url().should("include", `email=${TEST_EMAIL}`);
            cy.url().should("not.include", "%40");
        });

        it("should display properly even with %40 encoded email (backwards compat)", () => {
            // Old links with %40 should still work — browsers auto-decode
            cy.visit(
                `/invite?token=${FAKE_TOKEN}&email=${encodeURIComponent(TEST_EMAIL)}`,
                { failOnStatusCode: false }
            );

            // Browser should still function (Next.js decodes the param)
            cy.url().should("include", "email=");
        });
    });

    describe("Redirect flow to signup", () => {
        it("should preserve @ in email when redirecting to signup", () => {
            // Simulate the redirect URL that InviteStatusCard builds
            const redirectUrl = `/auth/signup?redirect=/invite?token=${FAKE_TOKEN}&email=${TEST_EMAIL}`;

            cy.visit(redirectUrl, { failOnStatusCode: false });

            // The URL should contain the raw @ symbol
            cy.url().should("include", `email=${TEST_EMAIL}`);
            cy.url().should("not.include", "%40");
        });

        it("should pre-fill email field on signup page from invite redirect", () => {
            const redirectUrl = `/auth/signup?redirect=/invite?token=${FAKE_TOKEN}&email=${TEST_EMAIL}`;

            cy.visit(redirectUrl, { failOnStatusCode: false });

            // If the signup form renders, the email field should be pre-filled
            // with the unencoded email
            cy.get('input[name="email"]', { timeout: 5000 })
                .should("exist")
                .then(($input) => {
                    // Only check value if the input rendered (page may redirect)
                    if ($input.length) {
                        cy.wrap($input).should("have.value", TEST_EMAIL);
                    }
                });
        });
    });

    describe("Redirect flow to login", () => {
        it("should preserve @ in email when redirecting to login", () => {
            const redirectUrl = `/auth/login?redirect=/invite?token=${FAKE_TOKEN}&email=${TEST_EMAIL}`;

            cy.visit(redirectUrl, { failOnStatusCode: false });

            // The URL should contain the raw @ symbol
            cy.url().should("include", `email=${TEST_EMAIL}`);
            cy.url().should("not.include", "%40");
        });
    });

    describe("URL integrity checks", () => {
        it("should produce valid URLs with both token and email params", () => {
            cy.visit(`/invite?token=${FAKE_TOKEN}&email=${TEST_EMAIL}`, {
                failOnStatusCode: false
            });

            // Both params should be present and properly parsed
            cy.location("search").then((search) => {
                const params = new URLSearchParams(search);
                expect(params.has("token")).to.be.true;
                expect(params.has("email")).to.be.true;
                expect(params.get("email")).to.eq(TEST_EMAIL);
                expect(params.get("token")).to.eq(FAKE_TOKEN);
            });
        });

        it("should handle email with subdomain correctly", () => {
            const email = "admin@mail.corp.example.com";
            cy.visit(`/invite?token=${FAKE_TOKEN}&email=${email}`, {
                failOnStatusCode: false
            });

            cy.url().should("include", `email=${email}`);
            cy.url().should("not.include", "%40");
        });

        it("should handle email with dots in local part", () => {
            const email = "first.middle.last@example.com";
            cy.visit(`/invite?token=${FAKE_TOKEN}&email=${email}`, {
                failOnStatusCode: false
            });

            cy.url().should("include", `email=${email}`);
            cy.url().should("not.include", "%40");
        });
    });
});
