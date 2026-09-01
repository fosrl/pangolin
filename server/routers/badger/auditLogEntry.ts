import { sanitizeString } from "@server/lib/sanitize";

export type LogRequestAuditData = {
    action: boolean;
    reason: number;
    resourceId?: number;
    siteResourceId?: number;
    orgId?: string;
    location?: string;
    user?: { username: string; userId: string };
    apiKey?: { name: string | null; apiKeyId: string };
    metadata?: any;
};

export type LogRequestAuditBody = {
    path: string;
    originalRequestURL: string;
    scheme: string;
    host: string;
    method: string;
    tls: boolean;
    sessions?: Record<string, string>;
    headers?: Record<string, string>;
    query?: Record<string, string>;
    requestIp?: string;
};

/**
 * Case-insensitively pulls the User-Agent value out of the raw request
 * headers Badger forwards, mirroring the extraction already done for
 * accessAuditLog in verifySession's logAccessTokenAccessAudit.
 */
export function extractUserAgent(
    headers: Record<string, string> | undefined
): string | undefined {
    if (!headers) {
        return undefined;
    }
    for (const [key, value] of Object.entries(headers)) {
        if (key.toLowerCase() === "user-agent") {
            return value;
        }
    }
    return undefined;
}

// Headers that carry live credentials. These must never be written to the
// audit log verbatim - the log is meant to help diagnose/investigate
// requests, not to become a second place session tokens and API keys are
// stored in plaintext.
const SENSITIVE_HEADER_NAMES = new Set([
    "authorization",
    "cookie",
    "set-cookie",
    "proxy-authorization",
    "x-api-key",
    "x-access-token",
    "x-auth-token"
]);

/**
 * Returns a copy of the headers with credential-bearing values replaced by a
 * placeholder, so the JSON blob persisted to requestAuditLog can't leak a
 * live session cookie or API key.
 */
export function redactSensitiveHeaders(
    headers: Record<string, string> | undefined
): Record<string, string> | undefined {
    if (!headers) {
        return undefined;
    }
    const redacted: Record<string, string> = {};
    for (const [key, value] of Object.entries(headers)) {
        redacted[key] = SENSITIVE_HEADER_NAMES.has(key.toLowerCase())
            ? "[REDACTED]"
            : value;
    }
    return redacted;
}

/**
 * Builds the row to buffer/insert for a single request-audit entry.
 * Kept free of any DB/logger/cache imports so the (data, body) -> row
 * mapping can be unit tested in isolation.
 */
export function buildAuditLogEntry(
    data: LogRequestAuditData,
    body: LogRequestAuditBody,
    clientIp: string | undefined
) {
    let actorType: string | undefined;
    let actor: string | undefined;
    let actorId: string | undefined;

    const user = data.user;
    if (user) {
        actorType = "user";
        actor = user.username;
        actorId = user.userId;
    }
    const apiKey = data.apiKey;
    if (apiKey) {
        actorType = "apiKey";
        actor = apiKey.name || apiKey.apiKeyId;
        actorId = apiKey.apiKeyId;
    }

    const timestamp = Math.floor(Date.now() / 1000);

    let metadata = null;
    if (data.metadata) {
        metadata = JSON.stringify(data.metadata);
    }

    const userAgent = extractUserAgent(body.headers);

    return {
        timestamp,
        orgId: sanitizeString(data.orgId),
        actorType: sanitizeString(actorType),
        actor: sanitizeString(actor),
        actorId: sanitizeString(actorId),
        metadata: sanitizeString(metadata),
        action: data.action,
        resourceId: data.resourceId,
        siteResourceId: data.siteResourceId,
        reason: data.reason,
        location: sanitizeString(data.location),
        originalRequestURL: sanitizeString(body.originalRequestURL) ?? "",
        scheme: sanitizeString(body.scheme) ?? "",
        host: sanitizeString(body.host) ?? "",
        path: sanitizeString(body.path) ?? "",
        method: sanitizeString(body.method) ?? "",
        ip: sanitizeString(clientIp),
        tls: body.tls,
        userAgent: sanitizeString(userAgent),
        headers: sanitizeString(
            body.headers
                ? JSON.stringify(redactSensitiveHeaders(body.headers))
                : undefined
        ),
        query: sanitizeString(
            body.query ? JSON.stringify(body.query) : undefined
        )
    };
}
