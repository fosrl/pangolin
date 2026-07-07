"use client";
import { Button } from "@app/components/ui/button";
import { ColumnFilterButton } from "@app/components/ColumnFilterButton";
import { DateTimeValue } from "@app/components/DateTimePicker";
import { LogDataTable } from "@app/components/LogDataTable";
import { PaidFeaturesAlert } from "@app/components/PaidFeaturesAlert";
import SettingsSectionTitle from "@app/components/SettingsSectionTitle";
import { useEnvContext } from "@app/hooks/useEnvContext";
import { usePaidStatus } from "@app/hooks/usePaidStatus";
import { useStoredPageSize } from "@app/hooks/useStoredPageSize";
import { toast } from "@app/hooks/useToast";
import { createApiClient } from "@app/lib/api";
import { getSevenDaysAgo } from "@app/lib/getSevenDaysAgo";
import { logQueries } from "@app/lib/queries";
import { build } from "@server/build";
import { tierMatrix } from "@server/lib/billing/tierMatrix";
import type { QueryConnectionAuditLogResponse } from "@server/routers/auditLogs/types";
import { useQuery } from "@tanstack/react-query";
import { ColumnDef } from "@tanstack/react-table";
import axios from "axios";
import { ArrowUpRight, Laptop, User } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useMemo, useState, useTransition } from "react";

function formatDuration(startedAt: number, endedAt: number | null): string {
    if (endedAt === null || endedAt === undefined) return "Active";
    const durationSec = endedAt - startedAt;
    if (durationSec < 0) return "-";
    if (durationSec < 60) return `${durationSec}s`;
    if (durationSec < 3600) {
        const m = Math.floor(durationSec / 60);
        const s = durationSec % 60;
        return `${m}m ${s}s`;
    }
    const h = Math.floor(durationSec / 3600);
    const m = Math.floor((durationSec % 3600) / 60);
    return `${h}h ${m}m`;
}

export default function ConnectionLogsPage() {
    const router = useRouter();
    const api = createApiClient(useEnvContext());
    const t = useTranslations();
    const { orgId } = useParams();
    const searchParams = useSearchParams();

    const { isPaidUser } = usePaidStatus();

    const [isExporting, startTransition] = useTransition();

    const [filters, setFilters] = useState<{
        protocol?: string;
        destAddr?: string;
        clientId?: string;
        siteResourceId?: string;
        userId?: string;
    }>({
        protocol: searchParams.get("protocol") || undefined,
        destAddr: searchParams.get("destAddr") || undefined,
        clientId: searchParams.get("clientId") || undefined,
        siteResourceId: searchParams.get("siteResourceId") || undefined,
        userId: searchParams.get("userId") || undefined
    });

    const [currentPage, setCurrentPage] = useState<number>(0);
    const [pageSize, setPageSize] = useStoredPageSize(
        "connection-audit-logs",
        20
    );

    const getDefaultDateRange = () => {
        const startParam = searchParams.get("start");
        const endParam = searchParams.get("end");
        if (startParam && endParam) {
            return {
                startDate: { date: new Date(startParam) },
                endDate: { date: new Date(endParam) }
            };
        }
        return {
            startDate: { date: getSevenDaysAgo() },
            endDate: { date: new Date() }
        };
    };

    const [dateRange, setDateRange] = useState<{
        startDate: DateTimeValue;
        endDate: DateTimeValue;
    }>(getDefaultDateRange());

    const queryFilters = useMemo(() => {
        let timeStart: string | undefined;
        let timeEnd: string | undefined;

        if (dateRange.startDate?.date) {
            const dt = new Date(dateRange.startDate.date);
            if (dateRange.startDate.time) {
                const [h, m, s] = dateRange.startDate.time
                    .split(":")
                    .map(Number);
                dt.setHours(h, m, s || 0);
            }
            timeStart = dt.toISOString();
        }

        if (dateRange.endDate?.date) {
            const dt = new Date(dateRange.endDate.date);
            if (dateRange.endDate.time) {
                const [h, m, s] = dateRange.endDate.time.split(":").map(Number);
                dt.setHours(h, m, s || 0);
            } else {
                const now = new Date();
                dt.setHours(
                    now.getHours(),
                    now.getMinutes(),
                    now.getSeconds(),
                    now.getMilliseconds()
                );
            }
            timeEnd = dt.toISOString();
        }

        return {
            timeStart,
            timeEnd,
            page: currentPage,
            pageSize,
            ...filters,
            clientId: filters.clientId ? Number(filters.clientId) : undefined,
            siteResourceId: filters.siteResourceId
                ? Number(filters.siteResourceId)
                : undefined
        };
    }, [dateRange, currentPage, pageSize, filters]);

    const { data, isFetching, isLoading, refetch } = useQuery({
        ...logQueries.connection({
            orgId: orgId as string,
            filters: queryFilters
        }),
        enabled: isPaidUser(tierMatrix.connectionLogs) && build !== "oss"
    });

    const rows = isLoading ? generateSampleConnectionLogs() : (data?.log ?? []);
    const totalCount = data?.pagination?.total ?? 0;
    const filterAttributes = data?.filterAttributes ?? {
        protocols: [],
        destAddrs: [],
        clients: [],
        resources: [],
        users: []
    };

    const handleDateRangeChange = (
        startDate: DateTimeValue,
        endDate: DateTimeValue
    ) => {
        setDateRange({ startDate, endDate });
        setCurrentPage(0);
        updateUrlParamsForAllFilters({
            start: startDate.date?.toISOString() || "",
            end: endDate.date?.toISOString() || ""
        });
    };

    const handlePageChange = (newPage: number) => {
        setCurrentPage(newPage);
    };

    const handlePageSizeChange = (newPageSize: number) => {
        setPageSize(newPageSize);
        setCurrentPage(0);
    };

    const handleFilterChange = (
        filterType: keyof typeof filters,
        value: string | undefined
    ) => {
        const newFilters = { ...filters, [filterType]: value };
        setFilters(newFilters);
        setCurrentPage(0);
        updateUrlParamsForAllFilters(newFilters);
    };

    const updateUrlParamsForAllFilters = (
        newFilters:
            | typeof filters
            | {
                  start: string;
                  end: string;
              }
    ) => {
        const params = new URLSearchParams(searchParams);
        Object.entries(newFilters).forEach(([key, value]) => {
            if (value) {
                params.set(key, value);
            } else {
                params.delete(key);
            }
        });
        router.replace(`?${params.toString()}`, { scroll: false });
    };

    const exportData = async () => {
        try {
            const params: any = {
                timeStart: dateRange.startDate?.date
                    ? new Date(dateRange.startDate.date).toISOString()
                    : undefined,
                timeEnd: dateRange.endDate?.date
                    ? new Date(dateRange.endDate.date).toISOString()
                    : undefined,
                ...filters
            };

            const response = await api.get(
                `/org/${orgId}/logs/connection/export`,
                {
                    responseType: "blob",
                    params
                }
            );

            const url = window.URL.createObjectURL(new Blob([response.data]));
            const link = document.createElement("a");
            link.href = url;
            const epoch = Math.floor(Date.now() / 1000);
            link.setAttribute(
                "download",
                `connection-audit-logs-${orgId}-${epoch}.csv`
            );
            document.body.appendChild(link);
            link.click();
            link.parentNode?.removeChild(link);
        } catch (error) {
            let apiErrorMessage: string | null = null;
            if (axios.isAxiosError(error) && error.response) {
                const data = error.response.data;

                if (data instanceof Blob && data.type === "application/json") {
                    const text = await data.text();
                    const errorData = JSON.parse(text);
                    apiErrorMessage = errorData.message;
                }
            }
            toast({
                title: t("error"),
                description: apiErrorMessage ?? t("exportError"),
                variant: "destructive"
            });
        }
    };

    const columns: ColumnDef<any>[] = [
        {
            accessorKey: "startedAt",
            header: () => <span className="px-2">{t("timestamp")}</span>,
            cell: ({ row }) => {
                return (
                    <div className="whitespace-nowrap">
                        {new Date(
                            row.original.startedAt * 1000
                        ).toLocaleString()}
                    </div>
                );
            }
        },
        {
            accessorKey: "protocol",
            header: () => {
                return (
                    <div className="flex items-center gap-2 px-2">
                        <ColumnFilterButton
                            options={filterAttributes.protocols.map(
                                (protocol) => ({
                                    label: protocol.toUpperCase(),
                                    value: protocol
                                })
                            )}
                            label={t("protocol")}
                            selectedValue={filters.protocol}
                            onValueChange={(value) =>
                                handleFilterChange("protocol", value)
                            }
                            searchPlaceholder={t("searchPlaceholder")}
                            emptyMessage={t("emptySearchOptions")}
                        />
                    </div>
                );
            },
            cell: ({ row }) => {
                return (
                    <span className="whitespace-nowrap font-mono text-xs">
                        {row.original.protocol?.toUpperCase()}
                    </span>
                );
            }
        },
        {
            accessorKey: "resourceName",
            header: () => {
                return (
                    <div className="flex items-center gap-2 px-2">
                        <ColumnFilterButton
                            options={filterAttributes.resources.map((res) => ({
                                value: res.id.toString(),
                                label: res.name || "Unnamed Resource"
                            }))}
                            label={t("resource")}
                            selectedValue={filters.siteResourceId}
                            onValueChange={(value) =>
                                handleFilterChange("siteResourceId", value)
                            }
                            searchPlaceholder={t("searchPlaceholder")}
                            emptyMessage={t("emptySearchOptions")}
                        />
                    </div>
                );
            },
            cell: ({ row }) => {
                if (row.original.resourceName && row.original.resourceNiceId) {
                    return (
                        <Link
                            href={`/${row.original.orgId}/settings/resources/private/?query=${row.original.resourceNiceId}`}
                        >
                            <Button variant="outline" size="sm">
                                {row.original.resourceName}
                                <ArrowUpRight className="ml-2 h-3 w-3" />
                            </Button>
                        </Link>
                    );
                }
                return (
                    <span className="whitespace-nowrap">
                        {row.original.resourceName ?? "-"}
                    </span>
                );
            }
        },
        {
            accessorKey: "clientName",
            header: () => {
                return (
                    <div className="flex items-center gap-2 px-2">
                        <ColumnFilterButton
                            options={filterAttributes.clients.map((c) => ({
                                value: c.id.toString(),
                                label: c.name
                            }))}
                            label={t("client")}
                            selectedValue={filters.clientId}
                            onValueChange={(value) =>
                                handleFilterChange("clientId", value)
                            }
                            searchPlaceholder={t("searchPlaceholder")}
                            emptyMessage={t("emptySearchOptions")}
                        />
                    </div>
                );
            },
            cell: ({ row }) => {
                const clientType = row.original.userId ? "user" : "machine";
                if (row.original.clientName && row.original.clientNiceId) {
                    return (
                        <Link
                            href={`/${row.original.orgId}/settings/clients/${clientType}/${row.original.clientNiceId}`}
                        >
                            <Button variant="outline" size="sm">
                                <Laptop className="mr-1 h-3 w-3" />
                                {row.original.clientName}
                                <ArrowUpRight className="ml-2 h-3 w-3" />
                            </Button>
                        </Link>
                    );
                }
                return (
                    <span className="whitespace-nowrap">
                        {row.original.clientName ?? "-"}
                    </span>
                );
            }
        },
        {
            accessorKey: "userEmail",
            header: () => {
                return (
                    <div className="flex items-center gap-2 px-2">
                        <ColumnFilterButton
                            options={filterAttributes.users.map((u) => ({
                                value: u.id,
                                label: u.email || u.id
                            }))}
                            label={t("user")}
                            selectedValue={filters.userId}
                            onValueChange={(value) =>
                                handleFilterChange("userId", value)
                            }
                            searchPlaceholder={t("searchPlaceholder")}
                            emptyMessage={t("emptySearchOptions")}
                        />
                    </div>
                );
            },
            cell: ({ row }) => {
                if (row.original.userEmail || row.original.userId) {
                    return (
                        <span className="flex items-center gap-1 whitespace-nowrap">
                            <User className="h-4 w-4" />
                            {row.original.userEmail ?? row.original.userId}
                        </span>
                    );
                }
                return <span>-</span>;
            }
        },
        {
            accessorKey: "sourceAddr",
            header: () => <span className="px-2">{t("sourceAddress")}</span>,
            cell: ({ row }) => {
                return (
                    <span className="whitespace-nowrap font-mono text-xs">
                        {row.original.sourceAddr}
                    </span>
                );
            }
        },
        {
            accessorKey: "destAddr",
            header: () => {
                return (
                    <div className="flex items-center gap-2 px-2">
                        <ColumnFilterButton
                            options={filterAttributes.destAddrs.map((addr) => ({
                                value: addr,
                                label: addr
                            }))}
                            label={t("destinationAddress")}
                            selectedValue={filters.destAddr}
                            onValueChange={(value) =>
                                handleFilterChange("destAddr", value)
                            }
                            searchPlaceholder={t("searchPlaceholder")}
                            emptyMessage={t("emptySearchOptions")}
                        />
                    </div>
                );
            },
            cell: ({ row }) => {
                return (
                    <span className="whitespace-nowrap font-mono text-xs">
                        {row.original.destAddr}
                    </span>
                );
            }
        },
        {
            accessorKey: "duration",
            header: () => <span className="px-2">{t("duration")}</span>,
            cell: ({ row }) => {
                return (
                    <span className="whitespace-nowrap">
                        {formatDuration(
                            row.original.startedAt,
                            row.original.endedAt
                        )}
                    </span>
                );
            }
        }
    ];

    const renderExpandedRow = (row: any) => {
        return (
            <div className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs">
                    <div className="space-y-2">
                        <div>
                            <strong>Session ID:</strong>{" "}
                            <span className="font-mono">
                                {row.sessionId ?? "-"}
                            </span>
                        </div>
                        <div>
                            <strong>Protocol:</strong>{" "}
                            {row.protocol?.toUpperCase() ?? "-"}
                        </div>
                        <div>
                            <strong>Source:</strong>{" "}
                            <span className="font-mono">
                                {row.sourceAddr ?? "-"}
                            </span>
                        </div>
                        <div>
                            <strong>Destination:</strong>{" "}
                            <span className="font-mono">
                                {row.destAddr ?? "-"}
                            </span>
                        </div>
                    </div>
                    <div className="space-y-2">
                        <div>
                            <strong>Client Endpoint:</strong>{" "}
                            <span className="font-mono">
                                {row.clientEndpoint ?? "-"}
                            </span>
                        </div>
                        <div>
                            <strong>Site:</strong> {row.siteName ?? "-"}
                            {row.siteNiceId && (
                                <span className="text-muted-foreground ml-1">
                                    ({row.siteNiceId})
                                </span>
                            )}
                        </div>
                        <div>
                            <strong>Site ID:</strong> {row.siteId ?? "-"}
                        </div>
                        <div>
                            <strong>Started At:</strong>{" "}
                            {row.startedAt
                                ? new Date(
                                      row.startedAt * 1000
                                  ).toLocaleString()
                                : "-"}
                        </div>
                        <div>
                            <strong>Ended At:</strong>{" "}
                            {row.endedAt
                                ? new Date(row.endedAt * 1000).toLocaleString()
                                : "Active"}
                        </div>
                        <div>
                            <strong>Duration:</strong>{" "}
                            {formatDuration(row.startedAt, row.endedAt)}
                        </div>
                    </div>
                    <div className="space-y-2" />
                </div>
            </div>
        );
    };

    return (
        <>
            <SettingsSectionTitle
                title={t("connectionLogs")}
                description={t("connectionLogsDescription")}
            />

            <PaidFeaturesAlert tiers={tierMatrix.connectionLogs} />

            <LogDataTable
                columns={columns}
                data={rows}
                title={t("connectionLogs")}
                searchPlaceholder={t("searchLogs")}
                searchColumn="protocol"
                onRefresh={() => refetch()}
                isRefreshing={isFetching}
                onExport={() => startTransition(exportData)}
                isExporting={isExporting}
                onDateRangeChange={handleDateRangeChange}
                dateRange={{
                    start: dateRange.startDate,
                    end: dateRange.endDate
                }}
                defaultSort={{
                    id: "startedAt",
                    desc: true
                }}
                totalCount={totalCount}
                currentPage={currentPage}
                pageSize={pageSize}
                onPageChange={handlePageChange}
                onPageSizeChange={handlePageSizeChange}
                isLoading={isLoading}
                expandable={true}
                renderExpandedRow={renderExpandedRow}
                disabled={
                    !isPaidUser(tierMatrix.connectionLogs) || build === "oss"
                }
            />
        </>
    );
}

function generateSampleConnectionLogs(): QueryConnectionAuditLogResponse["log"] {
    const protocols = ["tcp", "udp", "icmp"];
    const destAddrs = [
        "10.0.0.1:22",
        "10.0.0.2:80",
        "10.0.0.3:443",
        "192.168.1.10:3306"
    ];

    const now = Math.floor(Date.now() / 1000);
    const sevenDaysAgo = now - 7 * 24 * 60 * 60;

    return Array.from({ length: 10 }, (_, i) => {
        const startedAt = Math.floor(
            sevenDaysAgo + Math.random() * (now - sevenDaysAgo)
        );
        const active = Math.random() > 0.3;

        return {
            sessionId: `session-${i}`,
            siteResourceId: (i % 3) + 1,
            orgId: "sample-org",
            siteId: 1,
            clientId: (i % 4) + 1,
            clientEndpoint: `10.0.0.${i + 1}:51820`,
            userId: i % 2 === 0 ? `user-${i}` : null,
            sourceAddr: `192.168.1.${i + 1}:${40000 + i}`,
            destAddr: destAddrs[Math.floor(Math.random() * destAddrs.length)],
            protocol: protocols[Math.floor(Math.random() * protocols.length)],
            startedAt,
            endedAt: active
                ? null
                : startedAt + Math.floor(Math.random() * 3600),
            bytesTx: active ? null : Math.floor(Math.random() * 1024 * 1024),
            bytesRx: active ? null : Math.floor(Math.random() * 1024 * 1024),
            resourceName: `Resource ${(i % 3) + 1}`,
            resourceNiceId: `resource-${(i % 3) + 1}`,
            siteName: "Sample Site",
            siteNiceId: "sample-site",
            clientName: `Client ${(i % 4) + 1}`,
            clientNiceId: `client-${(i % 4) + 1}`,
            clientType: i % 2 === 0 ? "user" : "machine",
            userEmail: i % 2 === 0 ? `user${i}@example.com` : null
        };
    });
}
