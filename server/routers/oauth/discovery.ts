import type { Request, Response } from "express";
import HttpCode from "@server/types/HttpCode";
import { getIssuerUrl } from "@server/lib/oauth/issuer";
import { VALID_SCOPES } from "@server/lib/oauth/scopes";
import { CLIENT_AUTH_METHODS } from "@server/lib/oauth/clientAuthMethods";

export function openidConfiguration(_: Request, res: Response): void {
    const issuer = getIssuerUrl();

    res.status(HttpCode.OK).json({
        issuer,

        // Public (no verification)
        jwks_uri: `${issuer}/api/v1/oauth/jwks`,

        // verifySessionUserMiddleware (Pangolin user verification)
        authorization_endpoint: `${issuer}/oauth/authorize`,
        end_session_endpoint: `${issuer}/oauth/logout`,

        // verifyOAuthClient middleware (client secret)
        token_endpoint: `${issuer}/api/v1/oauth/token/issue`,
        revocation_endpoint: `${issuer}/api/v1/oauth/token/revoke`,
        introspection_endpoint: `${issuer}/api/v1/oauth/token/introspect`,

        // verifyOAuthBearerAccess middleware (user bearer token via client)
        userinfo_endpoint: `${issuer}/api/v1/oauth/userinfo`,

        scopes_supported: VALID_SCOPES,
        token_endpoint_auth_methods_supported: CLIENT_AUTH_METHODS,

        response_types_supported: ["code"],
        grant_types_supported: ["authorization_code", "refresh_token"],
        subject_types_supported: ["public"],
        id_token_signing_alg_values_supported: ["RS256"],
        code_challenge_methods_supported: ["S256"],
        backchannel_logout_supported: true,
        backchannel_logout_session_supported: false,
        claims_supported: [
            "sub",
            "iss",
            "aud",
            "exp",
            "iat",
            "name",
            "given_name",
            "family_name",
            "email",
            "email_verified",
            "preferred_username",
            "groups"
        ]
    });
}
