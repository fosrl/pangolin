import type { AiModel, AiProvider } from "@server/db";
import type { PaginatedResponse } from "@server/types/Pagination";
import {
    parseAiProviderHeaders,
    type AiProviderAuthType,
    type AiProviderHeader
} from "@server/lib/aiProviderDefaults";
import {
    parseCapabilities,
    type AiCapability
} from "@server/lib/aiCapabilities";
import { decrypt } from "@server/lib/crypto";
import config from "@server/lib/config";
import "@server/extendZod";
import { z } from "zod";
import { createSelectSchema } from "drizzle-zod";
import {
    aiModels,
    aiProviders,
    siteResourceAiModels,
    siteResourceAiProviders
} from "@server/db";

export type AiProviderPublic = Omit<
    AiProvider,
    "apiKey" | "capabilities" | "headers"
> & {
    apiKey?: string | null;
    capabilities: AiCapability[];
    headers: AiProviderHeader[] | null;
    effectiveUpstreamUrl: string | null;
    effectiveAuthType: AiProviderAuthType;
};

export type ListAiProvidersResponse = PaginatedResponse<{
    providers: AiProviderPublic[];
}>;

export type GetAiProviderResponse = {
    provider: AiProviderPublic;
};

export type CreateOrEditAiProviderResponse = {
    provider: AiProviderPublic;
};

export type ListAiModelsResponse = PaginatedResponse<{
    models: AiModel[];
}>;

export type ListCatalogModelsResponse = {
    models: { model: string }[];
};

export type GetAiModelResponse = {
    model: AiModel;
};

export type CreateOrEditAiModelResponse = {
    model: AiModel;
};

export function toPublicAiProvider(
    provider: AiProvider,
    options?: { includeApiKey?: boolean }
): AiProviderPublic {
    const {
        apiKey: encryptedApiKey,
        capabilities: rawCapabilities,
        headers: rawHeaders,
        ...rest
    } = provider;

    let apiKey: string | null | undefined;
    if (options?.includeApiKey) {
        if (encryptedApiKey) {
            apiKey = decrypt(
                encryptedApiKey,
                config.getRawConfig().server.secret!
            );
        } else {
            apiKey = null;
        }
    }

    const parsedHeaders = parseAiProviderHeaders(
        rawHeaders,
        config.getRawConfig().server.secret!
    );

    return {
        ...rest,
        ...(options?.includeApiKey ? { apiKey } : {}),
        capabilities: parseCapabilities(rawCapabilities),
        headers: parsedHeaders.length > 0 ? parsedHeaders : null,
        effectiveUpstreamUrl: provider.upstreamUrl,
        effectiveAuthType: provider.authType as AiProviderAuthType
    };
}

export const AiProviderAttachmentSchema = createSelectSchema(
    siteResourceAiProviders,
    {
        providerId: (s) =>
            s.openapi({ description: "Numeric ID of the AI provider." }),
        enabled: (s) =>
            s.openapi({
                description:
                    "Whether the provider is enabled for this resource."
            }),
        accessMode: z.enum(["inherit", "select"]).openapi({
            description:
                "inherit uses the provider's own allow/block model lists. select uses the models chosen on this resource."
        })
    }
)
    .pick({ providerId: true, enabled: true, accessMode: true })
    .extend(
        createSelectSchema(aiProviders, {
            niceId: (s) =>
                s.openapi({
                    description:
                        "Human readable ID of the provider, unique within the organization."
                }),
            name: (s) => s.openapi({ description: "Provider name." }),
            type: z
                .enum([
                    "anthropic",
                    "bedrock",
                    "custom",
                    "googleGemini",
                    "microsoftFoundry",
                    "openRouter",
                    "openai",
                    "vercelAiGateway",
                    "vertexAi"
                ])
                .openapi({
                    description: "The AI provider this configuration talks to."
                })
        }).pick({ niceId: true, name: true, type: true }).shape
    )
    .extend({
        providerEnabled: z.boolean().openapi({
            description: "Whether the provider itself is enabled."
        })
    });

export const AiModelSelectionSchema = createSelectSchema(siteResourceAiModels, {
    modelId: (s) => s.openapi({ description: "Numeric ID of the model." }),
    listType: z.enum(["allow", "block"]).openapi({
        description: "Whether the model is on the allow list or the block list."
    })
})
    .pick({ modelId: true, listType: true })
    .extend(
        createSelectSchema(aiModels, {
            modelKey: (s) =>
                s.openapi({
                    description:
                        "Identifier sent to the upstream provider to select the model."
                }),
            name: (s) =>
                s.openapi({ description: "Display name of the model." }),
            providerId: (s) =>
                s.openapi({
                    description: "ID of the provider the model belongs to."
                }),
            enabled: (s) =>
                s.openapi({ description: "Whether the model is enabled." })
        }).pick({ modelKey: true, name: true, providerId: true, enabled: true })
            .shape
    );
