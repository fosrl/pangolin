"use client";

import {
    SettingsContainer,
    SettingsSection,
    SettingsSectionBody,
    SettingsSectionDescription,
    SettingsSectionFooter,
    SettingsSectionForm,
    SettingsSectionHeader,
    SettingsSectionTitle
} from "@app/components/Settings";
import {
    persistPendingModelBudgets,
    type AiProviderModelListItem,
    type ModelListType
} from "@app/components/AiProviderModelListEditor";
import { AiProviderModelsLists } from "@app/components/AiProviderModelsLists";
import { Button } from "@app/components/ui/button";
import { useAiProviderContext } from "@app/hooks/useAiProviderContext";
import { useEnvContext } from "@app/hooks/useEnvContext";
import { toast } from "@app/hooks/useToast";
import { createApiClient, formatAxiosError } from "@app/lib/api";
import { aiProviderQueries } from "@app/lib/queries";
import type { CreateOrEditAiModelResponse } from "@server/routers/aiProvider/types";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { AxiosResponse } from "axios";
import { useTranslations } from "next-intl";
import { useEffect, useMemo, useState } from "react";

function toListItem(
    model: {
        modelId: number;
        modelKey: string;
        listType?: ModelListType | null;
    },
    listType: ModelListType
): AiProviderModelListItem {
    return {
        clientId: String(model.modelId),
        modelId: model.modelId,
        modelKey: model.modelKey,
        listType,
        hasBudget: false
    };
}

export default function AiProviderModelsPage() {
    const { provider } = useAiProviderContext();
    const { env } = useEnvContext();
    const api = createApiClient({ env });
    const queryClient = useQueryClient();
    const t = useTranslations();
    const [saveLoading, setSaveLoading] = useState(false);
    const [allowItems, setAllowItems] = useState<AiProviderModelListItem[]>([]);
    const [blockItems, setBlockItems] = useState<AiProviderModelListItem[]>([]);

    const modelsQuery = useQuery(
        aiProviderQueries.providerModels({ providerId: provider.providerId })
    );
    const catalogQuery = useQuery(
        aiProviderQueries.catalogModels({ providerId: provider.providerId })
    );

    const catalogModels = useMemo(
        () => (catalogQuery.data ?? []).map((entry) => entry.model),
        [catalogQuery.data]
    );

    useEffect(() => {
        if (!modelsQuery.data) return;
        setAllowItems(
            modelsQuery.data
                .filter((model) => (model.listType ?? "allow") === "allow")
                .map((model) => toListItem(model, "allow"))
        );
        setBlockItems(
            modelsQuery.data
                .filter((model) => model.listType === "block")
                .map((model) => toListItem(model, "block"))
        );
    }, [modelsQuery.data]);

    async function onSave() {
        setSaveLoading(true);
        try {
            const existing = modelsQuery.data ?? [];
            const existingById = new Map(
                existing.map((model) => [model.modelId, model])
            );
            const existingByKey = new Map(
                existing.map((model) => [model.modelKey, model])
            );

            const desiredItems = [...allowItems, ...blockItems].map((item) => ({
                ...item,
                modelKey: item.modelKey.trim()
            }));

            const nextAllow = new Set(
                allowItems.map((item) => item.modelKey.trim()).filter(Boolean)
            );
            const nextBlock = new Set(
                blockItems.map((item) => item.modelKey.trim()).filter(Boolean)
            );

            const overlap = [...nextAllow].filter((key) => nextBlock.has(key));
            if (overlap.length > 0) {
                toast({
                    variant: "destructive",
                    title: t("aiProviderModelsErrorUpdate"),
                    description: t("aiProviderModelsOverlapError", {
                        keys: overlap.join(", ")
                    })
                });
                return;
            }

            const toCreate: AiProviderModelListItem[] = [];
            const toUpdate: {
                modelId: number;
                modelKey: string;
                listType: ModelListType;
            }[] = [];
            const retainedIds = new Set<number>();

            for (const item of desiredItems) {
                const listType = item.listType;
                const modelKey = item.modelKey;
                if (!modelKey) continue;

                if (item.modelId != null && existingById.has(item.modelId)) {
                    retainedIds.add(item.modelId);
                    const existingModel = existingById.get(item.modelId)!;
                    if (
                        existingModel.modelKey !== modelKey ||
                        (existingModel.listType ?? "allow") !== listType
                    ) {
                        toUpdate.push({
                            modelId: item.modelId,
                            modelKey,
                            listType
                        });
                    }
                    continue;
                }

                const existingBySameKey = existingByKey.get(modelKey);
                if (
                    existingBySameKey &&
                    !retainedIds.has(existingBySameKey.modelId)
                ) {
                    retainedIds.add(existingBySameKey.modelId);
                    if ((existingBySameKey.listType ?? "allow") !== listType) {
                        toUpdate.push({
                            modelId: existingBySameKey.modelId,
                            modelKey,
                            listType
                        });
                    }
                    continue;
                }

                toCreate.push(item);
            }

            const toDelete = existing
                .filter((model) => !retainedIds.has(model.modelId))
                .map((model) => model.modelId);

            await Promise.all([
                ...toCreate.map(async (item) => {
                    const res = await api.put<
                        AxiosResponse<CreateOrEditAiModelResponse>
                    >(`/ai-provider/${provider.providerId}/model`, {
                        modelKey: item.modelKey,
                        name: item.modelKey,
                        listType: item.listType
                    });
                    await persistPendingModelBudgets({
                        api,
                        orgId: provider.orgId,
                        modelId: res.data.data.model.modelId,
                        pendingBudgets: item.pendingBudgets
                    });
                }),
                ...toUpdate.map(({ modelId, modelKey, listType }) =>
                    api.post(`/ai-model/${modelId}`, {
                        modelKey,
                        name: modelKey,
                        listType
                    })
                ),
                ...toDelete.map((modelId) => api.delete(`/ai-model/${modelId}`))
            ]);

            await queryClient.invalidateQueries(
                aiProviderQueries.providerModels({
                    providerId: provider.providerId
                })
            );

            toast({
                title: t("success"),
                description: t("aiProviderModelsUpdated")
            });
        } catch (e) {
            toast({
                variant: "destructive",
                title: t("aiProviderModelsErrorUpdate"),
                description: formatAxiosError(
                    e,
                    t("aiProviderModelsErrorUpdate")
                )
            });
        } finally {
            setSaveLoading(false);
        }
    }

    return (
        <SettingsContainer>
            <SettingsSection>
                <SettingsSectionHeader>
                    <SettingsSectionTitle>
                        {t("aiProviderModels")}
                    </SettingsSectionTitle>
                    <SettingsSectionDescription>
                        {t("aiProviderModelsDescription")}
                    </SettingsSectionDescription>
                </SettingsSectionHeader>

                <SettingsSectionBody>
                    <SettingsSectionForm>
                        <AiProviderModelsLists
                            orgId={provider.orgId}
                            allowItems={allowItems}
                            onAllowChange={setAllowItems}
                            blockItems={blockItems}
                            onBlockChange={setBlockItems}
                            catalogModels={catalogModels}
                            disabled={modelsQuery.isLoading}
                        />
                    </SettingsSectionForm>
                </SettingsSectionBody>

                <SettingsSectionFooter>
                    <Button
                        type="button"
                        loading={saveLoading}
                        disabled={saveLoading || modelsQuery.isLoading}
                        onClick={onSave}
                    >
                        {t("saveSettings")}
                    </Button>
                </SettingsSectionFooter>
            </SettingsSection>
        </SettingsContainer>
    );
}
