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
    const payload: Record<string, unknown> = {
        ...claims
    };

    delete payload.exp;
    delete payload.iat;

    return jsonwebtoken.sign(payload, privateKeyPem, {
        algorithm: "RS256",
        keyid: kid,
        expiresIn: "1h"
    });
}

export function hashToken(token: string): string {
    return encodeHexLowerCase(sha256(new TextEncoder().encode(token)));
}
