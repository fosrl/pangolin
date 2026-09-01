"use client";

import { useQuery } from "@tanstack/react-query";
import { aiUsageAnalyticsQueries } from "@app/lib/queries";
import type { AiUsageAnalyticsFilters } from "@app/lib/queries";
import { useTranslations } from "next-intl";
import { Card, CardContent, CardHeader } from "@app/components/ui/card";
import { ToggleableTrendChart } from "./ToggleableTrendChart";
import { TopEntitiesList, type TopEntity } from "./TopEntitiesList";
import { buildSeriesFromData, formatCost } from "./shared";

type UsersTabProps = {
    orgId: string;
    filters: AiUsageAnalyticsFilters;
};

const UNKNOWN_USER_KEY = "unknown";

export function UsersTab(props: UsersTabProps) {
    const t = useTranslations();
    const { data, isLoading } = useQuery(
        aiUsageAnalyticsQueries.usersRoles({
            orgId: props.orgId,
            filters: props.filters
        })
    );

    const userEmailByKey = new Map<string, string>();
    for (const u of data?.topUsers ?? []) {
        if (u.userId) {
            userEmailByKey.set(u.userId, u.email ?? u.userId);
        }
    }
    const userLabelFor = (key: string) =>
        key === UNKNOWN_USER_KEY
            ? t("aiUsageUnknownUser")
            : (userEmailByKey.get(key) ?? key);

    const userCostSeries = buildSeriesFromData(
        data?.userCostPerDay ?? [],
        userLabelFor,
        t("aiUsageOther")
    );
    const userTokensSeries = buildSeriesFromData(
        data?.userTokensPerDay ?? [],
        userLabelFor,
        t("aiUsageOther")
    );

    const topUsers: TopEntity[] = (data?.topUsers ?? []).map((u) => ({
        key: u.userId ?? UNKNOWN_USER_KEY,
        label: u.email ?? u.userId ?? t("aiUsageUnknownUser"),
        requests: u.requests,
        totalTokens: u.totalTokens,
        costUsd: u.costUsd
    }));

    return (
        <div className="flex flex-col gap-5">
            <Card>
                <CardHeader>
                    <h3 className="font-semibold">{t("aiUsageTopUsers")}</h3>
                </CardHeader>
                <CardContent>
                    <TopEntitiesList
                        entities={topUsers}
                        isLoading={isLoading}
                        nameColumnLabel={t("aiUsageFilterUser")}
                    />
                </CardContent>
            </Card>
            <div className="grid lg:grid-cols-2 gap-5">
                <Card>
                    <CardContent className="p-6">
                        <ToggleableTrendChart
                            title={t("aiUsageUserCost")}
                            data={data?.userCostPerDay ?? []}
                            series={userCostSeries}
                            isLoading={isLoading}
                            valueFormatter={(v) => formatCost(v)}
                        />
                    </CardContent>
                </Card>
                <Card>
                    <CardContent className="p-6">
                        <ToggleableTrendChart
                            title={t("aiUsageUserTokenUsage")}
                            data={data?.userTokensPerDay ?? []}
                            series={userTokensSeries}
                            isLoading={isLoading}
                        />
                    </CardContent>
                </Card>
            </div>
        </div>
    );
}
