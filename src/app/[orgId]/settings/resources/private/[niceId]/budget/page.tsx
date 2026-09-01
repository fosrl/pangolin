"use client";

import { SettingsContainer } from "@app/components/Settings";
import { BudgetsEditor } from "@app/components/BudgetsEditor";
import { useSiteResourceContext } from "@app/hooks/useSiteResourceContext";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useEffect } from "react";

export default function PrivateResourceBudgetPage() {
    const { siteResource } = useSiteResourceContext();
    const router = useRouter();
    const t = useTranslations();

    useEffect(() => {
        if (siteResource.mode !== "inference") {
            router.replace(
                `/${siteResource.orgId}/settings/resources/private/${siteResource.niceId}/general`
            );
        }
    }, [
        router,
        siteResource.mode,
        siteResource.niceId,
        siteResource.orgId
    ]);

    if (siteResource.mode !== "inference") {
        return null;
    }

    return (
        <SettingsContainer>
            <BudgetsEditor
                orgId={siteResource.orgId}
                scope={{ type: "siteResource", id: siteResource.id }}
                title={t("resourceBudgetSettings")}
                description={t("resourceBudgetSettingsDescription")}
            />
        </SettingsContainer>
    );
}
