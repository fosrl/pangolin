import { sha256 } from "@oslojs/crypto/sha2";
import { encodeHexLowerCase } from "@oslojs/encoding";
import { generateIdFromEntropySize } from "@server/auth/sessions/app";
import jsonwebtoken from "jsonwebtoken";

export function generateAuthorizationCode(): string {
    return generateIdFromEntropySize(25);
}

export function generateAccessToken(): string {
    return generateIdFromEntropySize(32);
}

export function generateRefreshToken(): string {
    return generateIdFromEntropySize(32);
}

export function signIdToken(
    claims: Record<string, unknown>,
    privateKeyPem: string,
    kid: string
): string {
    return jsonwebtoken.sign(claims, privateKeyPem, {
        algorithm: "RS256",
        keyid: kid,
        expiresIn: "1h"
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
            expiresIn: 120
        }
    );
}

export function hashToken(token: string): string {
    return encodeHexLowerCase(sha256(new TextEncoder().encode(token)));
}
