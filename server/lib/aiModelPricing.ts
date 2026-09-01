import type { AiProviderType } from "@server/lib/aiProviderDefaults";
import type { AiUsage } from "@server/lib/aiUsageExtraction";
import {
    aiModelCatalog,
    getCatalogProviderForType,
    type AiModelCatalogEntry,
    type CatalogProvider
} from "@server/lib/aiModelCatalog";

export type AiModelPricing = {
    inputCostPerToken: number | null;
    outputCostPerToken: number | null;
    cacheReadInputTokenCost: number | null;
    outputCostPerReasoningToken: number | null;
    // True when the match came from a different catalog provider than the
    // one mapped to this provider's type (e.g. an openRouter/custom model
    // id that only matched a global search across every provider). Costs
    // found this way are a best-effort approximation, not a guarantee the
    // upstream provider bills at the same rate.
    approximate: boolean;
};

function stripVendorPrefix(modelId: string): string | null {
    const idx = modelId.indexOf("/");
    if (idx === -1 || idx === modelId.length - 1) {
        return null;
    }
    return modelId.slice(idx + 1);
}

function toPricing(
    entry: AiModelCatalogEntry,
    approximate: boolean
): AiModelPricing {
    return {
        inputCostPerToken: entry.pricing.in,
        outputCostPerToken: entry.pricing.out,
        cacheReadInputTokenCost: entry.pricing.cache,
        outputCostPerReasoningToken: entry.pricing.reasoning,
        approximate
    };
}

function findEntry(
    modelId: string,
    provider: CatalogProvider | null
): AiModelCatalogEntry | null {
    const candidates = [modelId, stripVendorPrefix(modelId)].filter(
        (v): v is string => v != null
    );

    for (const key of candidates) {
        if (provider) {
            const match = aiModelCatalog.get(provider, key);
            if (match) {
                return match;
            }
            continue;
        }

        const match = aiModelCatalog.listByKey(key)[0];
        if (match) {
            return match;
        }
    }
    return null;
}

/**
 * Looks up per-token pricing for a model, scoped first to the catalog
 * provider that corresponds to our provider type, then falling back to a
 * global search across every provider (marked `approximate`) for provider
 * types that proxy arbitrary underlying models.
 */
export function getModelPricing(
    providerType: AiProviderType,
    modelId: string | undefined
): AiModelPricing | null {
    if (!modelId) {
        return null;
    }

    const catalogProvider = getCatalogProviderForType(providerType);

    if (catalogProvider) {
        const scoped = findEntry(modelId, catalogProvider);
        if (scoped) {
            return toPricing(scoped, false);
        }
    }

    const fallback = findEntry(modelId, null);
    if (fallback) {
        return toPricing(fallback, true);
    }

    return null;
}

export type AiCostBreakdown = {
    promptCost: number;
    cacheReadCost: number;
    cacheWriteCost: number;
    completionCost: number;
    reasoningCost: number;
    totalCost: number;
};

/**
 * Computes a $ cost breakdown for a usage record given a model's pricing.
 * Cache writes and reasoning tokens fall back to the normal input/output
 * rate respectively when the catalog has no dedicated rate for them (the
 * catalog has no cache-write field at all, and only some models report a
 * distinct reasoning rate).
 */
export function calculateAiCost(
    pricing: AiModelPricing | null,
    usage: AiUsage
): AiCostBreakdown | null {
    if (!pricing) {
        return null;
    }

    const inputRate = pricing.inputCostPerToken ?? 0;
    const outputRate = pricing.outputCostPerToken ?? 0;
    const cacheReadRate = pricing.cacheReadInputTokenCost ?? inputRate;
    const reasoningRate = pricing.outputCostPerReasoningToken ?? outputRate;

    const promptCost = usage.promptTokens * inputRate;
    const cacheReadCost = usage.cacheReadTokens * cacheReadRate;
    const cacheWriteCost = usage.cacheWriteTokens * inputRate;
    const completionCost = usage.completionTokens * outputRate;
    const reasoningCost = usage.reasoningTokens * reasoningRate;

    return {
        promptCost,
        cacheReadCost,
        cacheWriteCost,
        completionCost,
        reasoningCost,
        totalCost:
            promptCost +
            cacheReadCost +
            cacheWriteCost +
            completionCost +
            reasoningCost
    };
}
