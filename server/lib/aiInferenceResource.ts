import { and, eq, inArray } from "drizzle-orm";
import {
    aiModels,
    aiProviders,
    db,
    resourceAiModels,
    resourceAiProviders,
    siteResourceAiModels,
    siteResourceAiProviders,
    type Transaction
} from "@server/db";
import { z } from "zod";

type DbOrTrx = Transaction | typeof db;

export const modelListTypeSchema = z.enum(["allow", "block"]);

export type ModelListType = z.infer<typeof modelListTypeSchema>;

export const accessModeSchema = z.enum(["inherit", "select"]);

export type AccessMode = z.infer<typeof accessModeSchema>;

export const resourceAiProviderAttachmentSchema = z.strictObject({
    providerId: z.number().int().positive(),
    accessMode: accessModeSchema.optional().default("inherit"),
    enabled: z.boolean().optional().default(true)
});

export type ResourceAiProviderInput = z.infer<
    typeof resourceAiProviderAttachmentSchema
>;

export type ResourceAiProviderAttachment = {
    providerId: number;
    accessMode: AccessMode;
    enabled: boolean;
};

export const resourceAiModelEntrySchema = z.strictObject({
    modelId: z.number().int().positive(),
    listType: modelListTypeSchema
});

export type ResourceAiModelEntry = z.infer<typeof resourceAiModelEntrySchema>;

export type InferenceFieldsError = {
    error: string;
};

export function isInferenceFieldsError(
    value: { error: string } | object
): value is InferenceFieldsError {
    return "error" in value;
}

/**
 * Resolve which allow/block patterns apply for an attachment.
 * inherit → provider lists; select → resource-selected lists (replace).
 */
export function resolveEffectiveLists(input: {
    accessMode: AccessMode;
    providerAllows: string[];
    providerBlocks: string[];
    resourceAllows: string[];
    resourceBlocks: string[];
}): { allows: string[]; blocks: string[] } {
    if (input.accessMode === "select") {
        return {
            allows: input.resourceAllows,
            blocks: input.resourceBlocks
        };
    }
    return {
        allows: input.providerAllows,
        blocks: input.providerBlocks
    };
}

function normalizeAttachments(
    inputs: ResourceAiProviderInput[]
): ResourceAiProviderAttachment[] {
    const byProviderId = new Map<
        number,
        { accessMode: AccessMode; enabled: boolean }
    >();
    for (const input of inputs) {
        byProviderId.set(input.providerId, {
            accessMode: input.accessMode ?? "inherit",
            enabled: input.enabled ?? true
        });
    }
    return [...byProviderId.entries()].map(
        ([providerId, { accessMode, enabled }]) => ({
            providerId,
            accessMode,
            enabled
        })
    );
}

/**
 * Validate provider attachments for an org.
 */
export async function resolveProviderAttachments(input: {
    orgId: string;
    attachments: ResourceAiProviderInput[];
    requireAtLeastOne: boolean;
}): Promise<ResourceAiProviderAttachment[] | InferenceFieldsError> {
    const attachments = normalizeAttachments(input.attachments);

    if (input.requireAtLeastOne && attachments.length === 0) {
        return {
            error: "At least one AI provider is required for inference-mode resources"
        };
    }

    if (attachments.length === 0) {
        return [];
    }

    const providerIds = attachments.map((a) => a.providerId);
    const providers = await db
        .select({
            providerId: aiProviders.providerId,
            orgId: aiProviders.orgId,
            enabled: aiProviders.enabled
        })
        .from(aiProviders)
        .where(
            and(
                inArray(aiProviders.providerId, providerIds),
                eq(aiProviders.orgId, input.orgId)
            )
        );

    if (providers.length !== providerIds.length) {
        return {
            error: "One or more AI providers were not found in this organization"
        };
    }

    const disabled = providers.find((p) => !p.enabled);
    if (disabled) {
        return {
            error: `AI provider with ID ${disabled.providerId} is disabled`
        };
    }

    return attachments;
}

export async function assertInferenceModeAllowsProviderFields(input: {
    mode: string;
    hasProviderAttachments: boolean;
}): Promise<InferenceFieldsError | null> {
    if (input.mode === "inference") {
        return null;
    }
    if (input.hasProviderAttachments) {
        return {
            error: "AI providers can only be attached to inference-mode resources"
        };
    }
    return null;
}

/**
 * Attach providers to a resource. Inherit attachments use the provider lists
 * as-is (resource model rows for those providers are pruned). Select
 * attachments keep resource-selected allow/block subsets.
 */
export async function setPublicResourceAiProviders(
    resourceId: number,
    attachments: ResourceAiProviderAttachment[],
    trx: DbOrTrx = db
): Promise<void> {
    await trx
        .delete(resourceAiProviders)
        .where(eq(resourceAiProviders.resourceId, resourceId));

    if (attachments.length > 0) {
        await trx.insert(resourceAiProviders).values(
            attachments.map((a) => ({
                resourceId,
                providerId: a.providerId,
                accessMode: a.accessMode,
                enabled: a.enabled
            }))
        );
    }

    await prunePublicResourceModelsToSelectProviders(
        resourceId,
        attachments,
        trx
    );
}

export async function setSiteResourceAiProviders(
    siteResourceId: number,
    attachments: ResourceAiProviderAttachment[],
    trx: DbOrTrx = db
): Promise<void> {
    await trx
        .delete(siteResourceAiProviders)
        .where(eq(siteResourceAiProviders.siteResourceId, siteResourceId));

    if (attachments.length > 0) {
        await trx.insert(siteResourceAiProviders).values(
            attachments.map((a) => ({
                siteResourceId,
                providerId: a.providerId,
                accessMode: a.accessMode,
                enabled: a.enabled
            }))
        );
    }

    await pruneSiteResourceModelsToSelectProviders(
        siteResourceId,
        attachments,
        trx
    );
}

/**
 * Keep resource model rows only for providers in select mode.
 */
async function prunePublicResourceModelsToSelectProviders(
    resourceId: number,
    attachments: ResourceAiProviderAttachment[],
    trx: DbOrTrx
): Promise<void> {
    const selectProviderIds = attachments
        .filter((a) => a.accessMode === "select")
        .map((a) => a.providerId);

    if (selectProviderIds.length === 0) {
        await trx
            .delete(resourceAiModels)
            .where(eq(resourceAiModels.resourceId, resourceId));
        return;
    }

    const existing = await trx
        .select({
            modelId: resourceAiModels.modelId,
            providerId: aiModels.providerId
        })
        .from(resourceAiModels)
        .innerJoin(aiModels, eq(resourceAiModels.modelId, aiModels.modelId))
        .where(eq(resourceAiModels.resourceId, resourceId));

    const allowed = new Set(selectProviderIds);
    const toRemove = existing
        .filter((row) => !allowed.has(row.providerId))
        .map((row) => row.modelId);

    if (toRemove.length > 0) {
        await trx
            .delete(resourceAiModels)
            .where(
                and(
                    eq(resourceAiModels.resourceId, resourceId),
                    inArray(resourceAiModels.modelId, toRemove)
                )
            );
    }
}

async function pruneSiteResourceModelsToSelectProviders(
    siteResourceId: number,
    attachments: ResourceAiProviderAttachment[],
    trx: DbOrTrx
): Promise<void> {
    const selectProviderIds = attachments
        .filter((a) => a.accessMode === "select")
        .map((a) => a.providerId);

    if (selectProviderIds.length === 0) {
        await trx
            .delete(siteResourceAiModels)
            .where(eq(siteResourceAiModels.siteResourceId, siteResourceId));
        return;
    }

    const existing = await trx
        .select({
            modelId: siteResourceAiModels.modelId,
            providerId: aiModels.providerId
        })
        .from(siteResourceAiModels)
        .innerJoin(aiModels, eq(siteResourceAiModels.modelId, aiModels.modelId))
        .where(eq(siteResourceAiModels.siteResourceId, siteResourceId));

    const allowed = new Set(selectProviderIds);
    const toRemove = existing
        .filter((row) => !allowed.has(row.providerId))
        .map((row) => row.modelId);

    if (toRemove.length > 0) {
        await trx
            .delete(siteResourceAiModels)
            .where(
                and(
                    eq(siteResourceAiModels.siteResourceId, siteResourceId),
                    inArray(siteResourceAiModels.modelId, toRemove)
                )
            );
    }
}

export async function clearPublicResourceAiConfig(
    resourceId: number,
    trx: DbOrTrx = db
): Promise<void> {
    await trx
        .delete(resourceAiModels)
        .where(eq(resourceAiModels.resourceId, resourceId));
    await trx
        .delete(resourceAiProviders)
        .where(eq(resourceAiProviders.resourceId, resourceId));
}

export async function clearSiteResourceAiConfig(
    siteResourceId: number,
    trx: DbOrTrx = db
): Promise<void> {
    await trx
        .delete(siteResourceAiModels)
        .where(eq(siteResourceAiModels.siteResourceId, siteResourceId));
    await trx
        .delete(siteResourceAiProviders)
        .where(eq(siteResourceAiProviders.siteResourceId, siteResourceId));
}

export async function listPublicResourceAiProviders(resourceId: number) {
    return db
        .select({
            providerId: resourceAiProviders.providerId,
            niceId: aiProviders.niceId,
            name: aiProviders.name,
            type: aiProviders.type,
            enabled: resourceAiProviders.enabled,
            providerEnabled: aiProviders.enabled,
            accessMode: resourceAiProviders.accessMode
        })
        .from(resourceAiProviders)
        .innerJoin(
            aiProviders,
            eq(resourceAiProviders.providerId, aiProviders.providerId)
        )
        .where(eq(resourceAiProviders.resourceId, resourceId));
}

export async function listSiteResourceAiProviders(siteResourceId: number) {
    return db
        .select({
            providerId: siteResourceAiProviders.providerId,
            niceId: aiProviders.niceId,
            name: aiProviders.name,
            type: aiProviders.type,
            enabled: siteResourceAiProviders.enabled,
            providerEnabled: aiProviders.enabled,
            accessMode: siteResourceAiProviders.accessMode
        })
        .from(siteResourceAiProviders)
        .innerJoin(
            aiProviders,
            eq(siteResourceAiProviders.providerId, aiProviders.providerId)
        )
        .where(eq(siteResourceAiProviders.siteResourceId, siteResourceId));
}

export type EffectiveAllowModel = {
    modelId: number;
    modelKey: string;
    name: string;
    providerId: number;
    providerName: string;
};

export async function listEffectiveAllowModels(options: {
    resourceId?: number;
    siteResourceId?: number;
}): Promise<EffectiveAllowModel[]> {
    if (
        options.resourceId === undefined &&
        options.siteResourceId === undefined
    ) {
        return [];
    }

    const attachments =
        options.resourceId !== undefined
            ? await listPublicResourceAiProviders(options.resourceId)
            : await listSiteResourceAiProviders(options.siteResourceId!);

    const activeAttachments = attachments.filter(
        (a) => a.enabled && a.providerEnabled
    );
    if (activeAttachments.length === 0) {
        return [];
    }

    const inheritProviderIds = activeAttachments
        .filter((a) => a.accessMode === "inherit")
        .map((a) => a.providerId);
    const selectProviderIds = activeAttachments
        .filter((a) => a.accessMode === "select")
        .map((a) => a.providerId);

    const providerNameById = new Map(
        activeAttachments.map((a) => [a.providerId, a.name] as const)
    );

    const models: EffectiveAllowModel[] = [];

    if (inheritProviderIds.length > 0) {
        const rows = await db
            .select({
                modelId: aiModels.modelId,
                modelKey: aiModels.modelKey,
                name: aiModels.name,
                providerId: aiModels.providerId
            })
            .from(aiModels)
            .where(
                and(
                    inArray(aiModels.providerId, inheritProviderIds),
                    eq(aiModels.enabled, true),
                    eq(aiModels.listType, "allow")
                )
            );
        for (const row of rows) {
            models.push({
                ...row,
                providerName: providerNameById.get(row.providerId) ?? ""
            });
        }
    }

    if (selectProviderIds.length > 0) {
        if (options.resourceId !== undefined) {
            const rows = await db
                .select({
                    modelId: aiModels.modelId,
                    modelKey: aiModels.modelKey,
                    name: aiModels.name,
                    providerId: aiModels.providerId
                })
                .from(resourceAiModels)
                .innerJoin(
                    aiModels,
                    eq(resourceAiModels.modelId, aiModels.modelId)
                )
                .where(
                    and(
                        eq(resourceAiModels.resourceId, options.resourceId),
                        inArray(aiModels.providerId, selectProviderIds),
                        eq(resourceAiModels.listType, "allow"),
                        eq(aiModels.enabled, true)
                    )
                );
            for (const row of rows) {
                models.push({
                    ...row,
                    providerName: providerNameById.get(row.providerId) ?? ""
                });
            }
        } else if (options.siteResourceId !== undefined) {
            const rows = await db
                .select({
                    modelId: aiModels.modelId,
                    modelKey: aiModels.modelKey,
                    name: aiModels.name,
                    providerId: aiModels.providerId
                })
                .from(siteResourceAiModels)
                .innerJoin(
                    aiModels,
                    eq(siteResourceAiModels.modelId, aiModels.modelId)
                )
                .where(
                    and(
                        eq(
                            siteResourceAiModels.siteResourceId,
                            options.siteResourceId
                        ),
                        inArray(aiModels.providerId, selectProviderIds),
                        eq(siteResourceAiModels.listType, "allow"),
                        eq(aiModels.enabled, true)
                    )
                );
            for (const row of rows) {
                models.push({
                    ...row,
                    providerName: providerNameById.get(row.providerId) ?? ""
                });
            }
        }
    }

    models.sort((a, b) => {
        const byProvider = a.providerName.localeCompare(
            b.providerName,
            undefined,
            {
                sensitivity: "base"
            }
        );
        if (byProvider !== 0) {
            return byProvider;
        }
        return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
    });

    return models;
}

/**
 * Model list APIs require an inference resource with at least one select-mode
 * attached provider.
 */
export async function assertPublicModelListApiEligible(resource: {
    resourceId: number;
    mode: string;
}): Promise<string | null> {
    if (resource.mode !== "inference") {
        return "AI model lists are only supported on inference-mode resources";
    }

    const [row] = await db
        .select({ providerId: resourceAiProviders.providerId })
        .from(resourceAiProviders)
        .where(
            and(
                eq(resourceAiProviders.resourceId, resource.resourceId),
                eq(resourceAiProviders.accessMode, "select")
            )
        )
        .limit(1);

    if (!row) {
        return "Set at least one attached AI provider to select mode before managing model lists";
    }
    return null;
}

export async function assertSiteModelListApiEligible(siteResource: {
    siteResourceId: number;
    mode: string;
}): Promise<string | null> {
    if (siteResource.mode !== "inference") {
        return "AI model lists are only supported on inference-mode resources";
    }

    const [row] = await db
        .select({ providerId: siteResourceAiProviders.providerId })
        .from(siteResourceAiProviders)
        .where(
            and(
                eq(
                    siteResourceAiProviders.siteResourceId,
                    siteResource.siteResourceId
                ),
                eq(siteResourceAiProviders.accessMode, "select")
            )
        )
        .limit(1);

    if (!row) {
        return "Set at least one attached AI provider to select mode before managing model lists";
    }
    return null;
}

/**
 * Resource model entries must belong to select-mode attached providers, and
 * listType must match the provider catalog entry (allow→allow, block→block).
 */
export async function assertPublicResourceModelEntriesValid(input: {
    orgId: string;
    resourceId: number;
    models: ResourceAiModelEntry[];
}): Promise<string | null> {
    const uniqueModels = dedupeModelEntries(input.models);
    if (uniqueModels.length === 0) {
        return null;
    }

    const attachments = await db
        .select({
            providerId: resourceAiProviders.providerId,
            accessMode: resourceAiProviders.accessMode,
            enabled: resourceAiProviders.enabled
        })
        .from(resourceAiProviders)
        .innerJoin(
            aiProviders,
            eq(resourceAiProviders.providerId, aiProviders.providerId)
        )
        .where(
            and(
                eq(resourceAiProviders.resourceId, input.resourceId),
                eq(aiProviders.orgId, input.orgId)
            )
        );

    return assertModelEntriesValid({
        orgId: input.orgId,
        modelEntries: uniqueModels,
        attachments,
        resourceLabel: "resource"
    });
}

export async function assertSiteResourceModelEntriesValid(input: {
    orgId: string;
    siteResourceId: number;
    models: ResourceAiModelEntry[];
}): Promise<string | null> {
    const uniqueModels = dedupeModelEntries(input.models);
    if (uniqueModels.length === 0) {
        return null;
    }

    const attachments = await db
        .select({
            providerId: siteResourceAiProviders.providerId,
            accessMode: siteResourceAiProviders.accessMode,
            enabled: siteResourceAiProviders.enabled
        })
        .from(siteResourceAiProviders)
        .innerJoin(
            aiProviders,
            eq(siteResourceAiProviders.providerId, aiProviders.providerId)
        )
        .where(
            and(
                eq(
                    siteResourceAiProviders.siteResourceId,
                    input.siteResourceId
                ),
                eq(aiProviders.orgId, input.orgId)
            )
        );

    return assertModelEntriesValid({
        orgId: input.orgId,
        modelEntries: uniqueModels,
        attachments,
        resourceLabel: "site resource"
    });
}

function dedupeModelEntries(
    models: ResourceAiModelEntry[]
): ResourceAiModelEntry[] {
    const byModelId = new Map(
        models.map((m) => [m.modelId, m.listType] as const)
    );
    return [...byModelId.entries()].map(([modelId, listType]) => ({
        modelId,
        listType
    }));
}

async function assertModelEntriesValid(input: {
    orgId: string;
    modelEntries: ResourceAiModelEntry[];
    attachments: ResourceAiProviderAttachment[];
    resourceLabel: string;
}): Promise<string | null> {
    const selectProviderIds = input.attachments
        .filter((a) => a.accessMode === "select")
        .map((a) => a.providerId);

    if (selectProviderIds.length === 0) {
        return "Set at least one attached AI provider to select mode before managing model lists";
    }

    const modelIds = input.modelEntries.map((m) => m.modelId);
    const catalogRows = await db
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
                inArray(aiModels.providerId, selectProviderIds),
                eq(aiProviders.orgId, input.orgId)
            )
        );

    if (catalogRows.length !== modelIds.length) {
        return `One or more model IDs do not exist or do not belong to a select-mode provider on this ${input.resourceLabel}`;
    }

    const catalogById = new Map(catalogRows.map((row) => [row.modelId, row]));
    for (const entry of input.modelEntries) {
        const catalog = catalogById.get(entry.modelId);
        if (!catalog) {
            return `One or more model IDs do not exist or do not belong to a select-mode provider on this ${input.resourceLabel}`;
        }
        if (catalog.listType !== entry.listType) {
            return `Model ${entry.modelId} must use listType "${catalog.listType}" to match the provider catalog entry`;
        }
        if (!catalog.enabled) {
            return `Model ${entry.modelId} is disabled on its provider`;
        }
    }

    return null;
}
