"use client";
import { Button } from "@app/components/ui/button";
import { toast } from "@app/hooks/useToast";
import { useState, useTransition, useMemo } from "react";
import { createApiClient } from "@app/lib/api";
import { useEnvContext } from "@app/hooks/useEnvContext";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { LogDataTable } from "@app/components/LogDataTable";
import { ColumnDef } from "@tanstack/react-table";
import { DateTimeValue } from "@app/components/DateTimePicker";
import { ArrowUpRight, Key, User } from "lucide-react";
import Link from "next/link";
import { ColumnFilterButton } from "@app/components/ColumnFilterButton";
import { ColumnMultiFilterButton } from "@app/components/ColumnMultiFilterButton";
import SettingsSectionTitle from "@app/components/SettingsSectionTitle";
import { build } from "@server/build";
import { getSevenDaysAgo } from "@app/lib/getSevenDaysAgo";
import { getPrivateResourceSettingsHref } from "@app/lib/launcherResourceAdminHref";
import axios from "axios";
import { useStoredPageSize } from "@app/hooks/useStoredPageSize";
import { PaidFeaturesAlert } from "@app/components/PaidFeaturesAlert";
import LogRetentionWarning from "@app/components/LogRetentionWarning";
import { useOrgContext } from "@app/hooks/useOrgContext";
import { usePaidStatus } from "@app/hooks/usePaidStatus";
import { tierMatrix } from "@server/lib/billing/tierMatrix";
import { logQueries } from "@app/lib/queries";
import { useQuery } from "@tanstack/react-query";
import type { QueryAccessAuditLogResponse } from "@server/routers/auditLogs/types";
import { countryCodeToFlagEmoji } from "@app/lib/countryCodeToFlagEmoji";

export default function GeneralPage() {
    const router = useRouter();
    const searchParams = useSearchParams();
    const api = createApiClient(useEnvContext());
    const t = useTranslations();
    const { orgId } = useParams();

    const { org } = useOrgContext();
    const { isPaidUser } = usePaidStatus();

    const [isExporting, startTransition] = useTransition();

    const [filters, setFilters] = useState<{
        action?: string;
        type?: string;
        resourceId?: string;
        location?: string;
        actor?: string;
        ip?: string[];
    }>({
        action: searchParams.get("action") || undefined,
        type: searchParams.get("type") || undefined,
        resourceId: searchParams.get("resourceId") || undefined,
        location: searchParams.get("location") || undefined,
        actor: searchParams.get("actor") || undefined,
        ip: searchParams.getAll("ip") || undefined
    });

    const [currentPage, setCurrentPage] = useState<number>(0);
    const [pageSize, setPageSize] = useStoredPageSize("access-audit-logs", 20);

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
            resourceId: filters.resourceId
                ? Number(filters.resourceId)
                : undefined
        };
    }, [dateRange, currentPage, pageSize, filters]);

    const { data, isFetching, isLoading, refetch } = useQuery({
        ...logQueries.access({
            orgId: orgId as string,
            filters: queryFilters
        }),
        enabled: isPaidUser(tierMatrix.accessLogs) && build !== "oss"
    });

    const rows = isLoading ? generateSampleAccessLogs() : (data?.log ?? []);
    const totalCount = data?.pagination?.total ?? 0;
    const filterAttributes = data?.filterAttributes ?? {
        actors: [],
        resources: [],
        locations: []
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
        value: string | string[] | undefined
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
            params.delete(key);
            if (typeof value === "string") {
                params.set(key, value);
            } else if (typeof value !== "undefined" && "length" in value) {
                for (const element of value) {
                    params.append(key, element);
                }
            }
        });
        router.replace(`?${params.toString()}`, { scroll: false });
    };

    const exportData = async () => {
        try {
            const { ip, ...restFilters } = filters;
            const params: any = {
                timeStart: dateRange.startDate?.date
                    ? new Date(dateRange.startDate.date).toISOString()
                    : undefined,
                timeEnd: dateRange.endDate?.date
                    ? new Date(dateRange.endDate.date).toISOString()
                    : undefined,
                ...restFilters
            };

            // axios serializes arrays as `ip[]=…`, which express's query
            // parser does not read back as `ip`, so pass them in the URL
            const sp = new URLSearchParams((ip ?? []).map((ip) => ["ip", ip]));

            const response = await api.get(
                `/org/${orgId}/logs/access/export?${sp.toString()}`,
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
                `access-audit-logs-${orgId}-${epoch}.csv`
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
            accessorKey: "timestamp",
            header: () => {
                return <span className="px-2">{t("timestamp")}</span>;
            },
            cell: ({ row }) => {
                return (
                    <div className="whitespace-nowrap">
                        {new Date(
                            row.original.timestamp * 1000
                        ).toLocaleString()}
                    </div>
                );
            }
        },
        {
            accessorKey: "action",
            header: () => {
                return (
                    <div className="flex items-center gap-2 px-2">
                        <ColumnFilterButton
                            options={[
                                { value: "true", label: "Allowed" },
                                { value: "false", label: "Denied" }
                            ]}
                            label={t("action")}
                            selectedValue={filters.action}
                            onValueChange={(value) =>
                                handleFilterChange("action", value)
                            }
                            searchPlaceholder={t("searchPlaceholder")}
                            emptyMessage={t("emptySearchOptions")}
                        />
                    </div>
                );
            },
            cell: ({ row }) => {
                return (
                    <span className="flex items-center gap-1">
                        {row.original.action ? <>Allowed</> : <>Denied</>}
                    </span>
                );
            }
        },
        {
            accessorKey: "ip",
            header: () => (
                <span className="px-2">
                    <ColumnMultiFilterButton
                        options={(filters.ip ?? []).map((ip) => ({
                            label: ip,
                            value: ip
                        }))}
                        label={t("ip")}
                        allowArbitraryValues
                        searchPlaceholder={t("ipFilterSearchPlaceholder")}
                        emptyMessage={t("ipFilterEmptyMessage")}
                        selectedValues={filters.ip ?? []}
                        onSelectedValuesChange={(value) =>
                            handleFilterChange("ip", value)
                        }
                    />
                </span>
            ),
            cell: ({ row }) => {
                return row.original.ip ? (
                    row.original.ip
                ) : (
                    <span className="text-xs text-muted-foreground">-</span>
                );
            }
        },
        {
            accessorKey: "location",
            header: () => {
                return (
                    <div className="flex items-center gap-2 px-2">
                        <ColumnFilterButton
                            options={filterAttributes.locations.map(
                                (location) => ({
                                    value: location,
                                    label: `${location} ${countryCodeToFlagEmoji(location)}`
                                })
                            )}
                            label={t("location")}
                            selectedValue={filters.location}
                            onValueChange={(value) =>
                                handleFilterChange("location", value)
                            }
                            searchPlaceholder={t("searchPlaceholder")}
                            emptyMessage={t("emptySearchOptions")}
                        />
                    </div>
                );
            },
            cell: ({ row }) => {
                return (
                    <span className="flex items-center gap-1">
                        {row.original.location ? (
                            <span className="text-muted-foreground text-xs">
                                {row.original.location}{" "}
                                {countryCodeToFlagEmoji(row.original.location)}
                            </span>
                        ) : (
                            <span className="text-muted-foreground text-xs">
                                -
                            </span>
                        )}
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
                            selectedValue={filters.resourceId}
                            onValueChange={(value) =>
                                handleFilterChange("resourceId", value)
                            }
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
                            row.original.siteResourceId != null
                                ? getPrivateResourceSettingsHref(
                                      row.original.orgId,
                                      row.original.resourceNiceId
                                  )
                                : `/${row.original.orgId}/settings/resources/public/${row.original.resourceNiceId}`
                        }
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
            accessorKey: "type",
            header: () => {
                return (
                    <div className="flex items-center gap-2 px-2">
                        <ColumnFilterButton
                            options={[
                                { value: "password", label: "Password" },
                                { value: "pincode", label: "Pincode" },
                                { value: "login", label: "Login" },
                                {
                                    value: "whitelistedEmail",
                                    label: "Whitelisted Email"
                                },
                                { value: "ssh", label: "SSH" },
                                { value: "rdp", label: "RDP" },
                                { value: "vnc", label: "VNC" }
                            ]}
                            label={t("type")}
                            selectedValue={filters.type}
                            onValueChange={(value) =>
                                handleFilterChange("type", value)
                            }
                            searchPlaceholder={t("searchPlaceholder")}
                            emptyMessage={t("emptySearchOptions")}
                        />
                    </div>
                );
            },
            cell: ({ row }) => {
                const typeLabel = row.original.type
                    ? row.original.type === "ssh" ||
                      row.original.type === "rdp" ||
                      row.original.type === "vnc"
                        ? row.original.type.toUpperCase()
                        : row.original.type.charAt(0).toUpperCase() +
                          row.original.type.slice(1)
                    : null;
                return typeLabel ? (
                    <span>{typeLabel}</span>
                ) : (
                    <span className="text-xs text-muted-foreground">-</span>
                );
            }
        },
        {
            accessorKey: "actor",
            header: () => {
                return (
                    <div className="flex items-center gap-2 px-2">
                        <ColumnFilterButton
                            options={filterAttributes.actors.map((actor) => ({
                                value: actor,
                                label: actor
                            }))}
                            label={t("actor")}
                            selectedValue={filters.actor}
                            onValueChange={(value) =>
                                handleFilterChange("actor", value)
                            }
                            searchPlaceholder={t("searchPlaceholder")}
                            emptyMessage={t("emptySearchOptions")}
                        />
                    </div>
                );
            },
            cell: ({ row }) => {
                return (
                    <span className="flex items-center gap-1">
                        {row.original.actor ? (
                            <>
                                {row.original.actorType == "user" ? (
                                    <User className="h-4 w-4" />
                                ) : (
                                    <Key className="h-4 w-4" />
                                )}
                                {row.original.actor}
                            </>
                        ) : (
                            <span className="text-xs text-muted-foreground">
                                -
                            </span>
                        )}
                    </span>
                );
            }
        },
        {
            accessorKey: "actorId",
            header: () => <span className="px-2">{t("actorId")}</span>,
            cell: ({ row }) => (
                <span className="flex items-center gap-1">
                    {row.original.actorId || (
                        <span className="text-xs text-muted-foreground">-</span>
                    )}
                </span>
            )
        }
    ];

    const renderExpandedRow = (row: any) => {
        return (
            <div className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
                    {row.userAgent != "node" && (
                        <div>
                            <strong>User Agent:</strong>
                            <p className="text-muted-foreground mt-1 break-all">
                                {row.userAgent || "N/A"}
                            </p>
                        </div>
                    )}
                    <div>
                        <strong>Metadata:</strong>
                        <pre className="text-muted-foreground mt-1 text-xs bg-background p-2 rounded border overflow-auto">
                            {row.metadata
                                ? JSON.stringify(
                                      JSON.parse(row.metadata),
                                      null,
                                      2
                                  )
                                : "N/A"}
                        </pre>
                    </div>
                </div>
            </div>
        );
    };

    return (
        <>
            <SettingsSectionTitle
                title={t("accessLogs")}
                description={t("accessLogsDescription")}
            />

            <PaidFeaturesAlert tiers={tierMatrix.accessLogs} />

            {org.org.settingsLogRetentionDaysAccess === 0 && (
                <LogRetentionWarning
                    orgId={orgId as string}
                    logTypeLabel={t("accessLogs")}
                />
            )}

            <LogDataTable
                columns={columns}
                data={rows}
                title={t("accessLogs")}
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
                    id: "timestamp",
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
                disabled={!isPaidUser(tierMatrix.accessLogs) || build === "oss"}
            />
        </>
    );
}

function generateSampleAccessLogs(): QueryAccessAuditLogResponse["log"] {
    const locations = ["US", "DE", "GB", "FR", "JP", "CA", "AU"];
    const types = [
        "password",
        "pincode",
        "login",
        "whitelistedEmail",
        "ssh",
        "rdp",
        "vnc"
    ];
    const actors = [
        "alice@example.com",
        "bob@example.com",
        "carol@example.com",
        null
    ];

    const now = Math.floor(Date.now() / 1000);
    const sevenDaysAgo = now - 7 * 24 * 60 * 60;

    return Array.from({ length: 10 }, (_, i) => {
        const action = Math.random() > 0.3;
        const actor = actors[Math.floor(Math.random() * actors.length)];

        return {
            timestamp: Math.floor(
                sevenDaysAgo + Math.random() * (now - sevenDaysAgo)
            ),
            action,
            orgId: "sample-org",
            actorType: actor ? "user" : null,
            actor,
            actorId: actor ? `user-${i}` : null,
            resourceId: Math.floor(Math.random() * 5) + 1,
            siteResourceId: null,
            resourceNiceId: `resource-${(i % 3) + 1}`,
            resourceName: `Resource ${(i % 3) + 1}`,
            ip: `${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}`,
            location: locations[Math.floor(Math.random() * locations.length)],
            userAgent: "Mozilla/5.0",
            metadata: null,
            type: types[Math.floor(Math.random() * types.length)]
        };
    });
}
