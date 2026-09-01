import {
    isAllowedByLists,
    isModelKeyPattern
} from "@server/lib/aiModelKeyMatch";
import type { AiModelCapabilityFlags } from "@server/lib/aiModelCatalog";

// Anthropic's Models API pagination: 20 per page by default, 1..1000.
export const MODEL_PAGE_DEFAULT_LIMIT = 20;
export const MODEL_PAGE_MAX_LIMIT = 1000;

// Release dates aren't something we can know for a wildcard allow pattern or a
// catalog entry. The Models API explicitly permits an epoch value when the
// release date is unknown.
const UNKNOWN_CREATED_AT = new Date(0).toISOString();

/**
 * One entry of Anthropic's `GET /v1/models` response. Only the identity fields
 * can be filled in from a provider's model lists - token limits and
 * per-model capability flags aren't derivable from an allow/block list, and the
 * API schema declares all three nullable.
 */
export type AnthropicModelInfo = {
    type: "model";
    id: string;
    display_name: string;
    created_at: string;
    max_input_tokens: number | null;
    max_tokens: number | null;
    capabilities: Record<string, unknown> | null;
};

/** A model row an administrator configured explicitly on a provider. */
export type ConfiguredModel = { name: string; createdAt: number };

/** What the pricing catalog knows about a model beyond its id. */
export type CatalogModelMetadata = {
    maxInputTokens: number | null;
    maxOutputTokens: number | null;
    capabilities: AiModelCapabilityFlags;
};

/**
 * Translates the catalog's flat feature flags into the nested shape
 * Anthropic's Models API uses. Best-effort by nature: the catalog carries a
 * coarser set of flags than the Models API describes, so anything it reports
 * as unknown (`null`) is surfaced as unsupported rather than invented.
 */
export function capabilitiesFromCatalog(
    flags: AiModelCapabilityFlags
): Record<string, unknown> {
    const supported = (value: boolean | null) => ({
        supported: value === true
    });
    // The catalog has a single `reasoning` flag and no way to distinguish
    // adaptive from budget_tokens-style thinking, so both variants follow it.
    const reasoning = flags.reasoning === true;

    return {
        batch: supported(null),
        citations: supported(null),
        code_execution: supported(null),
        context_management: {
            supported: false,
            clear_thinking_20251015: null,
            clear_tool_uses_20250919: null,
            compact_20260112: null
        },
        effort: {
            supported: reasoning,
            low: supported(flags.reasoning),
            medium: supported(flags.reasoning),
            high: supported(flags.reasoning),
            max: supported(flags.reasoning),
            xhigh: null
        },
        image_input: supported(flags.vision),
        pdf_input: supported(null),
        structured_outputs: supported(flags.responseSchema),
        thinking: {
            supported: reasoning,
            types: {
                adaptive: { supported: reasoning },
                enabled: { supported: reasoning }
            }
        }
    };
}

/**
 * One attached provider's contribution to a resource's model listing, with the
 * allow/block lists already resolved for the attachment's access mode.
 */
export type ModelDiscoveryProvider = {
    providerId: number;
    allows: string[];
    blocks: string[];
    /**
     * Concrete model ids the provider's type is known to serve, with whatever
     * the catalog knows about each. This is what lets a wildcard allow such as
     * `claude-*` enumerate into real ids; provider types with no catalog
     * (aggregators, custom) pass an empty map and surface only their exact
     * allow entries.
     */
    catalog: Map<string, CatalogModelMetadata>;
    /** Keyed by model key, for display names and creation times. */
    configured: Map<string, ConfiguredModel>;
};

export type ModelPage = {
    data: AnthropicModelInfo[];
    has_more: boolean;
};

/**
 * Expands one provider's effective allow/block lists into concrete model ids.
 * Two sources feed the candidate set: exact (non-wildcard) allow entries, which
 * are already concrete ids, and the catalog for the provider's type, which is
 * what makes wildcard allows enumerable. Every candidate is then run back
 * through the same allow/block check the inference pipeline applies, so a block
 * pattern hides a model here exactly as it would reject it at request time.
 */
export function expandProviderModels(
    provider: ModelDiscoveryProvider
): AnthropicModelInfo[] {
    const candidates = new Set<string>();

    for (const allow of provider.allows) {
        if (!isModelKeyPattern(allow)) {
            candidates.add(allow);
        }
    }
    for (const modelId of provider.catalog.keys()) {
        candidates.add(modelId);
    }

    const models: AnthropicModelInfo[] = [];
    for (const modelKey of candidates) {
        if (!isAllowedByLists(modelKey, provider.allows, provider.blocks)) {
            continue;
        }
        const configured = provider.configured.get(modelKey);
        const catalog = provider.catalog.get(modelKey);

        models.push({
            type: "model",
            id: modelKey,
            display_name: configured?.name || modelKey,
            created_at: configured
                ? new Date(configured.createdAt).toISOString()
                : UNKNOWN_CREATED_AT,
            max_input_tokens: catalog?.maxInputTokens ?? null,
            max_tokens: catalog?.maxOutputTokens ?? null,
            capabilities: catalog
                ? capabilitiesFromCatalog(catalog.capabilities)
                : null
        });
    }

    return models;
}

/**
 * Aggregates the permitted models across every provider attached to a
 * resource. Unlike an inference request there is no requested model to
 * disambiguate on, so no provider selection happens - the listing is the union
 * of what each provider would accept, deduplicated by model id.
 */
export function listPermittedModels(
    providers: ModelDiscoveryProvider[]
): AnthropicModelInfo[] {
    const byModelId = new Map<string, AnthropicModelInfo>();

    // Sorted so a model offered by two providers always resolves to the same
    // entry, which keeps the cursor ordering stable across requests.
    const ordered = [...providers].sort((a, b) => a.providerId - b.providerId);

    for (const provider of ordered) {
        for (const model of expandProviderModels(provider)) {
            if (!byModelId.has(model.id)) {
                byModelId.set(model.id, model);
            }
        }
    }

    // "More recently released models are listed first" per the Models API,
    // with the id as a tie-break so the ordering is total - cursor pagination
    // needs it to be stable between calls.
    return [...byModelId.values()].sort((a, b) => {
        const byCreated = b.created_at.localeCompare(a.created_at);
        return byCreated !== 0 ? byCreated : a.id.localeCompare(b.id);
    });
}

/**
 * Applies Anthropic's cursor pagination to an ordered model list. `after_id`
 * returns the page immediately after that model, `before_id` the page
 * immediately before it. Returns an error message for a caller mistake
 * (both cursors, or a cursor naming a model that isn't in the list).
 */
export function paginateModels(
    models: AnthropicModelInfo[],
    limit: number,
    cursor: { afterId?: string; beforeId?: string }
): ModelPage | { error: string } {
    if (cursor.afterId && cursor.beforeId) {
        return { error: "Only one of after_id and before_id may be provided" };
    }

    const cursorId = cursor.afterId ?? cursor.beforeId;
    if (!cursorId) {
        return {
            data: models.slice(0, limit),
            has_more: models.length > limit
        };
    }

    const index = models.findIndex((model) => model.id === cursorId);
    if (index === -1) {
        return { error: `Unknown cursor id "${cursorId}"` };
    }

    if (cursor.afterId) {
        const start = index + 1;
        return {
            data: models.slice(start, start + limit),
            has_more: models.length > start + limit
        };
    }

    const start = Math.max(0, index - limit);
    return {
        data: models.slice(start, index),
        has_more: start > 0
    };
}
