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
