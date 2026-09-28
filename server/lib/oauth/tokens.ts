import { sha256 } from "@oslojs/crypto/sha2";
import { encodeHexLowerCase } from "@oslojs/encoding";
import { generateIdFromEntropySize } from "@server/auth/sessions/app";
import {
    db,
    OauthAccessToken,
    oauthAccessTokens,
    oauthClients
} from "@server/db";
import {
    ID_TOKEN_LIFETIME,
    LOGOUT_TOKEN_LIFETIME
} from "@server/lib/oauth/lifetimes";
import { eq } from "drizzle-orm";
import jsonwebtoken from "jsonwebtoken";

export type OAuthValidatedToken = Omit<
    OauthAccessToken,
    "accessTokenId" | "grantId" | "tokenHash" | "createdAt"
> & { clientEnabled: boolean };

export function generateAuthorizationCode(): string {
    return generateIdFromEntropySize(25);
}

export function generateAccessToken(): string {
    return generateIdFromEntropySize(32);
}

export function generateRefreshToken(): string {
    return generateIdFromEntropySize(32);
}

export function hashToken(token: string): string {
    return encodeHexLowerCase(sha256(new TextEncoder().encode(token)));
}

export function signIdToken(
    claims: Record<string, unknown>,
    privateKeyPem: string,
    kid: string
): string {
    return jsonwebtoken.sign(claims, privateKeyPem, {
        algorithm: "RS256",
        keyid: kid,
        expiresIn: ID_TOKEN_LIFETIME
    });
}

export function signLogoutToken(
    claims: {
        iss: string;
        sub: string;
        aud: string;
        jti: string;
    },
    privateKeyPem: string,
    kid: string
): string {
    return jsonwebtoken.sign(
        {
            iss: claims.iss,
            sub: claims.sub,
            aud: claims.aud,
            jti: claims.jti,
            events: {
                "http://schemas.openid.net/event/backchannel-logout": {}
            }
        },
        privateKeyPem,
        {
            algorithm: "RS256",
            keyid: kid,
            expiresIn: LOGOUT_TOKEN_LIFETIME
        }
    );
}

export async function getToken(
    accessToken: string
): Promise<OAuthValidatedToken | null> {
    const [token] = await db
        .select({
            userId: oauthAccessTokens.userId,
            clientId: oauthAccessTokens.clientId,
            scope: oauthAccessTokens.scope,
            expiresAt: oauthAccessTokens.expiresAt,
            clientEnabled: oauthClients.enabled
        })
        .from(oauthAccessTokens)
        .innerJoin(
            oauthClients,
            eq(oauthAccessTokens.clientId, oauthClients.clientId)
        )
        .where(eq(oauthAccessTokens.tokenHash, hashToken(accessToken)))
        .limit(1);

    return token ?? null;
}
