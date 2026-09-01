import { z } from "zod";
import {
    AI_CAPABILITIES,
    AI_PROVIDER_AUTH_TYPES,
    AI_PROVIDER_DEFAULTS,
    authTypeRequiresApiKey,
    defaultsForProviderType,
    providerRequiresUpstreamUrl,
    type AiCapability,
    type AiProviderAuthType,
    type AiProviderType
} from "@app/lib/aiProviderDefaults";

type TranslateFn = (key: string) => string;

export const aiProviderTypeValues = [
    "openai",
    "anthropic",
    "googleGemini",
    "vertexAi",
    "bedrock",
    "microsoftFoundry",
    "openRouter",
    "vercelAiGateway",
    "custom"
] as const satisfies readonly AiProviderType[];

export const aiCapabilityValues = AI_CAPABILITIES;

export function createAiProviderFormSchema(t: TranslateFn) {
    return z
        .object({
            name: z
                .string()
                .trim()
                .min(1, { message: t("nameRequired") }),
            type: z.enum(aiProviderTypeValues),
            upstreamUrl: z.string().optional().nullable(),
            apiKey: z.string().optional(),
            authType: z.enum(AI_PROVIDER_AUTH_TYPES).optional().nullable(),
            routingMode: z.enum(["url", "target"]).optional(),
            capabilities: z.array(z.enum(AI_CAPABILITIES)).optional(),
            headers: z
                .array(z.object({ name: z.string(), value: z.string() }))
                .nullable()
                .optional(),
            skipTlsVerification: z.boolean().optional(),
            enabled: z.boolean().optional()
        })
        .superRefine((data, ctx) => {
            const routingMode =
                data.type === "custom" ? (data.routingMode ?? "url") : "url";

            if (data.type !== "custom" && data.routingMode === "target") {
                ctx.addIssue({
                    code: "custom",
                    message: t("aiProviderErrorRoutingModeTarget"),
                    path: ["routingMode"]
                });
            }

            const upstreamUrl =
                data.upstreamUrl && data.upstreamUrl.trim().length > 0
                    ? data.upstreamUrl.trim()
                    : null;

            if (upstreamUrl) {
                try {
                    new URL(upstreamUrl);
                } catch {
                    ctx.addIssue({
                        code: "custom",
                        message: t("aiProviderErrorUpstreamUrlInvalid"),
                        path: ["upstreamUrl"]
                    });
                }
            }

            if (
                providerRequiresUpstreamUrl(data.type, routingMode) &&
                !upstreamUrl
            ) {
                ctx.addIssue({
                    code: "custom",
                    message: t("aiProviderErrorUpstreamUrlRequired"),
                    path: ["upstreamUrl"]
                });
            }

            if (!data.authType) {
                ctx.addIssue({
                    code: "custom",
                    message: t("aiProviderErrorAuthTypeRequired"),
                    path: ["authType"]
                });
            }

            if (!data.capabilities || data.capabilities.length === 0) {
                ctx.addIssue({
                    code: "custom",
                    message: t("aiProviderErrorCapabilitiesRequired"),
                    path: ["capabilities"]
                });
            }
        });
}

export function createAiProviderCreateFormSchema(t: TranslateFn) {
    return createAiProviderFormSchema(t).superRefine((data, ctx) => {
        const authType: AiProviderAuthType = data.authType ?? "bearer";

        if (authTypeRequiresApiKey(authType) && !data.apiKey?.trim()) {
            ctx.addIssue({
                code: "custom",
                message: t("aiProviderErrorApiKeyRequired"),
                path: ["apiKey"]
            });
        }
    });
}

export type AiProviderFormValues = z.infer<
    ReturnType<typeof createAiProviderFormSchema>
>;

export function defaultAuthTypeForProvider(
    type: AiProviderType
): AiProviderAuthType {
    if (type === "custom") {
        return "bearer";
    }
    return AI_PROVIDER_DEFAULTS[type].authType;
}

export function defaultCapabilitiesForProvider(
    type: AiProviderType
): AiCapability[] {
    return [...defaultsForProviderType(type)];
}

export function emptyUpstreamForType(type: AiProviderType): string {
    if (type === "custom") {
        return "";
    }
    return AI_PROVIDER_DEFAULTS[type].upstreamUrl ?? "";
}

export function showsUpstreamUrlField(
    type: AiProviderType,
    routingMode: "url" | "target" | undefined
): boolean {
    const mode = type === "custom" ? (routingMode ?? "url") : "url";
    return providerRequiresUpstreamUrl(type, mode);
}

export function toAiProviderCreatePayload(values: AiProviderFormValues) {
    const routingMode =
        values.type === "custom" ? (values.routingMode ?? "url") : "url";
    const upstreamRaw = values.upstreamUrl?.trim() ?? "";
    const upstreamUrl =
        routingMode === "target"
            ? null
            : upstreamRaw.length > 0
              ? upstreamRaw
              : null;

    return {
        name: values.name.trim(),
        type: values.type,
        routingMode: values.type === "custom" ? routingMode : undefined,
        upstreamUrl,
        apiKey: values.apiKey?.trim() ? values.apiKey.trim() : undefined,
        authType: values.authType ?? "bearer",
        capabilities: values.capabilities ?? [],
        headers:
            values.headers && values.headers.length > 0 ? values.headers : null,
        skipTlsVerification: values.skipTlsVerification,
        enabled: values.enabled ?? true
    };
}

export function toAiProviderUpdatePayload(values: AiProviderFormValues) {
    const routingMode =
        values.type === "custom" ? (values.routingMode ?? "url") : "url";
    const upstreamRaw = values.upstreamUrl?.trim() ?? "";
    const upstreamUrl =
        routingMode === "target"
            ? null
            : upstreamRaw.length > 0
              ? upstreamRaw
              : null;

    const payload: Record<string, unknown> = {
        name: values.name.trim(),
        routingMode: values.type === "custom" ? routingMode : "url",
        upstreamUrl,
        authType: values.authType ?? "bearer",
        skipTlsVerification: values.skipTlsVerification ?? false,
        enabled: values.enabled ?? true
    };

    if (values.capabilities) {
        payload.capabilities = values.capabilities;
    }

    if (values.apiKey?.trim()) {
        payload.apiKey = values.apiKey.trim();
    }

    return payload;
}

export function toAiProviderNetworkPayload(values: AiProviderFormValues) {
    const full = toAiProviderUpdatePayload(values);
    return {
        routingMode: full.routingMode,
        upstreamUrl: full.upstreamUrl,
        skipTlsVerification: full.skipTlsVerification,
        headers:
            values.headers && values.headers.length > 0 ? values.headers : null
    };
}

export function toAiProviderAuthPayload(values: AiProviderFormValues) {
    return {
        authType: values.authType ?? "bearer",
        ...(values.apiKey !== undefined ? { apiKey: values.apiKey.trim() } : {})
    };
}

export function toAiProviderConfigurationPayload(values: AiProviderFormValues) {
    const {
        name: _name,
        enabled: _enabled,
        ...payload
    } = toAiProviderUpdatePayload(values);
    return payload;
}
