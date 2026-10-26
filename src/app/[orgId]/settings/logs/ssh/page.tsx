"use client";
import { Button } from "@app/components/ui/button";
import { ColumnFilterButton } from "@app/components/ColumnFilterButton";
import { DateTimeValue } from "@app/components/DateTimePicker";
import { LogDataTable } from "@app/components/LogDataTable";
import { PaidFeaturesAlert } from "@app/components/PaidFeaturesAlert";
import LogRetentionWarning from "@app/components/LogRetentionWarning";
import SettingsSectionTitle from "@app/components/SettingsSectionTitle";
import { SshSessionCommandView } from "@app/components/SshSessionCommandView";
import { useEnvContext } from "@app/hooks/useEnvContext";
import { useOrgContext } from "@app/hooks/useOrgContext";
import { usePaidStatus } from "@app/hooks/usePaidStatus";
import { useStoredPageSize } from "@app/hooks/useStoredPageSize";
import { toast } from "@app/hooks/useToast";
import { createApiClient } from "@app/lib/api";
import { getSevenDaysAgo } from "@app/lib/getSevenDaysAgo";
import {
    getPrivateResourceSettingsHref,
    getPublicResourceSettingsHref
} from "@app/lib/launcherResourceAdminHref";
import { logQueries } from "@app/lib/queries";
import { build } from "@server/build";
import { tierMatrix } from "@server/lib/billing/tierMatrix";
import type { QuerySshSessionLogResponse } from "@server/routers/auditLogs/types";
import { useQuery } from "@tanstack/react-query";
import { ColumnDef } from "@tanstack/react-table";
import axios from "axios";
import {
    AppWindow,
    ArrowUpRight,
    Laptop,
    SquareTerminal,
    User
} from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useMemo, useState, useTransition } from "react";

type SshSessionRow = QuerySshSessionLogResponse["log"][number];

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

export default function SshSessionLogsPage() {
    const router = useRouter();
    const api = createApiClient(useEnvContext());
    const t = useTranslations();
    const { orgId } = useParams();
    const searchParams = useSearchParams();

    const { org } = useOrgContext();
    const { isPaidUser } = usePaidStatus();

    const [isExporting, startTransition] = useTransition();

    const [filters, setFilters] = useState<{
        siteResourceId?: string;
        resourceId?: string;
        siteId?: string;
        transport?: string;
        clientId?: string;
        userId?: string;
        username?: string;
    }>({
        siteResourceId: searchParams.get("siteResourceId") || undefined,
        resourceId: searchParams.get("resourceId") || undefined,
        siteId: searchParams.get("siteId") || undefined,
        transport: searchParams.get("transport") || undefined,
        clientId: searchParams.get("clientId") || undefined,
        userId: searchParams.get("userId") || undefined,
        username: searchParams.get("username") || undefined
    });

    const [currentPage, setCurrentPage] = useState<number>(0);
    const [pageSize, setPageSize] = useStoredPageSize("ssh-session-logs", 20);

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
            ...filters
        };
    }, [dateRange, currentPage, pageSize, filters]);

    const { data, isFetching, isLoading, refetch } = useQuery({
        ...logQueries.sshSessions({
            orgId: orgId as string,
            filters: queryFilters
        }),
        enabled: isPaidUser(tierMatrix.sshSessionLogs) && build !== "oss"
    });

    const rows = isLoading ? generateSampleSshSessionLogs() : (data?.log ?? []);
    const totalCount = data?.pagination?.total ?? 0;
    const filterAttributes = data?.filterAttributes ?? {
        resources: [],
        sites: [],
        clients: [],
        users: [],
        usernames: []
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

    const handleRefresh = () => {
        // When the end date has no explicit time, it represents an
        // open-ended "up to now" upper bound. Since dateRange is only
        // recomputed on user interaction, that upper bound otherwise stays
        // frozen at whenever the page first loaded, so refreshing would
        // never surface logs created since then. Bump it to the current
        // time so the query key changes and refetches the latest window.
        if (dateRange.endDate?.date && !dateRange.endDate.time) {
            setDateRange((prev) => ({
                ...prev,
                endDate: { date: new Date() }
            }));
        } else {
            refetch();
        }
    };

    const handlePageSizeChange = (newPageSize: number) => {
        setPageSize(newPageSize);
        setCurrentPage(0);
    };

    const handleFilterChange = (
        filterType: keyof typeof filters,
        value: string | undefined
    ) => {
        applyFilters({ ...filters, [filterType]: value });
    };

    const applyFilters = (newFilters: typeof filters) => {
        setFilters(newFilters);
        setCurrentPage(0);
        updateUrlParamsForAllFilters(newFilters);
    };

    // Site resources and public resources (browser terminal sessions) share
    // one filter, so options are keyed by type as well as id.
    const selectedResource = filters.siteResourceId
        ? `site:${filters.siteResourceId}`
        : filters.resourceId
          ? `public:${filters.resourceId}`
          : undefined;

    const handleResourceFilterChange = (value: string | undefined) => {
        const [type, id] = value?.split(":") ?? [];
        applyFilters({
            ...filters,
            siteResourceId: type === "site" ? id : undefined,
            resourceId: type === "public" ? id : undefined
        });
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

            const response = await api.get(`/org/${orgId}/logs/ssh/export`, {
                responseType: "blob",
                params
            });

            const url = window.URL.createObjectURL(new Blob([response.data]));
            const link = document.createElement("a");
            link.href = url;
            const epoch = Math.floor(Date.now() / 1000);
            link.setAttribute(
                "download",
                `ssh-session-logs-${orgId}-${epoch}.csv`
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

    const columns: ColumnDef<SshSessionRow>[] = [
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
            accessorKey: "transport",
            header: () => {
                return (
                    <div className="flex items-center gap-2 px-2">
                        <ColumnFilterButton
                            options={[
                                { value: "ssh", label: t("sshTransportSsh") },
                                {
                                    value: "browser",
                                    label: t("sshTransportBrowser")
                                }
                            ]}
                            label={t("sshTransport")}
                            selectedValue={filters.transport}
                            onValueChange={(value) =>
                                handleFilterChange("transport", value)
                            }
                            searchPlaceholder={t("searchPlaceholder")}
                            emptyMessage={t("emptySearchOptions")}
                        />
                    </div>
                );
            },
            cell: ({ row }) => {
                const browser = row.original.transport === "browser";
                const Icon = browser ? AppWindow : SquareTerminal;
                return (
                    <span className="flex items-center gap-1 whitespace-nowrap">
                        <Icon className="h-4 w-4" />
                        {browser
                            ? t("sshTransportBrowser")
                            : t("sshTransportSsh")}
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
                                value: `${res.type}:${res.id}`,
                                label: res.name || "Unnamed Resource"
                            }))}
                            label={t("resource")}
                            selectedValue={selectedResource}
                            onValueChange={handleResourceFilterChange}
                            searchPlaceholder={t("searchPlaceholder")}
                            emptyMessage={t("emptySearchOptions")}
                        />
                    </div>
                );
            },
            cell: ({ row }) => {
                if (
                    !row.original.resourceNiceId ||
                    !row.original.resourceName
                ) {
                    return (
                        <span className="text-xs text-muted-foreground">-</span>
                    );
                }
                return (
                    <Link
                        href={
                            row.original.resourceType === "public"
                                ? getPublicResourceSettingsHref(
                                      row.original.orgId,
                                      row.original.resourceNiceId
                                  )
                                : getPrivateResourceSettingsHref(
                                      row.original.orgId,
                                      row.original.resourceNiceId
                                  )
                        }
                        onClick={(e) => e.stopPropagation()}
                    >
                        <Button variant="outline" size="sm">
                            {row.original.resourceName}
                            <ArrowUpRight className="ml-2 h-3 w-3" />
                        </Button>
                    </Link>
                );
            }
        },
        {
            accessorKey: "siteName",
            header: () => {
                return (
                    <div className="flex items-center gap-2 px-2">
                        <ColumnFilterButton
                            options={filterAttributes.sites.map((site) => ({
                                value: site.id.toString(),
                                label: site.name || "Unnamed Site"
                            }))}
                            label={t("site")}
                            selectedValue={filters.siteId}
                            onValueChange={(value) =>
                                handleFilterChange("siteId", value)
                            }
                            searchPlaceholder={t("searchPlaceholder")}
                            emptyMessage={t("emptySearchOptions")}
                        />
                    </div>
                );
            },
            cell: ({ row }) => {
                if (!row.original.siteName || !row.original.siteNiceId) {
                    return (
                        <span className="text-xs text-muted-foreground">-</span>
                    );
                }
                return (
                    <Link
                        href={`/${row.original.orgId}/settings/sites/${row.original.siteNiceId}`}
                        onClick={(e) => e.stopPropagation()}
                    >
                        <Button variant="outline" size="sm">
                            {row.original.siteName}
                            <ArrowUpRight className="ml-2 h-3 w-3" />
                        </Button>
                    </Link>
                );
            }
        },
        {
            accessorKey: "username",
            header: () => {
                return (
                    <div className="flex items-center gap-2 px-2">
                        <ColumnFilterButton
                            options={filterAttributes.usernames.map(
                                (username) => ({
                                    value: username,
                                    label: username
                                })
                            )}
                            label={t("sshSystemUser")}
                            selectedValue={filters.username}
                            onValueChange={(value) =>
                                handleFilterChange("username", value)
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
                        {row.original.username}
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
                return <span className="text-xs text-muted-foreground">-</span>;
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
                            onClick={(e) => e.stopPropagation()}
                        >
                            <Button variant="outline" size="sm">
                                <Laptop className="mr-1 h-3 w-3" />
                                {row.original.clientName}
                                <ArrowUpRight className="ml-2 h-3 w-3" />
                            </Button>
                        </Link>
                    );
                }
                return <span className="text-xs text-muted-foreground">-</span>;
            }
        },
        {
            accessorKey: "commandCount",
            header: () => <span className="px-2">{t("sshCommands")}</span>,
            cell: ({ row }) => {
                return (
                    <span className="whitespace-nowrap">
                        {row.original.commandCount.toLocaleString()}
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

    const renderExpandedRow = (row: SshSessionRow) => {
        return (
            <div className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs">
                    <div className="space-y-2">
                        <div>
                            <strong>{t("sshSessionId")}:</strong>{" "}
                            <span className="font-mono break-all">
                                {row.sessionId}
                            </span>
                        </div>
                        <div>
                            <strong>{t("sourceAddress")}:</strong>{" "}
                            <span className="font-mono">{row.sourceAddr}</span>
                        </div>
                        <div>
                            <strong>{t("destinationAddress")}:</strong>{" "}
                            <span className="font-mono">{row.destAddr}</span>
                        </div>
                    </div>
                    <div className="space-y-2">
                        <div>
                            <strong>{t("sshTransport")}:</strong>{" "}
                            {row.transport === "browser"
                                ? t("sshTransportBrowser")
                                : t("sshTransportSsh")}
                        </div>
                        <div>
                            <strong>{t("sshAuthMethod")}:</strong>{" "}
                            {row.authMethod ?? "-"}
                        </div>
                        <div>
                            <strong>{t("sshKeyFingerprint")}:</strong>{" "}
                            <span className="font-mono break-all">
                                {row.keyFingerprint ?? "-"}
                            </span>
                        </div>
                        <div>
                            <strong>{t("sshCertKeyId")}:</strong>{" "}
                            <span className="font-mono break-all">
                                {row.certKeyId ?? "-"}
                            </span>
                        </div>
                    </div>
                    <div className="space-y-2">
                        <div>
                            <strong>{t("sshStartedAt")}:</strong>{" "}
                            {new Date(row.startedAt * 1000).toLocaleString()}
                        </div>
                        <div>
                            <strong>{t("sshEndedAt")}:</strong>{" "}
                            {row.endedAt
                                ? new Date(row.endedAt * 1000).toLocaleString()
                                : "Active"}
                        </div>
                        <div>
                            <strong>{t("duration")}:</strong>{" "}
                            {formatDuration(row.startedAt, row.endedAt)}
                        </div>
                    </div>
                </div>
                <SshSessionCommandView
                    orgId={orgId as string}
                    sshSessionLogId={row.id}
                />
            </div>
        );
    };

    return (
        <>
            <SettingsSectionTitle
                title={t("sshSessionLogs")}
                description={t("sshSessionLogsDescription")}
            />

            <PaidFeaturesAlert tiers={tierMatrix.sshSessionLogs} />

            {org.org.settingsLogRetentionDaysSsh === 0 && (
                <LogRetentionWarning
                    orgId={orgId as string}
                    logTypeLabel={t("sshSessionLogs")}
                />
            )}

            <LogDataTable
                columns={columns}
                data={rows}
                title={t("sshSessionLogs")}
                searchPlaceholder={t("searchLogs")}
                searchColumn="username"
                onRefresh={handleRefresh}
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
                    !isPaidUser(tierMatrix.sshSessionLogs) || build === "oss"
                }
            />
        </>
    );
}

function generateSampleSshSessionLogs(): SshSessionRow[] {
    const usernames = ["root", "ubuntu", "deploy"];
    const now = Math.floor(Date.now() / 1000);
    const sevenDaysAgo = now - 7 * 24 * 60 * 60;

    return Array.from({ length: 10 }, (_, i) => {
        const startedAt = Math.floor(
            sevenDaysAgo + Math.random() * (now - sevenDaysAgo)
        );
        const active = Math.random() > 0.7;

        return {
            id: i,
            sessionId: `session-${i}`,
            orgId: "sample-org",
            siteId: 1,
            siteResourceId: (i % 3) + 1,
            resourceId: null,
            clientId: (i % 4) + 1,
            userId: `user-${i}`,
            transport: "ssh",
            sourceAddr: `100.90.128.${i + 2}:${40000 + i}`,
            destAddr: "100.90.128.1:22",
            username: usernames[i % usernames.length],
            authMethod: "certificate",
            keyFingerprint: null,
            certKeyId: null,
            commandCount: Math.floor(Math.random() * 50),
            startedAt,
            endedAt: active
                ? null
                : startedAt + Math.floor(Math.random() * 3600),
            resourceType: "site",
            resourceName: `Resource ${(i % 3) + 1}`,
            resourceNiceId: `resource-${(i % 3) + 1}`,
            siteName: "Sample Site",
            siteNiceId: "sample-site",
            clientName: `Client ${(i % 4) + 1}`,
            clientNiceId: `client-${(i % 4) + 1}`,
            clientType: "user",
            userEmail: `user${i}@example.com`
        };
    });
}
