"use client";

import { SettingsContainer } from "@app/components/Settings";
import { BudgetsEditor } from "@app/components/BudgetsEditor";
import { useResourceContext } from "@app/hooks/useResourceContext";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useEffect } from "react";

export default function PublicResourceBudgetPage() {
    const { resource } = useResourceContext();
    const router = useRouter();
    const t = useTranslations();

    useEffect(() => {
        if (resource.mode !== "inference") {
            router.replace(
                `/${resource.orgId}/settings/resources/public/${resource.niceId}/general`
            );
        }
    }, [router, resource.mode, resource.niceId, resource.orgId]);

    if (resource.mode !== "inference") {
        return null;
    }

    return (
        <SettingsContainer>
            <BudgetsEditor
                orgId={resource.orgId}
                scope={{ type: "resource", id: resource.resourceId }}
                title={t("resourceBudgetSettings")}
                description={t("resourceBudgetSettingsDescription")}
            />
        </SettingsContainer>
    );
}
