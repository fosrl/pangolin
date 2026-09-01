import { and, eq, inArray } from "drizzle-orm";
import {
    aiModels,
    aiProviders,
    resourceAiModels,
    siteResourceAiModels,
    Transaction
} from "@server/db";
import {
    AccessMode,
    ModelListType,
    clearPublicResourceAiConfig,
    clearSiteResourceAiConfig,
    isInferenceFieldsError,
    resolveProviderAttachments,
    setPublicResourceAiProviders,
    setSiteResourceAiProviders
} from "@server/lib/aiInferenceResource";

export type BlueprintAiModelInput = {
    model: string;
    listType: ModelListType;
};

export type BlueprintAiProviderInput = {
    provider: string;
    accessMode: AccessMode;
    enabled: boolean;
    models: string[];
};

async function resolveProviderNiceIds(
    orgId: string,
    niceIds: string[],
    trx: Transaction
): Promise<Map<string, number>> {
    const unique = [...new Set(niceIds)];
    if (unique.length === 0) {
        return new Map();
    }

    const rows = await trx
        .select({
            providerId: aiProviders.providerId,
            niceId: aiProviders.niceId
        })
        .from(aiProviders)
        .where(
            and(
                eq(aiProviders.orgId, orgId),
                inArray(aiProviders.niceId, unique)
            )
        );

    const byNiceId = new Map(rows.map((r) => [r.niceId, r.providerId]));
    const missing = unique.filter((id) => !byNiceId.has(id));
    if (missing.length > 0) {
        throw new Error(
            `AI provider(s) not found in this org: ${missing.join(", ")}`
        );
    }

    return byNiceId;
}

async function resolveModelKeys(
    providers: BlueprintAiProviderInput[],
    providerIdByNiceId: Map<string, number>,
    trx: Transaction
): Promise<Map<string, number>> {
    const providerIds = [
        ...new Set(
            providers
                .filter((p) => p.models.length > 0)
                .map((p) => providerIdByNiceId.get(p.provider)!)
        )
    ];

    if (providerIds.length === 0) {
        return new Map();
    }

    const rows = await trx
        .select({
            modelId: aiModels.modelId,
            modelKey: aiModels.modelKey,
            providerId: aiModels.providerId
        })
        .from(aiModels)
        .where(inArray(aiModels.providerId, providerIds));

    const byProviderAndKey = new Map<string, number>();
    for (const row of rows) {
        byProviderAndKey.set(`${row.providerId}::${row.modelKey}`, row.modelId);
    }

    const modelIdByEntryKey = new Map<string, number>();
    const missing: string[] = [];
    for (const provider of providers) {
        const providerId = providerIdByNiceId.get(provider.provider)!;
        for (const m of provider.models) {
            const modelId = byProviderAndKey.get(`${providerId}::${m}`);
            if (modelId === undefined) {
                missing.push(`${provider.provider}/${m}`);
                continue;
            }
            modelIdByEntryKey.set(`${provider.provider}::${m}`, modelId);
        }
    }

    if (missing.length > 0) {
        throw new Error(`AI model(s) not found: ${missing.join(", ")}`);
    }

    return modelIdByEntryKey;
}

async function validateModelEntries(input: {
    orgId: string;
    entries: { modelId: number }[];
    selectProviderIds: number[];
    trx: Transaction;
}): Promise<void> {
    if (input.entries.length === 0) {
        return;
    }

    if (input.selectProviderIds.length === 0) {
        throw new Error(
            "Set at least one attached AI provider to access-mode 'select' before declaring models"
        );
    }

    const modelIds = input.entries.map((e) => e.modelId);
    const catalogRows = await input.trx
        .select({
            modelId: aiModels.modelId,
            listType: aiModels.listType,
            providerId: aiModels.providerId,
            enabled: aiModels.enabled
        })
        .from(aiModels)
        .innerJoin(aiProviders, eq(aiModels.providerId, aiProviders.providerId))
        .where(
            and(
                inArray(aiModels.modelId, modelIds),
                inArray(aiModels.providerId, input.selectProviderIds),
                eq(aiProviders.orgId, input.orgId)
            )
        );

    const catalogById = new Map(catalogRows.map((row) => [row.modelId, row]));
    for (const entry of input.entries) {
        const catalog = catalogById.get(entry.modelId);
        if (!catalog) {
            throw new Error(
                `Model ${entry.modelId} does not exist or does not belong to a select-mode attached provider`
            );
        }
        if (!catalog.enabled) {
            throw new Error(
                `Model ${entry.modelId} is disabled on its provider`
            );
        }
    }
}

type SyncInferenceAiConfigInput = {
    orgId: string;
    trx: Transaction;
    mode: string;
    providers: BlueprintAiProviderInput[];
} & (
    | { scope: "public"; resourceId: number }
    | { scope: "site"; siteResourceId: number }
);

/**
 * Fully declarative: makes the resource's attached AI providers/models match
 * exactly what the blueprint declares (omitted providers/models are removed).
 * Non-inference resources have any leftover AI config cleared.
 */
export async function syncInferenceAiConfig(
    input: SyncInferenceAiConfigInput
): Promise<void> {
    const { orgId, trx, mode } = input;

    if (mode !== "inference") {
        if (input.scope === "public") {
            await clearPublicResourceAiConfig(input.resourceId, trx);
        } else {
            await clearSiteResourceAiConfig(input.siteResourceId, trx);
        }
        return;
    }

    const providerIdByNiceId = await resolveProviderNiceIds(
        orgId,
        input.providers.map((p) => p.provider),
        trx
    );

    const resolvedAttachments = await resolveProviderAttachments({
        orgId,
        attachments: input.providers.map((p) => ({
            providerId: providerIdByNiceId.get(p.provider)!,
            accessMode: p.accessMode,
            enabled: p.enabled
        })),
        requireAtLeastOne: false
    });
    if (isInferenceFieldsError(resolvedAttachments)) {
        throw new Error(resolvedAttachments.error);
    }

    if (input.scope === "public") {
        await setPublicResourceAiProviders(
            input.resourceId,
            resolvedAttachments,
            trx
        );
    } else {
        await setSiteResourceAiProviders(
            input.siteResourceId,
            resolvedAttachments,
            trx
        );
    }

    const modelIdByEntryKey = await resolveModelKeys(
        input.providers,
        providerIdByNiceId,
        trx
    );

    const modelEntries = input.providers.flatMap((p) =>
        p.models.map((m) => ({
            modelId: modelIdByEntryKey.get(`${p.provider}::${m}`)!
        }))
    );

    const selectProviderIds = resolvedAttachments
        .filter((a) => a.accessMode === "select")
        .map((a) => a.providerId);

    await validateModelEntries({
        orgId,
        entries: modelEntries,
        selectProviderIds,
        trx
    });

    if (input.scope === "public") {
        await trx
            .delete(resourceAiModels)
            .where(eq(resourceAiModels.resourceId, input.resourceId));
        if (modelEntries.length > 0) {
            await trx.insert(resourceAiModels).values(
                modelEntries.map((m) => ({
                    resourceId: input.resourceId,
                    modelId: m.modelId
                }))
            );
        }
    } else {
        await trx
            .delete(siteResourceAiModels)
            .where(
                eq(siteResourceAiModels.siteResourceId, input.siteResourceId)
            );
        if (modelEntries.length > 0) {
            await trx.insert(siteResourceAiModels).values(
                modelEntries.map((m) => ({
                    siteResourceId: input.siteResourceId,
                    modelId: m.modelId
                }))
            );
        }
    }
}
