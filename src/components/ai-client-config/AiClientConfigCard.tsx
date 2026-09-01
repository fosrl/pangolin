"use client";

import { AiConfigBlocks } from "@app/components/ai-client-config/AiConfigBlocks";
import { Button } from "@app/components/ui/button";
import {
    Collapsible,
    CollapsibleContent,
    CollapsibleTrigger
} from "@app/components/ui/collapsible";
import { OptionSelect } from "@app/components/OptionSelect";
import type {
    AiClientAuthInput,
    AiClientId,
    AiClientPresetId
} from "@app/lib/aiClientConfig";
import { buildAiClientGuide } from "@app/lib/aiClientConfig";
import { cn } from "@app/lib/cn";
import { ChevronDown, Loader2 } from "lucide-react";
import { useTheme } from "next-themes";
import Image from "next/image";
import { useTranslations } from "next-intl";
import { useEffect, useMemo, useState } from "react";

type AiClientConfigCardProps = {
    clientId: AiClientId;
    name: string;
    endpoint: string;
    keyAuth: AiClientAuthInput;
    description: string;
    iconSrc: { light: string; dark: string };
    resourceNiceId?: string;
};

type SetupMode = "cli" | "manual";

export function AiClientConfigCard({
    clientId,
    name,
    endpoint,
    keyAuth,
    description,
    iconSrc,
    resourceNiceId
}: AiClientConfigCardProps) {
    const t = useTranslations();
    const { theme } = useTheme();
    const [resolvedIconSrc, setResolvedIconSrc] = useState(iconSrc.light);
    const [open, setOpen] = useState(false);
    const [presetId, setPresetId] = useState<AiClientPresetId>("default");
    const [setupMode, setSetupMode] = useState<SetupMode>("cli");
    const [revealedKey, setRevealedKey] = useState<string | null>(null);
    const [revealing, setRevealing] = useState(false);
    const [revealError, setRevealError] = useState(false);

    useEffect(() => {
        let lightOrDark = theme;
        if (theme === "system" || !theme) {
            lightOrDark = window.matchMedia("(prefers-color-scheme: dark)")
                .matches
                ? "dark"
                : "light";
        }
        setResolvedIconSrc(
            lightOrDark === "dark" ? iconSrc.dark : iconSrc.light
        );
    }, [theme, iconSrc]);

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
            return buildAiClientGuide(
                clientId,
                endpoint,
                { mode: "keyless" },
                resourceNiceId
            );
        }
        if (revealedKey === null) {
            return null;
        }
        return buildAiClientGuide(
            clientId,
            endpoint,
            { mode: "keyed", key: revealedKey },
            resourceNiceId
        );
    }, [clientId, endpoint, keyAuth.mode, revealedKey, resourceNiceId]);

    const preset =
        guide?.presets.find((p) => p.id === presetId) ?? guide?.presets[0];

    const manualContent = guide ? (
        <div className="min-w-0 space-y-4">
            {guide.presets.length > 1 ? (
                <OptionSelect<AiClientPresetId>
                    label={t("aiClientConfigPreset")}
                    options={guide.presets.map((p) => ({
                        value: p.id,
                        label: p.label
                    }))}
                    value={preset?.id ?? presetId}
                    onChange={setPresetId}
                    cols={2}
                />
            ) : null}
            {preset ? (
                <AiConfigBlocks
                    key={preset.id}
                    blocks={preset.blocks}
                    relation={preset.relation}
                />
            ) : null}
        </div>
    ) : null;

    return (
        <Collapsible
            open={open}
            onOpenChange={handleOpenChange}
            className="min-w-0 rounded-md border bg-card"
        >
            <CollapsibleTrigger className="flex w-full items-center gap-3 px-4 py-3 text-left cursor-pointer">
                <Image
                    src={resolvedIconSrc}
                    alt={name}
                    width={16}
                    height={16}
                    className="size-4 shrink-0 object-contain"
                />
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
                        <div className="min-w-0 space-y-4">
                            <OptionSelect<SetupMode>
                                label={t("aiClientConfigSetup")}
                                options={[
                                    {
                                        value: "cli",
                                        label: t("aiClientConfigTabCli")
                                    },
                                    {
                                        value: "manual",
                                        label: t("aiClientConfigTabManual")
                                    }
                                ]}
                                value={setupMode}
                                onChange={setSetupMode}
                                cols={2}
                            />
                            {setupMode === "cli" ? (
                                <AiConfigBlocks
                                    blocks={guide.cli}
                                    relation="options"
                                />
                            ) : (
                                manualContent
                            )}
                        </div>
                    ) : (
                        manualContent
                    )
                ) : null}
            </CollapsibleContent>
        </Collapsible>
    );
}
