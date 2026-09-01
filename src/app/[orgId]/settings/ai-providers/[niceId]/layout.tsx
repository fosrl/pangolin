import { HorizontalTabs } from "@app/components/HorizontalTabs";
import SettingsSectionTitle from "@app/components/SettingsSectionTitle";
import { internal } from "@app/lib/api";
import { authCookieHeader } from "@app/lib/api/cookies";
import OrgProvider from "@app/providers/OrgProvider";
import AiProviderProvider from "@app/providers/AiProviderProvider";
import type { GetOrgResponse } from "@server/routers/org";
import type { GetAiProviderResponse } from "@server/routers/aiProvider/types";
import type { AxiosResponse } from "axios";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { cache } from "react";

export const metadata: Metadata = {
    title: "AI Provider"
};

export const dynamic = "force-dynamic";

type Props = {
    children: React.ReactNode;
    params: Promise<{ orgId: string; niceId: string }>;
};

export default async function AiProviderLayout({ children, params }: Props) {
    const { orgId, niceId } = await params;
    const t = await getTranslations();

    let provider = null;
    try {
        const res = await internal.get<AxiosResponse<GetAiProviderResponse>>(
            `/org/${orgId}/ai-provider/${niceId}`,
            await authCookieHeader()
        );
        provider = res.data.data.provider;
    } catch {
        redirect(`/${orgId}/settings/ai-providers`);
    }

    if (!provider || provider.orgId !== orgId) {
        redirect(`/${orgId}/settings/ai-providers`);
    }

    let org = null;
    try {
        const getOrg = cache(async () =>
            internal.get<AxiosResponse<GetOrgResponse>>(
                `/org/${orgId}`,
                await authCookieHeader()
            )
        );
        const res = await getOrg();
        org = res.data.data;
    } catch {
        redirect(`/${orgId}/settings/ai-providers`);
    }

    if (!org) {
        redirect(`/${orgId}/settings/ai-providers`);
    }

    const navItems = [
        {
            title: t("general"),
            href: "/{orgId}/settings/ai-providers/{niceId}/general"
        },
        {
            title: t("aiProviderNetworkSettings"),
            href: "/{orgId}/settings/ai-providers/{niceId}/network"
        },
        {
            title: t("aiProviderModels"),
            href: "/{orgId}/settings/ai-providers/{niceId}/models"
        },
        {
            title: t("aiProviderAuthSettings"),
            href: "/{orgId}/settings/ai-providers/{niceId}/authentication"
        },
        {
            title: t("aiProviderBudgetSettings"),
            href: "/{orgId}/settings/ai-providers/{niceId}/budget"
        }
    ];

    return (
        <>
            <SettingsSectionTitle
                title={t("aiProviderSetting", {
                    providerName: provider.name
                })}
                description={t("aiProviderSettingDescription")}
            />

            <OrgProvider org={org}>
                <AiProviderProvider provider={provider}>
                    <HorizontalTabs items={navItems}>{children}</HorizontalTabs>
                </AiProviderProvider>
            </OrgProvider>
        </>
    );
}
