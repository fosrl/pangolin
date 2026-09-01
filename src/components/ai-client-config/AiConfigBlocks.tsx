"use client";

import { AiConfigCodeBlock } from "@app/components/ai-client-config/AiConfigCodeBlock";
import {
    OptionSelect,
    type OptionSelectOption
} from "@app/components/OptionSelect";
import type { AiConfigBlock, AiConfigRelation } from "@app/lib/aiClientConfig";
import { useTranslations } from "next-intl";
import { useEffect, useMemo, useState } from "react";

type AiConfigBlocksProps = {
    blocks: AiConfigBlock[];
    relation: AiConfigRelation;
};

export function AiConfigBlocks({ blocks, relation }: AiConfigBlocksProps) {
    const t = useTranslations();
    const showPicker = relation === "options" && blocks.length > 1;
    const [selectedId, setSelectedId] = useState(blocks[0]?.id ?? "");

    const methodOptions: OptionSelectOption<string>[] = useMemo(
        () =>
            blocks.map((block) => ({
                value: block.id,
                label: block.label
            })),
        [blocks]
    );

    useEffect(() => {
        if (!blocks.some((block) => block.id === selectedId)) {
            setSelectedId(blocks[0]?.id ?? "");
        }
    }, [blocks, selectedId]);

    if (blocks.length === 0) {
        return null;
    }

    if (showPicker) {
        const selected =
            blocks.find((block) => block.id === selectedId) ?? blocks[0];

        return (
            <div className="min-w-0 space-y-4">
                <OptionSelect
                    label={t("method")}
                    options={methodOptions}
                    value={selected.id}
                    onChange={setSelectedId}
                    cols={2}
                />
                <AiConfigCodeBlock block={selected} hideLabel />
            </div>
        );
    }

    const numberSteps = relation === "steps" && blocks.length > 1;

    return (
        <div className="grid min-w-0 gap-4">
            {blocks.map((block, index) => (
                <AiConfigCodeBlock
                    key={block.id}
                    block={block}
                    step={numberSteps ? index + 1 : undefined}
                />
            ))}
        </div>
    );
}
