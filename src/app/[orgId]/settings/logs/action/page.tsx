"use client";
import { Button } from "@app/components/ui/button";
import { toast } from "@app/hooks/useToast";
import { useState, useRef, useEffect } from "react";
import { createApiClient } from "@app/lib/api";
import { useEnvContext } from "@app/hooks/useEnvContext";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import {
    getStoredPageSize,
    LogDataTable,
    setStoredPageSize
} from "@app/components/LogDataTable";
import { ColumnDef } from "@tanstack/react-table";
import { DateTimeValue } from "@app/components/DateTimePicker";
import { Key, User } from "lucide-react";
import { ColumnFilter } from "@app/components/ColumnFilter";
import SettingsSectionTitle from "@app/components/SettingsSectionTitle";
import { useSubscriptionStatusContext } from "@app/hooks/useSubscriptionStatusContext";
import { useLicenseStatusContext } from "@app/hooks/useLicenseStatusContext";
import { build } from "@server/build";
import { Alert, AlertDescription } from "@app/components/ui/alert";

export default function GeneralPage() {
    const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
    const router = useRouter();
    const api = createApiClient(useEnvContext());
    const t = useTranslations();
    const { env } = useEnvContext();
    const { orgId } = useParams();
    const searchParams = useSearchParams();
    const subscription = useSubscriptionStatusContext();
    const { isUnlocked } = useLicenseStatusContext();

    const [rows, setRows] = useState<any[]>([]);
    const [isRefreshing, setIsRefreshing] = useState(false);
    const [isExporting, setIsExporting] = useState(false);
    const [filterAttributes, setFilterAttributes] = useState<{
        actors: string[];
        actions: string[];
    }>({
        actors: [],
        actions: []
    });

    // Filter states - unified object for all filters
    const [filters, setFilters] = useState<{
        action?: string;
        actor?: string;
    }>({
        action: searchParams.get("action") || undefined,
        actor: searchParams.get("actor") || undefined
    });

    // Pagination state
    const [totalCount, setTotalCount] = useState<number>(0);
    const [currentPage, setCurrentPage] = useState<number>(0);
    const [isLoading, setIsLoading] = useState(false);

    // Initialize page size from storage or default
    const [pageSize, setPageSize] = useState<number>(() => {
        return getStoredPageSize("action-audit-logs", 20);
    });

    // Set default date range to last 24 hours
    const getDefaultDateRange = () => {
        // if the time is in the url params, use that instead
        const startParam = searchParams.get("start");
        const endParam = searchParams.get("end");
        if (startParam && endParam) {
            return {
                startDate: {
                    date: new Date(startParam)
                },
                endDate: {
                    date: new Date(endParam)
                }
            };
        }

        const now = new Date();
        const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);

        return {
            startDate: {
                date: yesterday
            },
            endDate: {
                date: now
            }
        };
    };

    const [dateRange, setDateRange] = useState<{
        startDate: DateTimeValue;
        endDate: DateTimeValue;
    }>(getDefaultDateRange());

    // Trigger search with default values on component mount
    useEffect(() => {
        const defaultRange = getDefaultDateRange();
        queryDateTime(
            defaultRange.startDate,
            defaultRange.endDate,
            0,
            pageSize
        );
    }, [orgId]); // Re-run if orgId changes

    const handleDateRangeChange = (
        startDate: DateTimeValue,
        endDate: DateTimeValue
    ) => {
        setDateRange({ startDate, endDate });
        setCurrentPage(0); // Reset to first page when filtering
        // put the search params in the url for the time
        updateUrlParamsForAllFilters({
            start: startDate.date?.toISOString() || "",
            end: endDate.date?.toISOString() || ""
        });

        queryDateTime(startDate, endDate, 0, pageSize);
    };

    // Handle page changes
    const handlePageChange = (newPage: number) => {
        setCurrentPage(newPage);
        queryDateTime(
            dateRange.startDate,
            dateRange.endDate,
            newPage,
            pageSize
        );
    };

    // Handle page size changes
    const handlePageSizeChange = (newPageSize: number) => {
        setPageSize(newPageSize);
        setStoredPageSize(newPageSize, "action-audit-logs");
        setCurrentPage(0); // Reset to first page when changing page size
        queryDateTime(dateRange.startDate, dateRange.endDate, 0, newPageSize);
    };

    // Handle filter changes generically
    const handleFilterChange = (
        filterType: keyof typeof filters,
        value: string | undefined
    ) => {
        // Create new filters object with updated value
        const newFilters = {
            ...filters,
            [filterType]: value
        };

        setFilters(newFilters);
        setCurrentPage(0); // Reset to first page when filtering

        // Update URL params
        updateUrlParamsForAllFilters(newFilters);

        // Trigger new query with updated filters (pass directly to avoid async state issues)
        queryDateTime(
            dateRange.startDate,
            dateRange.endDate,
            0,
            pageSize,
            newFilters
        );
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

    const queryDateTime = async (
        startDate: DateTimeValue,
        endDate: DateTimeValue,
        page: number = currentPage,
        size: number = pageSize,
        filtersParam?: {
            action?: string;
            actor?: string;
        }
    ) => {
        console.log("Date range changed:", { startDate, endDate, page, size });
        if (
            (build == "saas" && !subscription?.subscribed) ||
            (build == "enterprise" && !isUnlocked())
        ) {
            console.log(
                "Access denied: subscription inactive or license locked"
            );
            return;
        }
        setIsLoading(true);

        try {
            // Use the provided filters or fall back to current state
            const activeFilters = filtersParam || filters;

            // Convert the date/time values to API parameters
            const params: any = {
                limit: size,
                offset: page * size,
                ...activeFilters
            };

            if (startDate?.date) {
                const startDateTime = new Date(startDate.date);
                if (startDate.time) {
                    const [hours, minutes, seconds] = startDate.time
                        .split(":")
                        .map(Number);
                    startDateTime.setHours(hours, minutes, seconds || 0);
                }
                params.timeStart = startDateTime.toISOString();
            }

            if (endDate?.date) {
                const endDateTime = new Date(endDate.date);
                if (endDate.time) {
                    const [hours, minutes, seconds] = endDate.time
                        .split(":")
                        .map(Number);
                    endDateTime.setHours(hours, minutes, seconds || 0);
                } else {
                    // If no time is specified, set to NOW
                    const now = new Date();
                    endDateTime.setHours(
                        now.getHours(),
                        now.getMinutes(),
                        now.getSeconds(),
                        now.getMilliseconds()
                    );
                }
                params.timeEnd = endDateTime.toISOString();
            }

            const res = await api.get(`/org/${orgId}/logs/action`, { params });
            if (res.status === 200) {
                setRows(res.data.data.log || []);
                setTotalCount(res.data.data.pagination?.total || 0);
                setFilterAttributes(res.data.data.filterAttributes);
                console.log("Fetched logs:", res.data);
            }
        } catch (error) {
            toast({
                title: t("error"),
                description: t("Failed to filter logs"),
                variant: "destructive"
            });
        } finally {
            setIsLoading(false);
        }
    };

    const refreshData = async () => {
        console.log("Data refreshed");
        setIsRefreshing(true);
        try {
            // Refresh data with current date range and pagination
            await queryDateTime(
                dateRange.startDate,
                dateRange.endDate,
                currentPage,
                pageSize
            );
        } catch (error) {
            toast({
                title: t("error"),
                description: t("refreshError"),
                variant: "destructive"
            });
        } finally {
            setIsRefreshing(false);
        }
    };

    const exportData = async () => {
        try {
            setIsExporting(true);

            // Prepare query params for export
            const params: any = {
                timeStart: dateRange.startDate?.date
                    ? new Date(dateRange.startDate.date).toISOString()
                    : undefined,
                timeEnd: dateRange.endDate?.date
                    ? new Date(dateRange.endDate.date).toISOString()
                    : undefined,
                ...filters
            };

            const response = await api.get(`/org/${orgId}/logs/action/export`, {
                responseType: "blob",
                params
            });

            // Create a URL for the blob and trigger a download
            const url = window.URL.createObjectURL(new Blob([response.data]));
            const link = document.createElement("a");
            link.href = url;
            const epoch = Math.floor(Date.now() / 1000);
            link.setAttribute(
                "download",
                `action-audit-logs-${orgId}-${epoch}.csv`
            );
            document.body.appendChild(link);
            link.click();
            link.parentNode?.removeChild(link);
            setIsExporting(false);
        } catch (error) {
            toast({
                title: t("error"),
                description: t("exportError"),
                variant: "destructive"
            });
        }
    };

    const columns: ColumnDef<any>[] = [
        {
            accessorKey: "timestamp",
            header: ({ column }) => {
                return t("timestamp");
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
            header: ({ column }) => {
                return (
                    <div className="flex items-center gap-2">
                        <span>{t("action")}</span>
                        <ColumnFilter
                            options={filterAttributes.actions.map((action) => ({
                                label:
                                    action.charAt(0).toUpperCase() +
                                    action.slice(1),
                                value: action
                            }))}
                            selectedValue={filters.action}
                            onValueChange={(value) =>
                                handleFilterChange("action", value)
                            }
                            // placeholder=""
                            searchPlaceholder="Search..."
                            emptyMessage="None found"
                        />
                    </div>
                );
            },
            cell: ({ row }) => {
                return (
                    <span className="hitespace-nowrap">
                        {row.original.action.charAt(0).toUpperCase() +
                            row.original.action.slice(1)}
                    </span>
                );
            }
        },
        {
            accessorKey: "actor",
            header: ({ column }) => {
                return (
                    <div className="flex items-center gap-2">
                        <span>{t("actor")}</span>
                        <ColumnFilter
                            options={filterAttributes.actors.map((actor) => ({
                                value: actor,
                                label: actor
                            }))}
                            selectedValue={filters.actor}
                            onValueChange={(value) =>
                                handleFilterChange("actor", value)
                            }
                            // placeholder=""
                            searchPlaceholder="Search..."
                            emptyMessage="None found"
                        />
                    </div>
                );
            },
            cell: ({ row }) => {
                return (
                    <span className="flex items-center gap-1">
                        {row.original.actorType == "user" ? (
                            <User className="h-4 w-4" />
                        ) : (
                            <Key className="h-4 w-4" />
                        )}
                        {row.original.actor}
                    </span>
                );
            }
        },
        {
            accessorKey: "actorId",
            header: ({ column }) => {
                return t("actorId");
            },
            cell: ({ row }) => {
                return (
                    <span className="flex items-center gap-1">
                        {row.original.actorId}
                    </span>
                );
            }
        }
    ];

    const renderExpandedRow = (row: any) => {
        return (
            <div className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
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
                title={t("actionLogs")}
                description={t("actionLogsDescription")}
            />

            {build == "saas" && !subscription?.subscribed ? (
                <Alert variant="info" className="mb-6">
                    <AlertDescription>
                        {t("subscriptionRequiredToUse")}
                    </AlertDescription>
                </Alert>
            ) : null}

            {build == "enterprise" && !isUnlocked() ? (
                <Alert variant="info" className="mb-6">
                    <AlertDescription>
                        {t("licenseRequiredToUse")}
                    </AlertDescription>
                </Alert>
            ) : null}

            <LogDataTable
                columns={columns}
                data={rows}
                title={t("actionLogs")}
                searchPlaceholder={t("searchLogs")}
                searchColumn="action"
                onRefresh={refreshData}
                isRefreshing={isRefreshing}
                onExport={exportData}
                isExporting={isExporting}
                onDateRangeChange={handleDateRangeChange}
                dateRange={{
                    start: dateRange.startDate,
                    end: dateRange.endDate
                }}
                defaultSort={{
                    id: "timestamp",
                    desc: false
                }}
                // Server-side pagination props
                totalCount={totalCount}
                currentPage={currentPage}
                pageSize={pageSize}
                onPageChange={handlePageChange}
                onPageSizeChange={handlePageSizeChange}
                isLoading={isLoading}
                // Row expansion props
                expandable={true}
                renderExpandedRow={renderExpandedRow}
                disabled={
                    (build == "saas" && !subscription?.subscribed) ||
                    (build == "enterprise" && !isUnlocked())
                }
            />
        </>
    );
}
