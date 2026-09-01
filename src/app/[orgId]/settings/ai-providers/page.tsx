import AiProvidersBanner from "@app/components/AiProvidersBanner";
import AiProvidersTable from "@app/components/AiProvidersTable";
import SettingsSectionTitle from "@app/components/SettingsSectionTitle";
import { internal } from "@app/lib/api";
import { authCookieHeader } from "@app/lib/api/cookies";
import type { ListAiProvidersResponse } from "@server/routers/aiProvider/types";
import type { AxiosResponse } from "axios";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";

export const metadata: Metadata = {
    title: "AI Providers"
};

export const dynamic = "force-dynamic";

type Props = {
    params: Promise<{ orgId: string }>;
    searchParams: Promise<Record<string, string>>;
};

export default async function AiProvidersPage({ params, searchParams }: Props) {
    const { orgId } = await params;
    const searchParamsObj = new URLSearchParams(await searchParams);
    const t = await getTranslations();

    let providers: ListAiProvidersResponse["providers"] = [];
    let pagination: ListAiProvidersResponse["pagination"] = {
        total: 0,
        page: 1,
        pageSize: 20
    };

    try {
        const res = await internal.get<AxiosResponse<ListAiProvidersResponse>>(
            `/org/${orgId}/ai-providers?${searchParamsObj.toString()}`,
            await authCookieHeader()
        );
        const responseData = res.data.data;
        providers = responseData.providers;
        pagination = responseData.pagination;
    } catch {
        // empty list on error
    }

    return (
        <>
            <SettingsSectionTitle
                title={t("aiProvidersTitle")}
                description={t("aiProvidersDescription")}
            />

            <AiProvidersBanner />

            <AiProvidersTable
                orgId={orgId}
                providers={providers.map((provider) => ({
                    providerId: provider.providerId,
                    niceId: provider.niceId,
                    name: provider.name,
                    type: provider.type,
                    routingMode: provider.routingMode,
                    enabled: provider.enabled,
                    effectiveUpstreamUrl: provider.effectiveUpstreamUrl,
                    apiKeyLastChars: provider.apiKeyLastChars
                }))}
                rowCount={pagination.total}
                pagination={{
                    pageIndex: pagination.page - 1,
                    pageSize: pagination.pageSize
                }}
            />
        </>
    );
}
