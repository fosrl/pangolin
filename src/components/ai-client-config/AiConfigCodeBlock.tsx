"use client";

import CopyTextBox from "@app/components/CopyTextBox";
import { Alert, AlertDescription } from "@app/components/ui/alert";
import {
    aiConfigBlockHasPlaceholders,
    type AiConfigBlock
} from "@app/lib/aiClientConfig";
import { cn } from "@app/lib/cn";
import { AlertCircle } from "lucide-react";
import { useTranslations } from "next-intl";

type AiConfigCodeBlockProps = {
    block: AiConfigBlock;
    step?: number;
    hideLabel?: boolean;
};

export function AiConfigCodeBlock({
    block,
    step,
    hideLabel = false
}: AiConfigCodeBlockProps) {
    const t = useTranslations();
    const label =
        step != null
            ? `${t("aiClientConfigStep", { number: step })}: ${block.label}`
            : block.label;

    return (
        <div className="min-w-0 space-y-1.5">
            {!hideLabel ? (
                <p className="font-mono text-xs text-muted-foreground">
                    {label}
                </p>
            ) : null}
            <div
                className={cn(
                    "min-w-0",
                    block.kind !== "steps" && "[&_code]:font-mono"
                )}
            >
                {aiConfigBlockHasPlaceholders(block) ? (
                    <Alert variant="neutral" className="mb-3">
                        <AlertCircle className="h-4 w-4" />
                        <AlertDescription>
                            {t("aiClientConfigPlaceholderWarning")}
                        </AlertDescription>
                    </Alert>
                ) : null}
                <CopyTextBox
                    text={block.displayText}
                    wrapText={block.kind === "steps"}
                />
            </div>
        </div>
    );
}
