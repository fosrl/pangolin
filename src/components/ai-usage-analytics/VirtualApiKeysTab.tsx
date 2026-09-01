"use client";

import { useQuery } from "@tanstack/react-query";
import { aiUsageAnalyticsQueries } from "@app/lib/queries";
import type { AiUsageAnalyticsFilters } from "@app/lib/queries";
import { formatVirtualApiKeyPreview } from "@app/lib/virtualApiKeyFormat";
import { useTranslations } from "next-intl";
import { Card, CardContent, CardHeader } from "@app/components/ui/card";
import { ToggleableTrendChart } from "./ToggleableTrendChart";
import { TopEntitiesList, type TopEntity } from "./TopEntitiesList";
import { buildSeriesFromData, formatCost } from "./shared";

type VirtualApiKeysTabProps = {
    orgId: string;
    filters: AiUsageAnalyticsFilters;
};

const UNKNOWN_VIRTUAL_API_KEY_KEY = "unknown";

export function VirtualApiKeysTab(props: VirtualApiKeysTabProps) {
    const t = useTranslations();
    const { data, isLoading } = useQuery(
        aiUsageAnalyticsQueries.virtualApiKeys({
            orgId: props.orgId,
            filters: props.filters
        })
    );

    const labelByKey = new Map<string, string>();
    for (const k of data?.topVirtualApiKeys ?? []) {
        if (k.virtualApiKeyId) {
            labelByKey.set(k.virtualApiKeyId, k.name ?? k.virtualApiKeyId);
        }
    }
    const virtualApiKeyLabelFor = (key: string) =>
        key === UNKNOWN_VIRTUAL_API_KEY_KEY
            ? t("aiUsageUnknownVirtualApiKey")
            : (labelByKey.get(key) ?? key);

    const virtualApiKeyCostSeries = buildSeriesFromData(
        data?.virtualApiKeyCostPerDay ?? [],
        virtualApiKeyLabelFor,
        t("aiUsageOther")
    );
    const virtualApiKeyTokensSeries = buildSeriesFromData(
        data?.virtualApiKeyTokensPerDay ?? [],
        virtualApiKeyLabelFor,
        t("aiUsageOther")
    );

    const topVirtualApiKeys: TopEntity[] = (data?.topVirtualApiKeys ?? []).map(
        (k) => ({
            key: k.virtualApiKeyId ?? UNKNOWN_VIRTUAL_API_KEY_KEY,
            label: k.virtualApiKeyId
                ? (k.name ?? t("aiUsageUnnamedVirtualApiKey"))
                : t("aiUsageUnknownVirtualApiKey"),
            sublabel:
                k.virtualApiKeyId && k.lastChars
                    ? formatVirtualApiKeyPreview(k.virtualApiKeyId, k.lastChars)
                    : undefined,
            requests: k.requests,
            totalTokens: k.totalTokens,
            costUsd: k.costUsd
        })
    );

    return (
        <div className="flex flex-col gap-5">
            <Card>
                <CardHeader>
                    <h3 className="font-semibold">
                        {t("aiUsageTopVirtualApiKeys")}
                    </h3>
                </CardHeader>
                <CardContent>
                    <TopEntitiesList
                        entities={topVirtualApiKeys}
                        isLoading={isLoading}
                        nameColumnLabel={t("aiUsageFilterVirtualApiKey")}
                    />
                </CardContent>
            </Card>
            <div className="grid lg:grid-cols-2 gap-5">
                <Card>
                    <CardContent className="p-6">
                        <ToggleableTrendChart
                            title={t("aiUsageVirtualApiKeyCost")}
                            data={data?.virtualApiKeyCostPerDay ?? []}
                            series={virtualApiKeyCostSeries}
                            isLoading={isLoading}
                            valueFormatter={(v) => formatCost(v)}
                        />
                    </CardContent>
                </Card>
                <Card>
                    <CardContent className="p-6">
                        <ToggleableTrendChart
                            title={t("aiUsageVirtualApiKeyTokenUsage")}
                            data={data?.virtualApiKeyTokensPerDay ?? []}
                            series={virtualApiKeyTokensSeries}
                            isLoading={isLoading}
                        />
                    </CardContent>
                </Card>
            </div>
        </div>
    );
}
