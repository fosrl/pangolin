"use client";

import { useQuery } from "@tanstack/react-query";
import { aiUsageAnalyticsQueries } from "@app/lib/queries";
import type { AiUsageAnalyticsFilters } from "@app/lib/queries";
import { useTranslations } from "next-intl";
import { Card, CardContent, CardHeader } from "@app/components/ui/card";
import {
    InfoSection,
    InfoSectionContent,
    InfoSections,
    InfoSectionTitle
} from "@app/components/InfoSection";
import { ToggleableTrendChart } from "./ToggleableTrendChart";
import { TopEntitiesList, type TopEntity } from "./TopEntitiesList";
import {
    SERIES_COLORS,
    buildSeriesFromData,
    compactNumberFormatter,
    formatCost
} from "./shared";

type OverviewTabProps = {
    orgId: string;
    filters: AiUsageAnalyticsFilters;
};

export function OverviewTab(props: OverviewTabProps) {
    const t = useTranslations();
    const { data, isLoading } = useQuery(
        aiUsageAnalyticsQueries.overview({
            orgId: props.orgId,
            filters: props.filters
        })
    );

    const TOKEN_TYPE_LABELS: Record<string, string> = {
        promptTokens: t("aiUsageTokenTypePrompt"),
        cacheReadTokens: t("aiUsageTokenTypeCacheRead"),
        cacheWriteTokens: t("aiUsageTokenTypeCacheWrite"),
        completionTokens: t("aiUsageTokenTypeCompletion"),
        reasoningTokens: t("aiUsageTokenTypeReasoning")
    };

    const requestsSeries = [
        { key: "requests", label: t("aiUsageRequests"), color: SERIES_COLORS[0] }
    ];
    const tokensSeries = Object.keys(TOKEN_TYPE_LABELS).map((key, i) => ({
        key,
        label: TOKEN_TYPE_LABELS[key],
        color: SERIES_COLORS[i % SERIES_COLORS.length]
    }));
    const costSeries = [
        { key: "cost", label: t("aiUsageCost"), color: SERIES_COLORS[0] }
    ];

    const modelCostSeries = buildSeriesFromData(
        data?.modelCostPerDay ?? [],
        (key) => key,
        t("aiUsageOther")
    );
    const modelTokensSeries = buildSeriesFromData(
        data?.modelTokensPerDay ?? [],
        (key) => key,
        t("aiUsageOther")
    );

    const topModels: TopEntity[] = (data?.topModels ?? []).map((m) => ({
        key: m.model,
        label: m.model,
        requests: m.requests,
        totalTokens: m.totalTokens,
        costUsd: m.costUsd
    }));

    return (
        <div className="flex flex-col gap-5">
            <Card>
                <CardHeader>
                    <InfoSections cols={4}>
                        <InfoSection>
                            <InfoSectionTitle>
                                {t("aiUsageTotalRequests")}
                            </InfoSectionTitle>
                            <InfoSectionContent>
                                {data
                                    ? compactNumberFormatter.format(
                                          data.totalRequests
                                      )
                                    : "--"}
                            </InfoSectionContent>
                        </InfoSection>
                        <InfoSection>
                            <InfoSectionTitle>
                                {t("aiUsageTotalTokens")}
                            </InfoSectionTitle>
                            <InfoSectionContent>
                                {data
                                    ? compactNumberFormatter.format(
                                          data.totalTokens
                                      )
                                    : "--"}
                            </InfoSectionContent>
                        </InfoSection>
                        <InfoSection>
                            <InfoSectionTitle>
                                {t("aiUsageTotalCost")}
                            </InfoSectionTitle>
                            <InfoSectionContent>
                                {data ? formatCost(data.totalCost) : "--"}
                            </InfoSectionContent>
                        </InfoSection>
                        <InfoSection>
                            <InfoSectionTitle>
                                {t("aiUsageEstimated")}
                            </InfoSectionTitle>
                            <InfoSectionContent>
                                {data
                                    ? `${Math.round(data.estimatedPercent)}%`
                                    : "--"}
                            </InfoSectionContent>
                        </InfoSection>
                    </InfoSections>
                </CardHeader>
            </Card>

            <div className="grid lg:grid-cols-3 gap-5">
                <Card>
                    <CardContent className="p-6">
                        <ToggleableTrendChart
                            title={t("aiUsageRequestVolume")}
                            data={data?.requestsPerDay ?? []}
                            series={requestsSeries}
                            isLoading={isLoading}
                        />
                    </CardContent>
                </Card>
                <Card>
                    <CardContent className="p-6">
                        <ToggleableTrendChart
                            title={t("aiUsageTokenUsage")}
                            data={data?.tokensPerDay ?? []}
                            series={tokensSeries}
                            isLoading={isLoading}
                        />
                    </CardContent>
                </Card>
                <Card>
                    <CardContent className="p-6">
                        <ToggleableTrendChart
                            title={t("aiUsageCost")}
                            data={data?.costPerDay ?? []}
                            series={costSeries}
                            isLoading={isLoading}
                            valueFormatter={(v) => formatCost(v)}
                        />
                    </CardContent>
                </Card>
            </div>

            <div className="grid lg:grid-cols-2 gap-5">
                <Card>
                    <CardContent className="p-6">
                        <ToggleableTrendChart
                            title={t("aiUsageModelCost")}
                            data={data?.modelCostPerDay ?? []}
                            series={modelCostSeries}
                            isLoading={isLoading}
                            valueFormatter={(v) => formatCost(v)}
                        />
                    </CardContent>
                </Card>
                <Card>
                    <CardContent className="p-6">
                        <ToggleableTrendChart
                            title={t("aiUsageModelTokens")}
                            data={data?.modelTokensPerDay ?? []}
                            series={modelTokensSeries}
                            isLoading={isLoading}
                        />
                    </CardContent>
                </Card>
            </div>

            <Card>
                <CardHeader>
                    <h3 className="font-semibold">{t("aiUsageTopModels")}</h3>
                </CardHeader>
                <CardContent>
                    <TopEntitiesList
                        entities={topModels}
                        isLoading={isLoading}
                        nameColumnLabel={t("aiUsageFilterModel")}
                    />
                </CardContent>
            </Card>
        </div>
    );
}
