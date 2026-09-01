"use client";

import { aiProviderQueries } from "@app/lib/queries";
import { MultiSelectTagInput } from "@app/components/multi-select/multi-select-tag-input";
import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { useDebounce } from "use-debounce";

export type SelectedAiProvider = {
    id: string;
    text: string;
};

export type AiProvidersSelectorProps = {
    orgId: string;
    selectedProviders?: SelectedAiProvider[];
    onSelectProviders: (providers: SelectedAiProvider[]) => void;
    disabled?: boolean;
    buttonText?: string;
};

export function AiProvidersSelector({
    orgId,
    selectedProviders = [],
    onSelectProviders,
    disabled,
    buttonText
}: AiProvidersSelectorProps) {
    const t = useTranslations();
    const [searchQuery, setSearchQuery] = useState("");
    const [debouncedValue] = useDebounce(searchQuery, 150);

    const { data: providers = [] } = useQuery(
        aiProviderQueries.orgProviders({
            orgId,
            query: debouncedValue || undefined
        })
    );

    const options: SelectedAiProvider[] = providers
        .filter((provider) => provider.enabled)
        .map((provider) => ({
            id: String(provider.providerId),
            text: provider.name
        }));

    return (
        <MultiSelectTagInput
            buttonText={buttonText ?? t("aiResourceProvidersSelect")}
            emptyPlaceholder={t("aiResourceProvidersEmpty")}
            searchPlaceholder={t("aiProvidersSearch")}
            searchQuery={searchQuery}
            options={options}
            value={selectedProviders}
            onChange={onSelectProviders}
            onSearch={setSearchQuery}
            disabled={disabled}
        />
    );
}
