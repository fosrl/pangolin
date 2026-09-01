"use client";

import {
    AiProviderModelListEditor,
    type AiProviderModelListItem
} from "@app/components/AiProviderModelListEditor";
import { Label } from "@app/components/ui/label";
import { useTranslations } from "next-intl";
import { useMemo } from "react";

export type AiProviderModelsListsProps = {
    orgId: string;
    allowItems: AiProviderModelListItem[];
    onAllowChange: (items: AiProviderModelListItem[]) => void;
    blockItems: AiProviderModelListItem[];
    onBlockChange: (items: AiProviderModelListItem[]) => void;
    catalogModels: string[];
    disabled?: boolean;
};

export function AiProviderModelsLists({
    orgId,
    allowItems,
    onAllowChange,
    blockItems,
    onBlockChange,
    catalogModels,
    disabled
}: AiProviderModelsListsProps) {
    const t = useTranslations();

    const allowExcludeKeys = useMemo(
        () => new Set(blockItems.map((item) => item.modelKey)),
        [blockItems]
    );
    const blockExcludeKeys = useMemo(
        () => new Set(allowItems.map((item) => item.modelKey)),
        [allowItems]
    );

    return (
        <div className="space-y-6">
            <div className="space-y-2">
                <Label>{t("aiProviderModelsAllow")}</Label>
                <AiProviderModelListEditor
                    orgId={orgId}
                    listType="allow"
                    items={allowItems}
                    onChange={onAllowChange}
                    catalogModels={catalogModels}
                    excludeKeys={allowExcludeKeys}
                    disabled={disabled}
                    emptyMessage={t("aiProviderModelsAllowEmpty")}
                    addPlaceholder={t("aiProviderModelsAllowPlaceholder")}
                />
                <p className="text-sm text-muted-foreground">
                    {t("aiProviderModelsAllowDescription")}
                </p>
            </div>

            <div className="space-y-2">
                <Label>{t("aiProviderModelsBlock")}</Label>
                <AiProviderModelListEditor
                    orgId={orgId}
                    listType="block"
                    items={blockItems}
                    onChange={onBlockChange}
                    catalogModels={catalogModels}
                    excludeKeys={blockExcludeKeys}
                    disabled={disabled}
                    emptyMessage={t("aiProviderModelsBlockEmpty")}
                    addPlaceholder={t("aiProviderModelsBlockPlaceholder")}
                />
                <p className="text-sm text-muted-foreground">
                    {t("aiProviderModelsBlockDescription")}
                </p>
            </div>
        </div>
    );
}
