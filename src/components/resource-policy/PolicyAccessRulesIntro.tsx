"use client";

import { SwitchInput } from "@app/components/SwitchInput";
import { useTranslations } from "next-intl";

export type PolicyAccessRulesIntroProps = {
    rulesEnabled: boolean;
    onRulesEnabledChange: (enabled: boolean) => void;
    disableToggle?: boolean;
};

export function PolicyAccessRulesIntro({
    rulesEnabled,
    onRulesEnabledChange,
    disableToggle
}: PolicyAccessRulesIntroProps) {
    const t = useTranslations();

    return (
        <SwitchInput
            id="rules-toggle"
            label={t("rulesEnable")}
            description={t("policyAccessRulesEnableDescription")}
            checked={rulesEnabled}
            disabled={disableToggle}
            onCheckedChange={onRulesEnabledChange}
        />
    );
}
