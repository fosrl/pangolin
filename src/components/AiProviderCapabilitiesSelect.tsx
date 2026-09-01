"use client";

import { MultiSelectTagInput } from "@app/components/multi-select/multi-select-tag-input";
import { AI_CAPABILITIES, type AiCapability } from "@app/lib/aiCapabilities";
import { useTranslations } from "next-intl";
import { useMemo, useState } from "react";

export type CapabilityOption = {
    id: string;
    text: string;
};

export type AiProviderCapabilitiesSelectProps = {
    value: AiCapability[];
    onChange: (capabilities: AiCapability[]) => void;
    disabled?: boolean;
};

const CAPABILITY_LABEL_KEYS: Record<AiCapability, string> = {
    openai_chat: "aiCapabilityOpenaiChat",
    openai_responses: "aiCapabilityOpenaiResponses",
    anthropic_messages: "aiCapabilityAnthropicMessages",
    v1_models: "aiCapabilityV1Models",
    gemini_generate_content: "aiCapabilityGeminiGenerateContent",
    bedrock_model_invoke: "aiCapabilityBedrockModelInvoke",
    google_generate_content: "aiCapabilityGoogleGenerateContent",
    google_raw_predict: "aiCapabilityGoogleRawPredict",
    bedrock_converse: "aiCapabilityBedrockConverse"
};

export function capabilityLabelKey(capability: AiCapability): string {
    return CAPABILITY_LABEL_KEYS[capability];
}

export function AiProviderCapabilitiesSelect({
    value,
    onChange,
    disabled
}: AiProviderCapabilitiesSelectProps) {
    const t = useTranslations();
    const [searchQuery, setSearchQuery] = useState("");

    const options: CapabilityOption[] = useMemo(
        () =>
            AI_CAPABILITIES.map((id) => ({
                id,
                text: t(CAPABILITY_LABEL_KEYS[id])
            })),
        [t]
    );

    const filtered = useMemo(() => {
        const q = searchQuery.trim().toLowerCase();
        if (!q) {
            return options;
        }
        return options.filter(
            (o) =>
                o.text.toLowerCase().includes(q) ||
                o.id.toLowerCase().includes(q)
        );
    }, [options, searchQuery]);

    const selected: CapabilityOption[] = value.map((id) => ({
        id,
        text: t(CAPABILITY_LABEL_KEYS[id])
    }));

    return (
        <MultiSelectTagInput
            buttonText={t("aiProviderCapabilitiesSelect")}
            emptyPlaceholder={t("aiProviderCapabilitiesEmpty")}
            searchPlaceholder={t("aiProviderCapabilitiesSearch")}
            searchQuery={searchQuery}
            options={filtered}
            value={selected}
            onChange={(next) =>
                onChange(
                    next
                        .map((item) => item.id)
                        .filter((id): id is AiCapability =>
                            (AI_CAPABILITIES as readonly string[]).includes(id)
                        )
                )
            }
            onSearch={setSearchQuery}
            disabled={disabled}
        />
    );
}
