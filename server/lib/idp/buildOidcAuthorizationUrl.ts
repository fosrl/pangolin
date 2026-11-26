import config from "@server/lib/config";
import { decrypt } from "@server/lib/crypto";
import logger from "@server/logger";
import * as arctic from "arctic";
import jsonwebtoken from "jsonwebtoken";
import type { IdpWithOidcConfig } from "./evaluateIdpLogin";

/** Cookie holding the signed OIDC state, read back by the callback page. */
export const OIDC_STATE_COOKIE_NAME = "p_oidc_state";
export const OIDC_STATE_TTL_MS = 10 * 60 * 1000;

/** Marks a test login: the callback only reports what would happen. */
export type OidcTestState = {
    /** Test link: the result is stored on the link for the IdP's admins. */
    linkId: string;
};

/**
 * Builds the IdP authorization URL (PKCE) and the signed state JWT to store in
 * the `p_oidc_state` cookie.
 */
export function buildOidcAuthorizationUrl({
    existingIdp,
    redirectUrl,
    postAuthRedirectUrl,
    test,
    prompt
}: {
    existingIdp: IdpWithOidcConfig;
    /** The IdP redirect URI (our callback page). */
    redirectUrl: string;
    /** Where the user goes after the callback. */
    postAuthRedirectUrl: string;
    test?: OidcTestState;
    prompt?: string;
}): { url: URL; stateJwt: string } {
    const { idp, idpOidcConfig } = existingIdp;

    const isGoogle = idpOidcConfig.variant === "google";
    const scopes = idpOidcConfig.scopes
        .split(" ")
        .map((scope) => scope.trim())
        .filter((scope) => {
            if (scope.length === 0) {
                return false;
            }
            if (isGoogle && scope === "offline_access") {
                return false;
            }
            return true;
        });

    const key = config.getRawConfig().server.secret!;
    const client = new arctic.OAuth2Client(
        decrypt(idpOidcConfig.clientId, key),
        decrypt(idpOidcConfig.clientSecret, key),
        redirectUrl
    );
    logger.debug("OIDC client info", { redirectUrl });

    const codeVerifier = arctic.generateCodeVerifier();
    const state = arctic.generateState();
    const url = client.createAuthorizationURLWithPKCE(
        idpOidcConfig.authUrl,
        state,
        arctic.CodeChallengeMethod.S256,
        codeVerifier,
        scopes
    );

    // Google issues refresh tokens via access_type=offline; prompt=consent
    // is required so returning users still receive a refresh token.
    // Not for a test login: no session (and no refresh token) is created.
    if (idp.sessionRevalidation && isGoogle && !test) {
        url.searchParams.set("access_type", "offline");
        url.searchParams.set("prompt", "consent");
    }

    if (prompt) {
        url.searchParams.set("prompt", prompt);
    }

    const stateJwt = jsonwebtoken.sign(
        {
            redirectUrl: postAuthRedirectUrl, // TODO: validate that this is safe
            state,
            codeVerifier,
            ...(test ? { test } : {})
        },
        key,
        test ? { expiresIn: OIDC_STATE_TTL_MS / 1000 } : undefined
    );

    return { url, stateJwt };
}
