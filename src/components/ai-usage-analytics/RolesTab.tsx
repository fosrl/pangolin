"use client";

import { useQuery } from "@tanstack/react-query";
import { aiUsageAnalyticsQueries } from "@app/lib/queries";
import type { AiUsageAnalyticsFilters } from "@app/lib/queries";
import { useTranslations } from "next-intl";
import { Card, CardContent, CardHeader } from "@app/components/ui/card";
import { ToggleableTrendChart } from "./ToggleableTrendChart";
import { TopEntitiesList, type TopEntity } from "./TopEntitiesList";
import { buildSeriesFromData, formatCost } from "./shared";

type RolesTabProps = {
    orgId: string;
    filters: AiUsageAnalyticsFilters;
};

export function RolesTab(props: RolesTabProps) {
    const t = useTranslations();
    const { data, isLoading } = useQuery(
        aiUsageAnalyticsQueries.usersRoles({
            orgId: props.orgId,
            filters: props.filters
        })
    );

    const roleNameByKey = new Map<string, string>();
    for (const r of data?.topRoles ?? []) {
        roleNameByKey.set(String(r.roleId), r.name ?? `Role #${r.roleId}`);
    }
    const roleLabelFor = (key: string) =>
        roleNameByKey.get(key) ?? `Role #${key}`;

    const roleCostSeries = buildSeriesFromData(
        data?.roleCostPerDay ?? [],
        roleLabelFor,
        t("aiUsageOther")
    );
    const roleTokensSeries = buildSeriesFromData(
        data?.roleTokensPerDay ?? [],
        roleLabelFor,
        t("aiUsageOther")
    );

    const topRoles: TopEntity[] = (data?.topRoles ?? []).map((r) => ({
        key: String(r.roleId),
        label: r.name ?? `Role #${r.roleId}`,
        requests: r.requests,
        totalTokens: r.totalTokens,
        costUsd: r.costUsd
    }));

    return (
        <div className="flex flex-col gap-5">
            <Card>
                <CardHeader>
                    <h3 className="font-semibold">{t("aiUsageTopRoles")}</h3>
                </CardHeader>
                <CardContent>
                    <TopEntitiesList
                        entities={topRoles}
                        isLoading={isLoading}
                        nameColumnLabel={t("aiUsageFilterRole")}
                    />
                </CardContent>
            </Card>
            <div className="grid lg:grid-cols-2 gap-5">
                <Card>
                    <CardContent className="p-6">
                        <ToggleableTrendChart
                            title={t("aiUsageRoleCost")}
                            data={data?.roleCostPerDay ?? []}
                            series={roleCostSeries}
                            isLoading={isLoading}
                            valueFormatter={(v) => formatCost(v)}
                        />
                    </CardContent>
                </Card>
                <Card>
                    <CardContent className="p-6">
                        <ToggleableTrendChart
                            title={t("aiUsageRoleTokenUsage")}
                            data={data?.roleTokensPerDay ?? []}
                            series={roleTokensSeries}
                            isLoading={isLoading}
                        />
                    </CardContent>
                </Card>
            </div>
        </div>
    );
}
