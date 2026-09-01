import {
    aiModelCatalog,
    getCatalogProviderForType,
    type CatalogProvider
} from "@server/lib/aiModelCatalog";
import type { AiProviderType } from "@server/lib/aiProviderDefaults";

function stripVendorPrefix(modelId: string): string | null {
    const idx = modelId.indexOf("/");
    if (idx === -1 || idx === modelId.length - 1) {
        return null;
    }
    return modelId.slice(idx + 1);
}

function modelKeysToTry(modelId: string): string[] {
    const keys = [modelId];
    const stripped = stripVendorPrefix(modelId);
    if (stripped) {
        keys.push(stripped);
    }
    return keys;
}

function catalogOwnsModel(
    catalogProvider: CatalogProvider,
    modelId: string
): boolean {
    for (const key of modelKeysToTry(modelId)) {
        if (aiModelCatalog.get(catalogProvider, key)) {
            return true;
        }
    }
    return false;
}

function modelKnownInAnyCatalog(modelId: string): boolean {
    for (const key of modelKeysToTry(modelId)) {
        if (aiModelCatalog.listByKey(key).length > 0) {
            return true;
        }
    }
    return false;
}

/**
 * How strongly a provider "owns" a requested model id via the known catalog.
 *
 * 2 - Typed provider whose catalog contains the model
 * 1 - Aggregator/custom that can proxy a catalog-known model
 * 0 - No ownership signal (typed miss, or unknown model on aggregator/custom)
 */
export function catalogOwnershipScore(
    type: AiProviderType,
    modelId: string
): number {
    const catalogProvider = getCatalogProviderForType(type);
    if (catalogProvider != null) {
        return catalogOwnsModel(catalogProvider, modelId) ? 2 : 0;
    }
    return modelKnownInAnyCatalog(modelId) ? 1 : 0;
}

/**
 * Prefer native vendor providers over aggregators over custom when catalog
 * ownership is tied.
 *
 * 2 - Native typed provider (openai, anthropic, gemini, ...)
 * 1 - Aggregator gateway (openRouter, vercelAiGateway)
 * 0 - Custom
 */
export function providerClassRank(type: AiProviderType): number {
    if (type === "custom") {
        return 0;
    }
    if (type === "openRouter" || type === "vercelAiGateway") {
        return 1;
    }
    return 2;
}

export function keepBestScored<T>(
    items: T[],
    scoreFn: (item: T) => number
): T[] {
    if (items.length <= 1) {
        return items;
    }
    let best = Number.NEGATIVE_INFINITY;
    for (const item of items) {
        const score = scoreFn(item);
        if (score > best) {
            best = score;
        }
    }
    return items.filter((item) => scoreFn(item) === best);
}
