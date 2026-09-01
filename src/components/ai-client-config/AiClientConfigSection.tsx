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
    /**
     * The resource's niceId, when known, so the displayed CLI commands can
     * include `--resource <niceId>` and let `pangolin configure` skip its
     * own resource picker.
     */
    resourceNiceId?: string;
};

// Each logo file is named for its own color, not the theme it belongs on, so
// the light-colored "-light" asset is what we show in dark mode and vice versa.
const CLIENT_LOGOS = {
    claude: {
        light: "/third-party/claude-dark.svg",
        dark: "/third-party/claude-light.svg"
    },
    codex: {
        light: "/third-party/openai-dark.svg",
        dark: "/third-party/openai-light.svg"
    },
    opencode: {
        light: "/third-party/opencode-dark.svg",
        dark: "/third-party/opencode-light.svg"
    },
    gemini: {
        light: "/third-party/gemini-dark.svg",
        dark: "/third-party/gemini-light.svg"
    }
} as const;

export function AiClientConfigSection({
    endpoint,
    auth,
    layout = "compact",
    className,
    resourceNiceId
}: AiClientConfigSectionProps) {
    const t = useTranslations();
    const isWide = layout === "wide";

    const descriptions: Record<string, string> = {
        claude: t("aiClientConfigDescriptionClaude"),
        codex: t("aiClientConfigDescriptionCodex"),
        opencode: t("aiClientConfigDescriptionOpencode"),
        gemini: t("aiClientConfigDescriptionGemini")
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
                            "grid min-w-0 items-start gap-3",
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
                                iconSrc={CLIENT_LOGOS[clientId]}
                                resourceNiceId={resourceNiceId}
                            />
                        ))}
                    </div>
                </div>
            </SettingsSectionBody>
        </SettingsSection>
    );
}
