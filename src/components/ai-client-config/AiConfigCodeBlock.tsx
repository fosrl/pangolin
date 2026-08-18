"use client";

import CopyTextBox from "@app/components/CopyTextBox";
import type { AiConfigBlock } from "@app/lib/aiClientConfig";
import { cn } from "@app/lib/cn";

export function AiConfigCodeBlock({ block }: { block: AiConfigBlock }) {
    return (
        <div className="min-w-0 space-y-1.5">
            <p className="font-mono text-xs text-muted-foreground">
                {block.label}
            </p>
            <div
                className={cn(
                    "min-w-0",
                    block.kind === "steps"
                        ? "[&_pre]:text-sm"
                        : "[&_pre]:text-xs [&_code]:font-mono"
                )}
            >
                <CopyTextBox
                    text={block.displayText}
                    wrapText={block.kind === "steps"}
                />
            </div>
        </div>
    );
}
