import type { Request, Response } from "express";
import HttpCode from "@server/types/HttpCode";
import { getIssuerUrl } from "@server/lib/oauth/issuer";
import { validScopes } from "@server/lib/oauth/scopes";

export function openidConfiguration(_: Request, res: Response): void {
    const issuer = getIssuerUrl();

    res.status(HttpCode.OK).json({
        issuer,
        authorization_endpoint: `${issuer}/oauth/authorize`,
        token_endpoint: `${issuer}/api/v1/oauth/token`,
        userinfo_endpoint: `${issuer}/api/v1/oauth/userinfo`,
        jwks_uri: `${issuer}/api/v1/oauth/jwks`,
        revocation_endpoint: `${issuer}/api/v1/oauth/revoke`,
        end_session_endpoint: `${issuer}/api/v1/oauth/logout`,
        response_types_supported: ["code"],
        grant_types_supported: ["authorization_code", "refresh_token"],
        subject_types_supported: ["public"],
        id_token_signing_alg_values_supported: ["RS256"],
        scopes_supported: [...validScopes],
        token_endpoint_auth_methods_supported: [
            "client_secret_jwt",
            "client_secret_basic",
            "client_secret_post"
        ],
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
