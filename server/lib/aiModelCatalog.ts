import fs from "node:fs";
import axios from "axios";
import { z } from "zod";
import config from "@server/lib/config";
import logger from "@server/logger";
import type { AiProviderType } from "@server/lib/aiProviderDefaults";

export const CATALOG_PROVIDERS = [
    "openai",
    "anthropic",
    "gemini",
    "vertex",
    "azure",
    "bedrock"
] as const;

export type CatalogProvider = (typeof CATALOG_PROVIDERS)[number];

const CATALOG_PROVIDER_SET = new Set<string>(CATALOG_PROVIDERS);

// Each of our provider types maps to at most one catalog provider. Provider
// types that proxy arbitrary underlying models (openRouter, vercelAiGateway,
// custom) have no mapping.
const PROVIDER_CATALOG_MAP: Record<
    Exclude<AiProviderType, "custom">,
    CatalogProvider | null
> = {
    openai: "openai",
    anthropic: "anthropic",
    googleGemini: "gemini",
    vertexAi: "vertex",
    bedrock: "bedrock",
    microsoftFoundry: "azure",
    openRouter: null,
    vercelAiGateway: null
};

export function getCatalogProviderForType(
    type: AiProviderType
): CatalogProvider | null {
    if (type === "custom") {
        return null;
    }
    return PROVIDER_CATALOG_MAP[type];
}

/**
 * Per-model feature flags as reported upstream. `null` means the catalog has
 * no data for that model - deliberately distinct from `false`, so consumers
 * can tell "unsupported" apart from "unknown".
 */
export type AiModelCapabilityFlags = {
    functionCalling: boolean | null;
    vision: boolean | null;
    promptCaching: boolean | null;
    reasoning: boolean | null;
    responseSchema: boolean | null;
    webSearch: boolean | null;
};

export type AiModelCatalogEntry = {
    provider: CatalogProvider;
    model: string;
    pricing: {
        in: number | null;
        out: number | null;
        cache: number | null;
        reasoning: number | null;
    };
    limits: {
        /** Context window. */
        input: number | null;
        /** Cap on the output/max_tokens request parameter. */
        output: number | null;
    };
    capabilities: AiModelCapabilityFlags;
};

const flag = z.boolean().nullable().optional();

// limits/capabilities are optional so a catalog published before they were
// added (or an operator's own merge_file) still parses - those entries just
// report unknown metadata rather than failing the whole payload.
const catalogEntrySchema = z.object({
    model: z.string(),
    provider: z.string(),
    pricing: z
        .object({
            in: z.number().nullable().optional(),
            out: z.number().nullable().optional(),
            cache: z.number().nullable().optional(),
            reasoning: z.number().nullable().optional()
        })
        .optional(),
    limits: z
        .object({
            input: z.number().nullable().optional(),
            output: z.number().nullable().optional()
        })
        .optional(),
    capabilities: z
        .object({
            functionCalling: flag,
            vision: flag,
            promptCaching: flag,
            reasoning: flag,
            responseSchema: flag,
            webSearch: flag
        })
        .optional()
});

const catalogFileSchema = z.object({
    data: z.array(catalogEntrySchema).optional().default([])
});

type RawCatalogEntry = z.infer<typeof catalogEntrySchema>;

function normalizeCatalogProvider(raw: string): CatalogProvider | null {
    if (CATALOG_PROVIDER_SET.has(raw)) {
        return raw as CatalogProvider;
    }
    if (raw.startsWith("bedrock")) {
        return "bedrock";
    }
    if (raw.startsWith("vertex")) {
        return "vertex";
    }
    if (raw.startsWith("azure")) {
        return "azure";
    }
    return null;
}

function normalizeEntry(raw: RawCatalogEntry): AiModelCatalogEntry | null {
    const provider = normalizeCatalogProvider(raw.provider);
    if (!provider) {
        return null;
    }

    if (!raw.model) {
        return null;
    }

    return {
        provider,
        model: raw.model,
        pricing: {
            in: raw.pricing?.in ?? null,
            out: raw.pricing?.out ?? null,
            cache: raw.pricing?.cache ?? null,
            reasoning: raw.pricing?.reasoning ?? null
        },
        limits: {
            input: raw.limits?.input ?? null,
            output: raw.limits?.output ?? null
        },
        capabilities: {
            functionCalling: raw.capabilities?.functionCalling ?? null,
            vision: raw.capabilities?.vision ?? null,
            promptCaching: raw.capabilities?.promptCaching ?? null,
            reasoning: raw.capabilities?.reasoning ?? null,
            responseSchema: raw.capabilities?.responseSchema ?? null,
            webSearch: raw.capabilities?.webSearch ?? null
        }
    };
}

function providerKey(provider: CatalogProvider, key: string): string {
    return `${provider}\0${key}`;
}

export class AiModelCatalog {
    private entries: AiModelCatalogEntry[] = [];
    private byProvider = new Map<CatalogProvider, AiModelCatalogEntry[]>();
    private byProviderAndKey = new Map<string, AiModelCatalogEntry>();
    private byKey = new Map<string, AiModelCatalogEntry[]>();
    private refreshTimer: NodeJS.Timeout | null = null;

    /**
     * Loads the catalog into memory and schedules periodic background refreshes.
     * Call once at server startup.
     */
    async init(): Promise<void> {
        await this.refresh();
        this.scheduleNextRefresh();
    }

    /** Exact lookup by catalog provider and model key. */
    get(
        provider: CatalogProvider,
        key: string
    ): AiModelCatalogEntry | undefined {
        return this.byProviderAndKey.get(providerKey(provider, key));
    }

    /** All models for a catalog provider. */
    list(provider: CatalogProvider): AiModelCatalogEntry[] {
        return this.byProvider.get(provider) ?? [];
    }

    /** All catalog entries that share a model key, across providers. */
    listByKey(key: string): AiModelCatalogEntry[] {
        return this.byKey.get(key) ?? [];
    }

    /** Full in-memory catalog. */
    getAll(): AiModelCatalogEntry[] {
        return this.entries;
    }

    private setEntries(entries: AiModelCatalogEntry[]): void {
        const byProvider = new Map<CatalogProvider, AiModelCatalogEntry[]>();
        const byProviderAndKey = new Map<string, AiModelCatalogEntry>();
        const byKey = new Map<string, AiModelCatalogEntry[]>();

        for (const entry of entries) {
            const list = byProvider.get(entry.provider) ?? [];
            list.push(entry);
            byProvider.set(entry.provider, list);

            const mapKey = providerKey(entry.provider, entry.model);
            if (!byProviderAndKey.has(mapKey)) {
                byProviderAndKey.set(mapKey, entry);
            }

            const keyList = byKey.get(entry.model) ?? [];
            keyList.push(entry);
            byKey.set(entry.model, keyList);
        }

        this.entries = entries;
        this.byProvider = byProvider;
        this.byProviderAndKey = byProviderAndKey;
        this.byKey = byKey;
    }

    private async fetchFromFile(
        filePath: string
    ): Promise<AiModelCatalogEntry[] | null> {
        try {
            if (!fs.existsSync(filePath)) {
                logger.warn(
                    `AI model catalog file not found at ${filePath}; cost calculation will fall back to unknown pricing`
                );
                return null;
            }
            const raw = fs.readFileSync(filePath, "utf-8");
            const result = catalogFileSchema.safeParse(JSON.parse(raw));
            if (!result.success) {
                logger.warn(
                    `AI model catalog file at ${filePath} failed validation: ${result.error.message}`
                );
                return null;
            }
            return result.data.data
                .map(normalizeEntry)
                .filter((e): e is AiModelCatalogEntry => e != null);
        } catch (error) {
            logger.warn("Failed to read AI model catalog file", { error });
            return null;
        }
    }

    private async fetchFromUpstream(
        upstreamUrl: string
    ): Promise<AiModelCatalogEntry[] | null> {
        try {
            const res = await axios.get(upstreamUrl, { timeout: 15_000 });
            const result = catalogFileSchema.safeParse(res.data);
            if (!result.success) {
                logger.warn(
                    `AI model catalog response from ${upstreamUrl} failed validation: ${result.error.message}`
                );
                return null;
            }
            return result.data.data
                .map(normalizeEntry)
                .filter((e): e is AiModelCatalogEntry => e != null);
        } catch (error: any) {
            logger.warn(
                `Failed to fetch AI model catalog from ${upstreamUrl}: ${error.message || error}`
            );
            return null;
        }
    }

    private async refresh(): Promise<void> {
        const { file, merge_file, upstream_url } =
            config.getRawConfig().ai.model_catalog;

        const fetched = file
            ? await this.fetchFromFile(file)
            : await this.fetchFromUpstream(upstream_url);

        if (!fetched) {
            logger.debug(
                "AI model catalog refresh failed; keeping previously loaded catalog in memory"
            );
            return;
        }

        let merged = fetched;
        if (merge_file) {
            const mergeEntries = await this.fetchFromFile(merge_file);
            if (mergeEntries) {
                // Entries from the base catalog take precedence; the merge
                // file only adds models not already present.
                merged = [...fetched, ...mergeEntries];
            }
        }

        this.setEntries(merged);
        logger.debug(
            `AI model catalog refreshed: ${this.entries.length} models loaded`
        );
    }

    private scheduleNextRefresh(): void {
        const { refresh_interval_min_hours, refresh_interval_max_hours } =
            config.getRawConfig().ai.model_catalog;

        // Jittered rather than fixed so that many self-hosted instances don't
        // all hit the upstream catalog endpoint at the same moment.
        const minMs = refresh_interval_min_hours * 60 * 60 * 1000;
        const maxMs = refresh_interval_max_hours * 60 * 60 * 1000;
        const delayMs = minMs + Math.random() * Math.max(0, maxMs - minMs);

        if (this.refreshTimer) {
            clearTimeout(this.refreshTimer);
        }
        this.refreshTimer = setTimeout(async () => {
            await this.refresh();
            this.scheduleNextRefresh();
        }, delayMs);
    }
}

export const aiModelCatalog = new AiModelCatalog();

/**
 * Full catalog entries for a provider type, deduplicated by model id and
 * sorted by id. Model discovery uses these to report real token limits and
 * capability flags; `listCatalogModelsForType` is the id-only view of the
 * same list.
 */
export function listCatalogEntriesForType(
    type: AiProviderType,
    query?: string
): AiModelCatalogEntry[] {
    const catalogProvider = getCatalogProviderForType(type);

    let entries = catalogProvider ? aiModelCatalog.list(catalogProvider) : [];

    if (query) {
        const q = query.toLowerCase();
        entries = entries.filter((e) => e.model.toLowerCase().includes(q));
    }

    const seen = new Set<string>();
    entries = entries.filter((e) => {
        if (seen.has(e.model)) {
            return false;
        }
        seen.add(e.model);
        return true;
    });

    return [...entries].sort((a, b) => a.model.localeCompare(b.model));
}

export function listCatalogModelsForType(
    type: AiProviderType,
    query?: string
): { model: string }[] {
    return listCatalogEntriesForType(type, query).map((entry) => ({
        model: entry.model
    }));
}

/**
 * Loads the AI model pricing catalog into memory and schedules periodic
 * background refreshes. Call once at server startup.
 */
export async function initAiModelCatalog(): Promise<void> {
    await aiModelCatalog.init();
}
