"use client";
import { Button } from "@app/components/ui/button";
import { toast } from "@app/hooks/useToast";
import { useState, useRef, useEffect } from "react";
import { createApiClient } from "@app/lib/api";
import { useEnvContext } from "@app/hooks/useEnvContext";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { getStoredPageSize, LogDataTable, setStoredPageSize } from "@app/components/LogDataTable";
import { ColumnDef } from "@tanstack/react-table";
import { DateTimeValue } from "@app/components/DateTimePicker";
import { Key, RouteOff, User, Lock, Unlock, ArrowUpRight } from "lucide-react";
import Link from "next/link";
import { ColumnFilter } from "@app/components/ColumnFilter";
import SettingsSectionTitle from "@app/components/SettingsSectionTitle";

export default function GeneralPage() {
    const router = useRouter();
    const api = createApiClient(useEnvContext());
    const t = useTranslations();
    const { env } = useEnvContext();
    const { orgId } = useParams();
    const searchParams = useSearchParams();

    const [rows, setRows] = useState<any[]>([]);
    const [isRefreshing, setIsRefreshing] = useState(false);
    const [isExporting, setIsExporting] = useState(false);

    // Pagination state
    const [totalCount, setTotalCount] = useState<number>(0);
    const [currentPage, setCurrentPage] = useState<number>(0);
    const [isLoading, setIsLoading] = useState(false);

    // Initialize page size from storage or default
    const [pageSize, setPageSize] = useState<number>(() => {
        return getStoredPageSize("request-audit-logs", 20);
    });

    const [filterAttributes, setFilterAttributes] = useState<{
        actors: string[];
        resources: {
            id: number;
            name: string | null;
        }[];
        locations: string[];
        hosts: string[];
        paths: string[];
    }>({
        actors: [],
        resources: [],
        locations: [],
        hosts: [],
        paths: []
    });

    // Filter states - unified object for all filters
    const [filters, setFilters] = useState<{
        action?: string;
        resourceId?: string;
        host?: string;
        location?: string;
        actor?: string;
        method?: string;
        reason?: string;
        path?: string;
    }>({
        action: searchParams.get("action") || undefined,
        host: searchParams.get("host") || undefined,
        resourceId: searchParams.get("resourceId") || undefined,
        location: searchParams.get("location") || undefined,
        actor: searchParams.get("actor") || undefined,
        method: searchParams.get("method") || undefined,
        reason: searchParams.get("reason") || undefined,
        path: searchParams.get("path") || undefined
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
        setStoredPageSize(newPageSize, "request-audit-logs");
        setCurrentPage(0); // Reset to first page when changing page size
        queryDateTime(dateRange.startDate, dateRange.endDate, 0, newPageSize);
    };

    // Handle filter changes generically
    const handleFilterChange = (
        filterType: keyof typeof filters,
        value: string | undefined
    ) => {
        console.log(`${filterType} filter changed:`, value);

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
            type?: string;
        }
    ) => {
        console.log("Date range changed:", { startDate, endDate, page, size });
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

            const res = await api.get(`/org/${orgId}/logs/request`, { params });
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

            const response = await api.get(
                `/org/${orgId}/logs/request/export`,
                {
                    responseType: "blob",
                    params
                }
            );

            // Create a URL for the blob and trigger a download
            const url = window.URL.createObjectURL(new Blob([response.data]));
            const link = document.createElement("a");
            link.href = url;
            const epoch = Math.floor(Date.now() / 1000);
            link.setAttribute(
                "download",
                `request-audit-logs-${orgId}-${epoch}.csv`
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

    // 100 - Allowed by Rule
    // 101 - Allowed No Auth
    // 102 - Valid Access Token
    // 103 - Valid header auth
    // 104 - Valid Pincode
    // 105 - Valid Password
    // 106 - Valid email
    // 107 - Valid SSO

    // 201 - Resource Not Found
    // 202 - Resource Blocked
    // 203 - Dropped by Rule
    // 204 - No Sessions
    // 205 - Temporary Request Token
    // 299 - No More Auth Methods

    const reasonMap: any = {
        100: t("allowedByRule"),
        101: t("allowedNoAuth"),
        102: t("validAccessToken"),
        103: t("validHeaderAuth"),
        104: t("validPincode"),
        105: t("validPassword"),
        106: t("validEmail"),
        107: t("validSSO"),
        201: t("resourceNotFound"),
        202: t("resourceBlocked"),
        203: t("droppedByRule"),
        204: t("noSessions"),
        205: t("temporaryRequestToken"),
        299: t("noMoreAuthMethods")
    };

    // resourceId: integer("resourceId"),
    // userAgent: text("userAgent"),
    // metadata: text("details"),
    // headers: text("headers"), // JSON blob
    // query: text("query"), // JSON blob
    // originalRequestURL: text("originalRequestURL"),
    // scheme: text("scheme"),

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
                            options={[
                                { value: "true", label: "Allowed" },
                                { value: "false", label: "Denied" }
                            ]}
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
                    <span className="flex items-center gap-1">
                        {row.original.action ? <>Allowed</> : <>Denied</>}
                    </span>
                );
            }
        },
        {
            accessorKey: "ip",
            header: ({ column }) => {
                return t("ip");
            }
        },
        {
            accessorKey: "location",
            header: ({ column }) => {
                return (
                    <div className="flex items-center gap-2">
                        <span>{t("location")}</span>
                        <ColumnFilter
                            options={filterAttributes.locations.map(
                                (location) => ({
                                    value: location,
                                    label: location
                                })
                            )}
                            selectedValue={filters.location}
                            onValueChange={(value) =>
                                handleFilterChange("location", value)
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
                        {row.original.location ? (
                            <span className="text-muted-foreground text-xs">
                                {row.original.location}
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
            header: ({ column }) => {
                return (
                    <div className="flex items-center gap-2">
                        <span>{t("resource")}</span>
                        <ColumnFilter
                            options={filterAttributes.resources.map((res) => ({
                                value: res.id.toString(),
                                label: res.name || "Unnamed Resource"
                            }))}
                            selectedValue={filters.resourceId}
                            onValueChange={(value) =>
                                handleFilterChange("resourceId", value)
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
                    <Link
                        href={`/${row.original.orgId}/settings/resources/${row.original.resourceNiceId}`}
                        onClick={(e) => e.stopPropagation()}
                    >
                        <Button
                            variant="outline"
                            size="sm"
                            className="text-xs h-6"
                        >
                            {row.original.resourceName}
                            <ArrowUpRight className="ml-2 h-3 w-3" />
                        </Button>
                    </Link>
                );
            }
        },
        {
            accessorKey: "host",
            header: ({ column }) => {
                return (
                    <div className="flex items-center gap-2">
                        <span>{t("host")}</span>
                        <ColumnFilter
                            options={filterAttributes.hosts.map((host) => ({
                                value: host,
                                label: host
                            }))}
                            selectedValue={filters.host}
                            onValueChange={(value) =>
                                handleFilterChange("host", value)
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
                        {row.original.tls ? (
                            <Lock className="h-4 w-4" />
                        ) : (
                            <Unlock className="h-4 w-4" />
                        )}
                        {row.original.host}
                    </span>
                );
            }
        },
        {
            accessorKey: "path",
            header: ({ column }) => {
                return (
                    <div className="flex items-center gap-2">
                        <span>{t("path")}</span>
                        <ColumnFilter
                            options={filterAttributes.paths.map((path) => ({
                                value: path,
                                label: path
                            }))}
                            selectedValue={filters.path}
                            onValueChange={(value) =>
                                handleFilterChange("path", value)
                            }
                            // placeholder=""
                            searchPlaceholder="Search..."
                            emptyMessage="None found"
                        />
                    </div>
                );
            }
        },

        // {
        //     accessorKey: "scheme",
        //     header: ({ column }) => {
        //         return t("scheme");
        //     },
        // },
        {
            accessorKey: "method",
            header: ({ column }) => {
                return (
                    <div className="flex items-center gap-2">
                        <span>{t("method")}</span>
                        <ColumnFilter
                            options={[
                                { value: "GET", label: "GET" },
                                { value: "POST", label: "POST" },
                                { value: "PUT", label: "PUT" },
                                { value: "DELETE", label: "DELETE" },
                                { value: "PATCH", label: "PATCH" },
                                { value: "HEAD", label: "HEAD" },
                                { value: "OPTIONS", label: "OPTIONS" }
                            ]}
                            selectedValue={filters.method}
                            onValueChange={(value) =>
                                handleFilterChange("method", value)
                            }
                            // placeholder=""
                            searchPlaceholder="Search..."
                            emptyMessage="None found"
                        />
                    </div>
                );
            }
        },
        {
            accessorKey: "reason",
            header: ({ column }) => {
                return (
                    <div className="flex items-center gap-2">
                        <span>{t("reason")}</span>
                        <ColumnFilter
                            options={[
                                { value: "100", label: t("allowedByRule") },
                                { value: "101", label: t("allowedNoAuth") },
                                { value: "102", label: t("validAccessToken") },
                                { value: "103", label: t("validHeaderAuth") },
                                { value: "104", label: t("validPincode") },
                                { value: "105", label: t("validPassword") },
                                { value: "106", label: t("validEmail") },
                                { value: "107", label: t("validSSO") },
                                { value: "201", label: t("resourceNotFound") },
                                { value: "202", label: t("resourceBlocked") },
                                { value: "203", label: t("droppedByRule") },
                                { value: "204", label: t("noSessions") },
                                {
                                    value: "205",
                                    label: t("temporaryRequestToken")
                                },
                                { value: "299", label: t("noMoreAuthMethods") }
                            ]}
                            selectedValue={filters.reason}
                            onValueChange={(value) =>
                                handleFilterChange("reason", value)
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
                        {reasonMap[row.original.reason]}
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
                            <>-</>
                        )}
                    </span>
                );
            }
        }
    ];

    const renderExpandedRow = (row: any) => {
        return (
            <div className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
                    {/* <div>
                        <strong>User Agent:</strong>
                        <p className="text-muted-foreground mt-1 break-all">
                            {row.userAgent || "N/A"}
                        </p>
                    </div> */}
                    <div>
                        <strong>Original URL:</strong>
                        <p className="text-muted-foreground mt-1 break-all">
                            {row.originalRequestURL || "N/A"}
                        </p>
                    </div>
                    {/* <div>
                        <strong>Scheme:</strong>
                        <p className="text-muted-foreground mt-1">
                            {row.scheme || "N/A"}
                        </p>
                    </div> */}
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
                    {row.headers && (
                        <div className="md:col-span-2">
                            <strong>Headers:</strong>
                            <pre className="text-muted-foreground mt-1 text-xs bg-background p-2 rounded border overflow-auto">
                                {JSON.stringify(
                                    JSON.parse(row.headers),
                                    null,
                                    2
                                )}
                            </pre>
                        </div>
                    )}
                    {row.query && (
                        <div className="md:col-span-2">
                            <strong>Query Parameters:</strong>
                            <pre className="text-muted-foreground mt-1 text-xs bg-background p-2 rounded border overflow-auto">
                                {JSON.stringify(JSON.parse(row.query), null, 2)}
                            </pre>
                        </div>
                    )}
                </div>
            </div>
        );
    };

    return (
        <>
            <SettingsSectionTitle
                title={t('requestLogs')}
                description={t('requestLogsDescription')}
            />

            <LogDataTable
                columns={columns}
                data={rows}
                title={t("requestLogs")}
                searchPlaceholder={t("searchLogs")}
                searchColumn="host"
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
                onPageChange={handlePageChange}
                onPageSizeChange={handlePageSizeChange}
                isLoading={isLoading}
                pageSize={pageSize}
                // Row expansion props
                expandable={true}
                renderExpandedRow={renderExpandedRow}
            />
        </>
    );
}