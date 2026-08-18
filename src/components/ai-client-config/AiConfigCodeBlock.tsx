"use client";

import CopyTextBox from "@app/components/CopyTextBox";
import type { AiConfigBlock } from "@app/lib/aiClientConfig";

export function AiConfigCodeBlock({ block }: { block: AiConfigBlock }) {
    return (
        <div className="space-y-1.5">
            <p className="font-mono text-xs text-muted-foreground">
                {block.label}
            </p>
            <div
                className={
                    block.kind === "steps"
                        ? "[&_pre]:text-sm"
                        : "[&_pre]:text-xs [&_code]:font-mono"
                }
            >
                <CopyTextBox
                    text={block.displayText}
                    getCopyText={block.getCopyText}
                    wrapText={block.kind === "steps"}
                />
            </div>
        </div>
    );
}
