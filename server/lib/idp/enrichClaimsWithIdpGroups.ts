import type { Idp, IdpOidcConfig } from "@server/db";

/** What the group lookup did at login, shown in the test login result. */
export type IdpGroupEnrichment =
    | { status: "added"; groupCount: number }
    | {
          status: "skipped";
          reason:
              /** The variant has no API integration, or the build doesn't include it. */
              | "notAvailable"
              /** The API integration isn't saved as on. */
              | "apiIntegrationOff"
              /** No org uses just-in-time provisioning (real logins only). */
              | "autoProvisionOff"
              /** The plan doesn't include the API integration. */
              | "notEntitled"
              /** The ID token has no user ID to look the user up with. */
              | "noUserId";
      }
    | { status: "failed"; error: string };

/**
 * Adds the user's groups fetched from the IdP API to the ID token claims.
 * The IdP API integration is not part of the open-source build: claims are returned as is.
 */
export async function enrichClaimsWithIdpGroups(
    _idp: { idp: Idp; idpOidcConfig: IdpOidcConfig },
    claims: Record<string, unknown>,
    _options: { test?: boolean } = {}
): Promise<{
    claims: Record<string, unknown>;
    enrichment: IdpGroupEnrichment;
}> {
    return {
        claims,
        enrichment: { status: "skipped", reason: "notAvailable" }
    };
}
