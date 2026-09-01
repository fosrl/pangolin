import { AI_CAPABILITIES, type AiCapability } from "@app/lib/aiCapabilities";

export type AiProviderType =
    | "openai"
    | "anthropic"
    | "googleGemini"
    | "vertexAi"
    | "bedrock"
    | "microsoftFoundry"
    | "openRouter"
    | "vercelAiGateway"
    | "custom";

export const AI_PROVIDER_AUTH_TYPES = [
    "bearer",
    "x-api-key",
    "x-goog-api-key",
    "hec",
    "cf-aig-authorization",
    "none",
    "passthrough"
] as const;

export type AiProviderAuthType = (typeof AI_PROVIDER_AUTH_TYPES)[number];
export type AiBudgetUnit = "usd" | "tokens";
export type AiProviderRoutingMode = "url" | "target";

type AiProviderDefaults = {
    upstreamUrl: string | null;
    authType: AiProviderAuthType;
    capabilities: readonly AiCapability[];
};

export const AI_PROVIDER_DEFAULTS: Record<
    Exclude<AiProviderType, "custom">,
    AiProviderDefaults
> = {
    openai: {
        upstreamUrl: "https://api.openai.com/v1",
        authType: "bearer",
        capabilities: ["openai_chat", "openai_responses", "v1_models"]
    },
    anthropic: {
        upstreamUrl: "https://api.anthropic.com",
        authType: "x-api-key",
        capabilities: ["anthropic_messages", "v1_models"]
    },
    googleGemini: {
        upstreamUrl: "https://generativelanguage.googleapis.com",
        authType: "x-goog-api-key",
        capabilities: ["gemini_generate_content"]
    },
    vertexAi: {
        upstreamUrl: null,
        authType: "bearer",
        capabilities: ["google_generate_content", "google_raw_predict"]
    },
    bedrock: {
        upstreamUrl: null,
        authType: "bearer",
        capabilities: ["bedrock_converse"]
    },
    microsoftFoundry: {
        upstreamUrl: null,
        authType: "bearer",
        capabilities: [
            "openai_chat",
            "openai_responses",
            "anthropic_messages",
            "v1_models"
        ]
    },
    openRouter: {
        upstreamUrl: "https://openrouter.ai/api/v1",
        authType: "bearer",
        capabilities: ["openai_chat"]
    },
    vercelAiGateway: {
        upstreamUrl: "https://ai-gateway.vercel.sh/v1",
        authType: "bearer",
        capabilities: ["openai_chat", "openai_responses"]
    }
};

export function authTypeRequiresApiKey(authType: AiProviderAuthType): boolean {
    return authType !== "none" && authType !== "passthrough";
}

export function providerRequiresUpstreamUrl(
    type: AiProviderType,
    routingMode: AiProviderRoutingMode = "url"
): boolean {
    const mode = type === "custom" ? routingMode : "url";
    return mode !== "target";
}

export function defaultsForProviderType(
    type: AiProviderType
): readonly AiCapability[] {
    if (type === "custom") {
        return [];
    }
    return AI_PROVIDER_DEFAULTS[type].capabilities;
}

export { AI_CAPABILITIES };
export type { AiCapability };
