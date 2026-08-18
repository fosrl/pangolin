"use client";

import { AiConfigCodeBlock } from "@app/components/ai-client-config/AiConfigCodeBlock";
import {
    Collapsible,
    CollapsibleContent,
    CollapsibleTrigger
} from "@app/components/ui/collapsible";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue
} from "@app/components/ui/select";
import {
    Tabs,
    TabsContent,
    TabsList,
    TabsTrigger
} from "@app/components/ui/tabs";
import type { AiClientGuide, AiClientPresetId } from "@app/lib/aiClientConfig";
import { cn } from "@app/lib/cn";
import { ChevronDown, type LucideIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";

type AiClientConfigCardProps = {
    guide: AiClientGuide;
    description: string;
    icon: LucideIcon;
    defaultOpen?: boolean;
};

export function AiClientConfigCard({
    guide,
    description,
    icon: Icon,
    defaultOpen = false
}: AiClientConfigCardProps) {
    const t = useTranslations();
    const [open, setOpen] = useState(defaultOpen);
    const [presetId, setPresetId] = useState<AiClientPresetId>(
        guide.presets[0]?.id ?? "default"
    );

    const preset =
        guide.presets.find((p) => p.id === presetId) ?? guide.presets[0];

    const manualContent = (
        <div className="space-y-4">
            {guide.presets.length > 1 ? (
                <Select
                    value={presetId}
                    onValueChange={(value) =>
                        setPresetId(value as AiClientPresetId)
                    }
                >
                    <SelectTrigger size="sm" className="max-w-xs">
                        <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                        {guide.presets.map((p) => (
                            <SelectItem key={p.id} value={p.id}>
                                {p.label}
                            </SelectItem>
                        ))}
                    </SelectContent>
                </Select>
            ) : null}
            <div className="grid gap-4 @lg:grid-cols-2">
                {preset?.blocks.map((block) => (
                    <AiConfigCodeBlock key={block.id} block={block} />
                ))}
            </div>
        </div>
    );

    return (
        <Collapsible
            open={open}
            onOpenChange={setOpen}
            className="rounded-md border bg-card"
        >
            <CollapsibleTrigger className="flex w-full items-center gap-3 px-4 py-3 text-left cursor-pointer">
                <Icon className="size-4 shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                    <p className="font-medium truncate">{guide.name}</p>
                    <p className="text-xs text-muted-foreground truncate">
                        {description}
                    </p>
                </div>
                <ChevronDown
                    className={cn(
                        "size-4 shrink-0 text-muted-foreground transition-transform",
                        open && "rotate-180"
                    )}
                />
            </CollapsibleTrigger>
            <CollapsibleContent className="border-t px-4 py-4">
                {guide.cli ? (
                    <Tabs defaultValue="cli">
                        <TabsList>
                            <TabsTrigger value="cli">
                                {t("aiClientConfigTabCli")}
                            </TabsTrigger>
                            <TabsTrigger value="manual">
                                {t("aiClientConfigTabManual")}
                            </TabsTrigger>
                        </TabsList>
                        <TabsContent
                            value="cli"
                            className="grid gap-4 @lg:grid-cols-2 mt-4"
                        >
                            <AiConfigCodeBlock block={guide.cli.configure} />
                            <AiConfigCodeBlock block={guide.cli.run} />
                            {guide.cli.configureWithKey ? (
                                <AiConfigCodeBlock
                                    block={guide.cli.configureWithKey}
                                />
                            ) : null}
                            {guide.cli.runWithKey ? (
                                <AiConfigCodeBlock
                                    block={guide.cli.runWithKey}
                                />
                            ) : null}
                        </TabsContent>
                        <TabsContent value="manual" className="mt-4">
                            {manualContent}
                        </TabsContent>
                    </Tabs>
                ) : (
                    manualContent
                )}
            </CollapsibleContent>
        </Collapsible>
    );
}
