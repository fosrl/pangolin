"use client";

import { AiClientConfigCard } from "@app/components/ai-client-config/AiClientConfigCard";
import {
    SettingsSection,
    SettingsSectionBody,
    SettingsSectionDescription,
    SettingsSectionHeader,
    SettingsSectionTitle
} from "@app/components/Settings";
import type { AiClientAuth } from "@app/lib/aiClientConfig";
import { buildAiClientGuides } from "@app/lib/aiClientConfig";
import { cn } from "@app/lib/cn";
import { MousePointerClick, Sparkles, SquareTerminal, TerminalSquare } from "lucide-react";
import { useTranslations } from "next-intl";
import { useMemo } from "react";

type AiClientConfigSectionProps = {
    endpoint: string;
    auth: AiClientAuth;
    className?: string;
};

export function AiClientConfigSection({
    endpoint,
    auth,
    className
}: AiClientConfigSectionProps) {
    const t = useTranslations();

    const guides = useMemo(
        () => buildAiClientGuides(endpoint, auth),
        [endpoint, auth]
    );

    const icons = {
        claude: Sparkles,
        codex: TerminalSquare,
        opencode: SquareTerminal,
        cursor: MousePointerClick
    } as const;

    const descriptions: Record<string, string> = {
        claude: t("aiClientConfigDescriptionClaude"),
        codex: t("aiClientConfigDescriptionCodex"),
        opencode: t("aiClientConfigDescriptionOpencode"),
        cursor: t("aiClientConfigDescriptionCursor")
    };

    return (
        <SettingsSection>
            <SettingsSectionHeader>
                <SettingsSectionTitle>
                    {t("aiClientConfigTitle")}
                </SettingsSectionTitle>
                <SettingsSectionDescription>
                    {t("aiClientConfigDescription")}
                </SettingsSectionDescription>
            </SettingsSectionHeader>
            <SettingsSectionBody>
                <div
                    className={cn("@container space-y-3", className)}
                >
                    {guides.map((guide, index) => (
                        <AiClientConfigCard
                            key={guide.id}
                            guide={guide}
                            description={descriptions[guide.id]}
                            icon={icons[guide.id]}
                            defaultOpen={index === 0}
                        />
                    ))}
                </div>
            </SettingsSectionBody>
        </SettingsSection>
    );
}
