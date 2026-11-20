import type { Idp, IdpOidcConfig } from "@server/db";

/**
 * Adds the user's groups fetched from the IdP API to the ID token claims.
 * The IdP API integration is not part of the open-source build: claims are returned as is.
 */
export async function enrichClaimsWithIdpGroups(
    _idp: { idp: Idp; idpOidcConfig: IdpOidcConfig },
    claims: Record<string, unknown>
): Promise<Record<string, unknown>> {
    return claims;
}
