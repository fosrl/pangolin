"use client";

import { AiClientConfigCard } from "@app/components/ai-client-config/AiClientConfigCard";
import {
    SettingsSection,
    SettingsSectionBody,
    SettingsSectionDescription,
    SettingsSectionHeader,
    SettingsSectionTitle
} from "@app/components/Settings";
import {
    AI_CLIENT_IDS,
    AI_CLIENT_NAMES,
    type AiClientAuthInput
} from "@app/lib/aiClientConfig";
import { cn } from "@app/lib/cn";
import { MousePointerClick, Sparkles, SquareTerminal, TerminalSquare } from "lucide-react";
import { useTranslations } from "next-intl";

type AiClientConfigSectionProps = {
    endpoint: string;
    auth: AiClientAuthInput;
    /**
     * "wide" lays the client cards out side by side once there's room
     * (e.g. the Keys page). "compact" always stacks them, which is what
     * fits the Resource Launcher's side panel. A card's own code blocks
     * always stack regardless of this setting.
     */
    layout?: "wide" | "compact";
    className?: string;
};

const CLIENT_ICONS = {
    claude: Sparkles,
    codex: TerminalSquare,
    opencode: SquareTerminal,
    cursor: MousePointerClick
} as const;

export function AiClientConfigSection({
    endpoint,
    auth,
    layout = "compact",
    className
}: AiClientConfigSectionProps) {
    const t = useTranslations();
    const isWide = layout === "wide";

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
                <div className={cn("@container min-w-0", className)}>
                    <div
                        className={cn(
                            "grid min-w-0 gap-3",
                            isWide && "@3xl:grid-cols-2"
                        )}
                    >
                        {AI_CLIENT_IDS.map((clientId) => (
                            <AiClientConfigCard
                                key={clientId}
                                clientId={clientId}
                                name={AI_CLIENT_NAMES[clientId]}
                                endpoint={endpoint}
                                keyAuth={auth}
                                description={descriptions[clientId]}
                                icon={CLIENT_ICONS[clientId]}
                            />
                        ))}
                    </div>
                </div>
            </SettingsSectionBody>
        </SettingsSection>
    );
}
