"use client";

import { AiConfigCodeBlock } from "@app/components/ai-client-config/AiConfigCodeBlock";
import { Button } from "@app/components/ui/button";
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
import type {
    AiClientAuthInput,
    AiClientId,
    AiClientPresetId
} from "@app/lib/aiClientConfig";
import { buildAiClientGuide } from "@app/lib/aiClientConfig";
import { cn } from "@app/lib/cn";
import { ChevronDown, Loader2, type LucideIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useMemo, useState } from "react";

type AiClientConfigCardProps = {
    clientId: AiClientId;
    name: string;
    endpoint: string;
    keyAuth: AiClientAuthInput;
    description: string;
    icon: LucideIcon;
};

export function AiClientConfigCard({
    clientId,
    name,
    endpoint,
    keyAuth,
    description,
    icon: Icon
}: AiClientConfigCardProps) {
    const t = useTranslations();
    const [open, setOpen] = useState(false);
    const [presetId, setPresetId] = useState<AiClientPresetId>("default");
    const [revealedKey, setRevealedKey] = useState<string | null>(null);
    const [revealing, setRevealing] = useState(false);
    const [revealError, setRevealError] = useState(false);

    const reveal = () => {
        if (keyAuth.mode !== "keyed" || revealedKey !== null || revealing) {
            return;
        }
        setRevealing(true);
        setRevealError(false);
        keyAuth
            .getKeyText()
            .then(setRevealedKey)
            .catch(() => setRevealError(true))
            .finally(() => setRevealing(false));
    };

    const handleOpenChange = (next: boolean) => {
        setOpen(next);
        if (next) {
            reveal();
        }
    };

    const guide = useMemo(() => {
        if (keyAuth.mode === "keyless") {
            return buildAiClientGuide(clientId, endpoint, { mode: "keyless" });
        }
        if (revealedKey === null) {
            return null;
        }
        return buildAiClientGuide(clientId, endpoint, {
            mode: "keyed",
            key: revealedKey
        });
    }, [clientId, endpoint, keyAuth.mode, revealedKey]);

    const preset =
        guide?.presets.find((p) => p.id === presetId) ?? guide?.presets[0];

    const manualContent = guide ? (
        <div className="min-w-0 space-y-4">
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
            <div className="grid min-w-0 gap-4">
                {preset?.blocks.map((block) => (
                    <AiConfigCodeBlock key={block.id} block={block} />
                ))}
            </div>
        </div>
    ) : null;

    return (
        <Collapsible
            open={open}
            onOpenChange={handleOpenChange}
            className="min-w-0 rounded-md border bg-card"
        >
            <CollapsibleTrigger className="flex w-full items-center gap-3 px-4 py-3 text-left cursor-pointer">
                <Icon className="size-4 shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                    <p className="font-medium truncate">{name}</p>
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
            <CollapsibleContent className="min-w-0 border-t px-4 py-4">
                {!guide && revealing ? (
                    <div className="flex items-center justify-center py-6 text-muted-foreground">
                        <Loader2 className="size-5 animate-spin" />
                    </div>
                ) : null}
                {!guide && revealError ? (
                    <div className="flex flex-col items-center gap-2 py-6 text-center">
                        <p className="text-sm text-muted-foreground">
                            {t("aiClientConfigRevealError")}
                        </p>
                        <Button variant="outline" size="sm" onClick={reveal}>
                            {t("aiClientConfigRevealRetry")}
                        </Button>
                    </div>
                ) : null}
                {guide ? (
                    guide.cli ? (
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
                                className="grid min-w-0 gap-4 mt-4"
                            >
                                <AiConfigCodeBlock
                                    block={guide.cli.configure}
                                />
                                {guide.cli.configureWithKey ? (
                                    <AiConfigCodeBlock
                                        block={guide.cli.configureWithKey}
                                    />
                                ) : null}
                            </TabsContent>
                            <TabsContent
                                value="manual"
                                className="min-w-0 mt-4"
                            >
                                {manualContent}
                            </TabsContent>
                        </Tabs>
                    ) : (
                        manualContent
                    )
                ) : null}
            </CollapsibleContent>
        </Collapsible>
    );
}
