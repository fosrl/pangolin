"use client";

import { SettingsContainer } from "@app/components/Settings";
import { BudgetsEditor } from "@app/components/BudgetsEditor";
import { useAiProviderContext } from "@app/hooks/useAiProviderContext";
import { useTranslations } from "next-intl";

export default function AiProviderBudgetPage() {
    const { provider } = useAiProviderContext();
    const t = useTranslations();

    return (
        <SettingsContainer>
            <BudgetsEditor
                orgId={provider.orgId}
                scope={{ type: "provider", id: provider.providerId }}
                title={t("aiProviderBudgetSettings")}
                description={t("aiProviderBudgetSettingsDescription")}
            />
        </SettingsContainer>
    );
}
