"use client";

import { useQuery } from "@tanstack/react-query";
import { aiUsageAnalyticsQueries } from "@app/lib/queries";
import type { AiUsageAnalyticsFilters } from "@app/lib/queries";
import { useTranslations } from "next-intl";
import { Card, CardContent, CardHeader } from "@app/components/ui/card";
import { ToggleableTrendChart } from "./ToggleableTrendChart";
import { TopEntitiesList, type TopEntity } from "./TopEntitiesList";
import { buildSeriesFromData, formatCost } from "./shared";

type ResourcesTabProps = {
    orgId: string;
    filters: AiUsageAnalyticsFilters;
};

export function ResourcesTab(props: ResourcesTabProps) {
    const t = useTranslations();

    function resourceTypeLabel(type: "public" | "site" | null) {
        if (type === "public") return t("aiUsageResourceTypePublic");
        if (type === "site") return t("aiUsageResourceTypeSite");
        return undefined;
    }

    const { data, isLoading } = useQuery(
        aiUsageAnalyticsQueries.resources({
            orgId: props.orgId,
            filters: props.filters
        })
    );

    const nameByKey = new Map<string, string>();
    for (const r of data?.topResources ?? []) {
        nameByKey.set(r.key, r.name ?? r.key);
    }
    const labelFor = (key: string) =>
        key === "none" ? t("aiUsageNoResource") : (nameByKey.get(key) ?? key);

    const costSeries = buildSeriesFromData(
        data?.resourceCostPerDay ?? [],
        labelFor,
        t("aiUsageOther")
    );
    const tokensSeries = buildSeriesFromData(
        data?.resourceTokensPerDay ?? [],
        labelFor,
        t("aiUsageOther")
    );

    const topResources: TopEntity[] = (data?.topResources ?? []).map((r) => ({
        key: r.key,
        label: r.name ?? (r.key === "none" ? t("aiUsageNoResource") : r.key),
        sublabel: resourceTypeLabel(r.type),
        requests: r.requests,
        totalTokens: r.totalTokens,
        costUsd: r.costUsd
    }));

    return (
        <div className="flex flex-col gap-5">
            <Card>
                <CardHeader>
                    <h3 className="font-semibold">{t("aiUsageTopResources")}</h3>
                </CardHeader>
                <CardContent>
                    <TopEntitiesList
                        entities={topResources}
                        isLoading={isLoading}
                        nameColumnLabel={t("aiUsageFilterResource")}
                    />
                </CardContent>
            </Card>

            <div className="grid lg:grid-cols-2 gap-5">
                <Card>
                    <CardContent className="p-6">
                        <ToggleableTrendChart
                            title={t("aiUsageResourceCost")}
                            data={data?.resourceCostPerDay ?? []}
                            series={costSeries}
                            isLoading={isLoading}
                            valueFormatter={(v) => formatCost(v)}
                        />
                    </CardContent>
                </Card>
                <Card>
                    <CardContent className="p-6">
                        <ToggleableTrendChart
                            title={t("aiUsageResourceTokenUsage")}
                            data={data?.resourceTokensPerDay ?? []}
                            series={tokensSeries}
                            isLoading={isLoading}
                        />
                    </CardContent>
                </Card>
            </div>
        </div>
    );
}
