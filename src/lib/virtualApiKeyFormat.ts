export const VIRTUAL_API_KEY_PREFIX = "pangolin-key-";

const VIRTUAL_API_KEY_AUTH_HEADER_NAMES = [
    "authorization",
    "x-api-key",
    "x-goog-api-key",
    "cf-aig-authorization"
] as const;

export function formatVirtualApiKeyCredential(
    virtualApiKeyId: string,
    secret: string
): string {
    return `${VIRTUAL_API_KEY_PREFIX}${virtualApiKeyId}.${secret}`;
}

export function formatVirtualApiKeyPreview(
    virtualApiKeyId: string,
    lastChars: string
): string {
    return `${VIRTUAL_API_KEY_PREFIX}${virtualApiKeyId}••••${lastChars}`;
}

export function looksLikeVirtualApiKeyCredential(value: string): boolean {
    const trimmed = value.trim();
    if (!trimmed.startsWith(VIRTUAL_API_KEY_PREFIX)) {
        return false;
    }
    const withoutPrefix = trimmed.slice(VIRTUAL_API_KEY_PREFIX.length);
    const dot = withoutPrefix.indexOf(".");
    return dot > 0 && dot < withoutPrefix.length - 1;
}

function headerValueCarriesVirtualApiKey(raw: string): boolean {
    const trimmed = raw.trim();
    const bearerMatch = trimmed.match(/^(?:Bearer|Splunk)\s+(.+)$/i);
    if (bearerMatch) {
        return looksLikeVirtualApiKeyCredential(bearerMatch[1]);
    }
    return looksLikeVirtualApiKeyCredential(trimmed);
}

/**
 * Remove client headers that carry a Pangolin virtual API key so they are
 * never forwarded to upstream providers (including passthrough auth).
 */
export function stripVirtualApiKeyAuthHeaders(
    headers: Record<string, string>
): void {
    for (const key of Object.keys(headers)) {
        const lower = key.toLowerCase();
        if (
            !(VIRTUAL_API_KEY_AUTH_HEADER_NAMES as readonly string[]).includes(
                lower
            )
        ) {
            continue;
        }
        if (headerValueCarriesVirtualApiKey(headers[key])) {
            delete headers[key];
        }
    }
}
