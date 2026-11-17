"use client";

import { DateTimeValue } from "@app/components/DateTimePicker";
import { LogDataTable } from "@app/components/LogDataTable";
import LogRetentionWarning from "@app/components/LogRetentionWarning";
import SettingsSectionTitle from "@app/components/SettingsSectionTitle";
import { Card, CardContent, CardHeader } from "@app/components/ui/card";
import {
    ChartContainer,
    ChartTooltip,
    ChartTooltipContent,
    type ChartConfig
} from "@app/components/ui/chart";
import { PaidFeaturesAlert } from "@app/components/PaidFeaturesAlert";
import { useEnvContext } from "@app/hooks/useEnvContext";
import { useOrgContext } from "@app/hooks/useOrgContext";
import { usePaidStatus } from "@app/hooks/usePaidStatus";
import { useStoredPageSize } from "@app/hooks/useStoredPageSize";
import { createApiClient } from "@app/lib/api";
import { getSevenDaysAgo } from "@app/lib/getSevenDaysAgo";
import { tierMatrix } from "@server/lib/billing/tierMatrix";
import type {
    DnsBlockAnalyticsResponse,
    DnsBlockLogRow,
    QueryDnsBlockLogsResponse
} from "@server/routers/dnsBlocking/types";
import { useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import type { AxiosResponse } from "axios";
import { useTranslations } from "next-intl";
import { useParams } from "next/navigation";
import { useMemo, useState } from "react";
import { CartesianGrid, Line, LineChart, XAxis, YAxis } from "recharts";

type DateRange = { startDate: DateTimeValue; endDate: DateTimeValue };

export default function DnsBlocksPage() {
    const t = useTranslations();
    const { orgId } = useParams();
    const { org } = useOrgContext();
    const api = createApiClient(useEnvContext());
    const { isPaidUser } = usePaidStatus();
    const enabled = isPaidUser(tierMatrix.dnsBlocking);

    const [pageSize, setPageSize] = useStoredPageSize("dns-block-logs", 20);
    const [currentPage, setCurrentPage] = useState(0);
    const [dateRange, setDateRange] = useState<DateRange>({
        startDate: { date: getSevenDaysAgo() },
        endDate: { date: new Date() }
    });

    const timeParams = useMemo(
        () => ({
            timeStart: dateRange.startDate?.date?.toISOString(),
            timeEnd: dateRange.endDate?.date?.toISOString()
        }),
        [dateRange]
    );

    const analyticsQuery = useQuery({
        queryKey: ["ORG", orgId, "DNS_BLOCK_ANALYTICS", timeParams] as const,
        queryFn: async ({ signal }) => {
            const res = await api.get<AxiosResponse<DnsBlockAnalyticsResponse>>(
                `/org/${orgId}/logs/dns-blocks/analytics`,
                {
                    params: timeParams,
                    signal
                }
            );
            return res.data.data;
        },
        enabled
    });

    const logsQuery = useQuery({
        queryKey: [
            "ORG",
            orgId,
            "DNS_BLOCK_LOGS",
            timeParams,
            currentPage,
            pageSize
        ] as const,
        queryFn: async ({ signal }) => {
            const res = await api.get<AxiosResponse<QueryDnsBlockLogsResponse>>(
                `/org/${orgId}/logs/dns-blocks`,
                {
                    params: {
                        ...timeParams,
                        limit: pageSize,
                        offset: currentPage * pageSize
                    },
                    signal
                }
            );
            return res.data.data;
        },
        enabled
    });

    function handleRefresh() {
        // An end date without a time means "up to now"; move it forward so
        // refreshing picks up what was blocked since the page loaded.
        if (dateRange.endDate?.date && !dateRange.endDate.time) {
            setDateRange((prev) => ({
                ...prev,
                endDate: { date: new Date() }
            }));
        } else {
            analyticsQuery.refetch();
            logsQuery.refetch();
        }
    }

    const columns: ColumnDef<DnsBlockLogRow>[] = [
        {
            accessorKey: "domain",
            header: t("dnsBlockLogsDomain"),
            cell: ({ row }) => (
                <span className="font-mono text-sm">{row.original.domain}</span>
            )
        },
        {
            accessorKey: "username",
            header: t("dnsBlockLogsUser"),
            cell: ({ row }) => row.original.username ?? "-"
        },
        {
            accessorKey: "clientName",
            header: t("dnsBlockLogsDevice"),
            cell: ({ row }) => row.original.clientName ?? "-"
        },
        {
            accessorKey: "count",
            header: t("dnsBlockLogsCount"),
            cell: ({ row }) => row.original.count.toLocaleString()
        },
        {
            accessorKey: "lastBlocked",
            header: t("dnsBlockLogsLastBlocked"),
            cell: ({ row }) =>
                new Date(row.original.lastBlocked * 1000).toLocaleString()
        }
    ];

    const chartConfig = {
        count: {
            label: t("dnsBlockLogsCount"),
            color: "var(--chart-5)"
        }
    } satisfies ChartConfig;

    const analytics = analyticsQuery.data;

    return (
        <>
            <SettingsSectionTitle
                title={t("dnsBlockLogsTitle")}
                description={t("dnsBlockLogsDescription")}
            />

            <PaidFeaturesAlert tiers={tierMatrix.dnsBlocking} />

            {org.org.settingsLogRetentionDaysDnsBlock === 0 && (
                <LogRetentionWarning
                    orgId={orgId as string}
                    logTypeLabel={t("dnsBlockLogsTitle")}
                />
            )}

            <div className="grid gap-4 sm:grid-cols-3">
                <StatCard
                    label={t("dnsBlockLogsTotalBlocked")}
                    value={analytics?.totalBlocked}
                />
                <StatCard
                    label={t("dnsBlockLogsUniqueDomains")}
                    value={analytics?.uniqueDomains}
                />
                <StatCard
                    label={t("dnsBlockLogsActiveDevices")}
                    value={analytics?.activeClients}
                />
            </div>

            <div className="grid gap-4 lg:grid-cols-2">
                <RankCard
                    title={t("dnsBlockLogsTopDomains")}
                    emptyText={t("dnsBlockLogsNoData")}
                    items={(analytics?.topDomains ?? []).map((d) => ({
                        key: d.domain,
                        label: d.domain,
                        count: d.count
                    }))}
                />
                <RankCard
                    title={t("dnsBlockLogsTopUsers")}
                    emptyText={t("dnsBlockLogsNoData")}
                    items={(analytics?.topUsers ?? []).map((u, i) => ({
                        key: u.userId ?? `none-${i}`,
                        label: u.username ?? "-",
                        count: u.count
                    }))}
                />
            </div>

            <Card>
                <CardHeader className="pb-0 text-sm font-medium">
                    {t("dnsBlockLogsOverTime")}
                </CardHeader>
                <CardContent className="pt-4">
                    <ChartContainer
                        config={chartConfig}
                        className="h-64 w-full"
                    >
                        <LineChart
                            accessibilityLayer
                            data={analytics?.timeSeries ?? []}
                        >
                            <CartesianGrid vertical={false} />
                            <XAxis
                                dataKey="day"
                                tickLine={false}
                                axisLine={false}
                                tickMargin={10}
                                tickFormatter={(value) =>
                                    new Date(value).toLocaleDateString(
                                        navigator.language,
                                        { dateStyle: "medium" }
                                    )
                                }
                            />
                            <YAxis
                                tickLine={false}
                                axisLine={false}
                                allowDecimals={false}
                            />
                            <ChartTooltip
                                content={
                                    <ChartTooltipContent indicator="dot" />
                                }
                            />
                            <Line
                                dataKey="count"
                                stroke="var(--color-count)"
                                strokeWidth={2}
                                dot={false}
                                isAnimationActive={false}
                            />
                        </LineChart>
                    </ChartContainer>
                </CardContent>
            </Card>

            <LogDataTable
                columns={columns}
                data={logsQuery.data?.rows ?? []}
                title={t("dnsBlockLogsTitle")}
                searchPlaceholder={t("dnsBlockLogsSearchDomain")}
                searchColumn="domain"
                onRefresh={handleRefresh}
                isRefreshing={logsQuery.isFetching}
                onDateRangeChange={(startDate, endDate) => {
                    setDateRange({ startDate, endDate });
                    setCurrentPage(0);
                }}
                dateRange={{
                    start: dateRange.startDate,
                    end: dateRange.endDate
                }}
                totalCount={logsQuery.data?.pagination.total ?? 0}
                currentPage={currentPage}
                onPageChange={setCurrentPage}
                onPageSizeChange={(size) => {
                    setPageSize(size);
                    setCurrentPage(0);
                }}
                isLoading={logsQuery.isLoading}
                pageSize={pageSize}
            />
        </>
    );
}

function StatCard({ label, value }: { label: string; value?: number }) {
    return (
        <Card>
            <CardContent className="pt-6">
                <div className="text-sm text-muted-foreground">{label}</div>
                <div className="mt-1 text-3xl font-semibold">
                    {value === undefined ? "-" : value.toLocaleString()}
                </div>
            </CardContent>
        </Card>
    );
}

function RankCard({
    title,
    emptyText,
    items
}: {
    title: string;
    emptyText: string;
    items: { key: string; label: string; count: number }[];
}) {
    return (
        <Card>
            <CardHeader className="pb-0 text-sm font-medium">
                {title}
            </CardHeader>
            <CardContent className="pt-4">
                {items.length === 0 ? (
                    <p className="text-sm text-muted-foreground">{emptyText}</p>
                ) : (
                    <ul className="space-y-2">
                        {items.map((item) => (
                            <li
                                key={item.key}
                                className="flex items-center justify-between gap-4 text-sm"
                            >
                                <span className="truncate font-mono">
                                    {item.label}
                                </span>
                                <span className="shrink-0 text-muted-foreground">
                                    {item.count.toLocaleString()}
                                </span>
                            </li>
                        ))}
                    </ul>
                )}
            </CardContent>
        </Card>
    );
}
