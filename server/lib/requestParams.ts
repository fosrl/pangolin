import type { Request } from "express";

export function getFirstString(value: unknown): string | undefined {
    if (typeof value === "string") {
        return value;
    }

    if (Array.isArray(value) && typeof value[0] === "string") {
        return value[0];
    }

    return undefined;
}

// [Body form value] <key>=<value>

export function getBodyValue(req: Request, key: string): string | null {
    return getBodyValueFromRecords(req?.body, key);
}

export function getBodyValueFromRecords(
    records: Record<string, unknown>,
    key: string
): string | null {
    if (!records || typeof records !== "object") {
        return null;
    }

    const value = records[key];
    return typeof value === "string" ? value : null;
}

// [Header] Authorization: Basic QWxhZGRpbjpvcGVuIHNlc2FtZQ==
// Base64 payload -> <client_id>:<client_secret>

export function parseBasicAuth(req: Request): BasicAuthString {
    return parseBasicAuthString(req?.headers?.authorization ?? "");
}

export function parseBasicAuthString(str: string): BasicAuthString {
    const parts = /^Basic +(\S+)$/i.exec(str);
    if (!parts) {
        throw new Error("Invalid or missing Basic Authorization header");
    }

    try {
        const decoded = Buffer.from(parts[1], "base64").toString("utf8");
        const separatorIndex = decoded.indexOf(":");
        if (separatorIndex === -1) {
            throw new Error("Invalid Basic Authorization header format");
        }

        return {
            clientId: decodeURIComponent(decoded.slice(0, separatorIndex)),
            clientSecret: decodeURIComponent(decoded.slice(separatorIndex + 1))
        };
    } catch {
        throw new Error("Failed to parse Basic Authorization header");
    }
}

export type BasicAuthString = {
    clientId: string;
    clientSecret: string;
};

// [Header] Authorization: Bearer <token>
// Often JWT, but can be opaque

export function extractBearerToken(req: Request): string | null {
    const authHeader = req?.headers?.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
        return null;
    }

    return authHeader.slice("Bearer ".length).trim();
}
