import { decrypt, encrypt } from "@server/lib/crypto";
import {
    parseCapabilities,
    type AiCapability
} from "@server/lib/aiCapabilities";
import { stripVirtualApiKeyAuthHeaders } from "@app/lib/virtualApiKeyFormat";
import {
    AI_PROVIDER_AUTH_TYPES,
    AI_PROVIDER_DEFAULTS,
    authTypeRequiresApiKey,
    defaultsForProviderType,
    providerRequiresUpstreamUrl,
    type AiBudgetUnit,
    type AiProviderAuthType,
    type AiProviderRoutingMode,
    type AiProviderType
} from "@app/lib/aiProviderDefaults";

export {
    AI_PROVIDER_AUTH_TYPES,
    AI_PROVIDER_DEFAULTS,
    authTypeRequiresApiKey,
    defaultsForProviderType,
    providerRequiresUpstreamUrl,
    type AiBudgetUnit,
    type AiProviderAuthType,
    type AiProviderRoutingMode,
    type AiProviderType
};

const CONFLICTING_AUTH_HEADERS = [
    "authorization",
    "x-api-key",
    "x-goog-api-key",
    "cf-aig-authorization"
] as const;

export function resolveAiProviderCreateFields(input: {
    type: AiProviderType;
    upstreamUrl?: string | null;
    authType?: AiProviderAuthType | null;
    routingMode?: AiProviderRoutingMode | null;
}): {
    upstreamUrl: string | null;
    authType: AiProviderAuthType;
    routingMode: AiProviderRoutingMode;
} {
    const routingMode =
        input.type === "custom" ? (input.routingMode ?? "url") : "url";

    if (routingMode === "target") {
        return {
            upstreamUrl: null,
            authType: input.authType ?? "bearer",
            routingMode
        };
    }

    if (input.type === "custom") {
        return {
            upstreamUrl: input.upstreamUrl ?? null,
            authType: input.authType ?? "bearer",
            routingMode
        };
    }

    const defaults = AI_PROVIDER_DEFAULTS[input.type];
    return {
        upstreamUrl: input.upstreamUrl ?? defaults.upstreamUrl,
        authType: input.authType ?? defaults.authType,
        routingMode
    };
}

export type AiProviderHeader = { name: string; value: string };

export function serializeAiProviderHeaders(
    headers: AiProviderHeader[] | null | undefined,
    secret: string
): string | null {
    if (!headers || headers.length === 0) {
        return null;
    }
    return encrypt(JSON.stringify(headers), secret);
}

export function parseAiProviderHeaders(
    raw: string | null | undefined,
    secret: string
): AiProviderHeader[] {
    if (!raw) {
        return [];
    }
    try {
        const decrypted = decrypt(raw, secret);
        const parsed = JSON.parse(decrypted);
        if (!Array.isArray(parsed)) {
            return [];
        }
        return parsed.filter(
            (h): h is AiProviderHeader =>
                h != null &&
                typeof h === "object" &&
                typeof h.name === "string" &&
                typeof h.value === "string"
        );
    } catch {
        return [];
    }
}

export function applyAiProviderCustomHeaders(
    headers: Record<string, string>,
    raw: string | null | undefined,
    secret: string
): void {
    for (const { name, value } of parseAiProviderHeaders(raw, secret)) {
        headers[name] = value;
    }
}

/**
 * Apply provider auth to upstream headers.
 * - Always strips Pangolin virtual API key credentials from client auth headers.
 * - Injected modes: strip conflicting client auth headers, then set the provider key.
 * - none: strip conflicting client auth headers, send no auth.
 * - passthrough: leave remaining client auth headers as-is (after VAK strip).
 */
export function applyAiProviderAuthHeaders(
    headers: Record<string, string>,
    authType: AiProviderAuthType,
    apiKey: string | null
): void {
    stripVirtualApiKeyAuthHeaders(headers);

    if (authType === "passthrough") {
        return;
    }

    for (const name of CONFLICTING_AUTH_HEADERS) {
        for (const key of Object.keys(headers)) {
            if (key.toLowerCase() === name) {
                delete headers[key];
            }
        }
    }

    if (authType === "none") {
        return;
    }

    if (!apiKey) {
        throw new Error(`API key required for authType ${authType}`);
    }

    switch (authType) {
        case "bearer":
            headers["Authorization"] = `Bearer ${apiKey}`;
            break;
        case "x-api-key":
            headers["x-api-key"] = apiKey;
            break;
        case "x-goog-api-key":
            headers["x-goog-api-key"] = apiKey;
            break;
        case "hec":
            headers["Authorization"] = `Splunk ${apiKey}`;
            break;
        case "cf-aig-authorization":
            headers["cf-aig-authorization"] = `Bearer ${apiKey}`;
            break;
    }
}

export function resolveCapabilitiesForCreate(input: {
    type: AiProviderType;
    capabilities?: AiCapability[] | null;
}): AiCapability[] {
    if (input.capabilities != null) {
        return parseCapabilities(input.capabilities);
    }
    if (input.type === "custom") {
        return [];
    }
    return [...AI_PROVIDER_DEFAULTS[input.type].capabilities];
}
