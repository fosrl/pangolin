"use client";

import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow
} from "@/components/ui/table";
import { DataTablePagination } from "@app/components/DataTablePagination";
import { DateRangePicker, DateTimeValue } from "@app/components/DateTimePicker";
import { Button } from "@app/components/ui/button";
import { Card, CardContent, CardHeader } from "@app/components/ui/card";
import {
    ColumnDef,
    ColumnFiltersState,
    flexRender,
    getCoreRowModel,
    getFilteredRowModel,
    getPaginationRowModel,
    getSortedRowModel,
    SortingState,
    useReactTable
} from "@tanstack/react-table";
import {
    ChevronDown,
    ChevronRight,
    Download,
    Loader,
    LoaderIcon,
    RefreshCw
} from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useMemo, useState } from "react";
import {
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger
} from "./ui/tooltip";

const STORAGE_KEYS = {
    PAGE_SIZE: "datatable-page-size",
    getTablePageSize: (tableId?: string) =>
        tableId ? `${tableId}-size` : STORAGE_KEYS.PAGE_SIZE
};

export const getStoredPageSize = (
    tableId?: string,
    defaultSize = 20
): number => {
    if (typeof window === "undefined") return defaultSize;

    try {
        const key = STORAGE_KEYS.getTablePageSize(tableId);
        const stored = localStorage.getItem(key);
        if (stored) {
            const parsed = parseInt(stored, 10);
            // Validate that it's a reasonable page size
            if (parsed > 0 && parsed <= 1000) {
                return parsed;
            }
        }
    } catch (error) {
        console.warn("Failed to read page size from localStorage:", error);
    }
    return defaultSize;
};

export const setStoredPageSize = (pageSize: number, tableId?: string): void => {
    if (typeof window === "undefined") return;

    try {
        const key = STORAGE_KEYS.getTablePageSize(tableId);
        localStorage.setItem(key, pageSize.toString());
    } catch (error) {
        console.warn("Failed to save page size to localStorage:", error);
    }
};

type TabFilter = {
    id: string;
    label: string;
    filterFn: (row: any) => boolean;
};

type DataTableProps<TData, TValue> = {
    columns: ColumnDef<TData, TValue>[];
    data: TData[];
    title?: string;
    addButtonText?: string;
    onRefresh?: () => void;
    onExport?: () => void;
    isExporting?: boolean;
    isRefreshing?: boolean;
    searchPlaceholder?: string;
    searchColumn?: string;
    defaultSort?: {
        id: string;
        desc: boolean;
    };
    tabs?: TabFilter[];
    defaultTab?: string;
    disabled?: boolean;
    onDateRangeChange?: (
        startDate: DateTimeValue,
        endDate: DateTimeValue
    ) => void;
    dateRange?: {
        start: DateTimeValue;
        end: DateTimeValue;
    };
    // Server-side pagination props
    totalCount?: number;
    pageSize: number;
    currentPage?: number;
    onPageChange?: (page: number) => void;
    onPageSizeChange?: (pageSize: number) => void;
    isLoading?: boolean;
    // Row expansion props
    expandable?: boolean;
    renderExpandedRow?: (row: TData) => React.ReactNode;
    isExportDisabled?: boolean;
};

export function LogDataTable<TData, TValue>({
    columns,
    data,
    title,
    onRefresh,
    isRefreshing,
    onExport,
    isExporting,
    // searchPlaceholder = "Search...",
    // searchColumn = "name",
    defaultSort,
    tabs,
    defaultTab,
    onDateRangeChange,
    pageSize,
    dateRange,
    totalCount,
    currentPage = 0,
    onPageChange,
    onPageSizeChange: onPageSizeChangeProp,
    isLoading = false,
    expandable = false,
    disabled = false,
    renderExpandedRow,
    isExportDisabled
}: DataTableProps<TData, TValue>) {
    const t = useTranslations();

    const [sorting, setSorting] = useState<SortingState>(
        defaultSort ? [defaultSort] : []
    );
    const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);
    const [globalFilter, setGlobalFilter] = useState<any>([]);
    const [activeTab, setActiveTab] = useState<string>(
        defaultTab || tabs?.[0]?.id || ""
    );

    const [startDate, setStartDate] = useState<DateTimeValue>(
        dateRange?.start || {}
    );
    const [endDate, setEndDate] = useState<DateTimeValue>(dateRange?.end || {});
    const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());

    // Sync internal date state with external dateRange prop
    useEffect(() => {
        if (dateRange?.start) {
            setStartDate(dateRange.start);
        }
        if (dateRange?.end) {
            setEndDate(dateRange.end);
        }
    }, [dateRange?.start, dateRange?.end]);

    // Apply tab filter to data
    const filteredData = useMemo(() => {
        // If disabled, return empty array to prevent data loading
        if (disabled) {
            return [];
        }

        if (!tabs || activeTab === "") {
            return data;
        }

        const activeTabFilter = tabs.find((tab) => tab.id === activeTab);
        if (!activeTabFilter) {
            return data;
        }

        return data.filter(activeTabFilter.filterFn);
    }, [data, tabs, activeTab, disabled]);

    // Toggle row expansion
    const toggleRowExpansion = (rowId: string) => {
        setExpandedRows((prev) => {
            const newSet = new Set(prev);
            if (newSet.has(rowId)) {
                newSet.delete(rowId);
            } else {
                newSet.add(rowId);
            }
            return newSet;
        });
    };

    // Determine if using server-side pagination
    const isServerPagination = totalCount !== undefined;

    // Create columns with expansion column if expandable
    const enhancedColumns = useMemo(() => {
        if (!expandable) {
            return columns;
        }

        const expansionColumn: ColumnDef<TData, TValue> = {
            id: "expand",
            header: () => null,
            cell: ({ row }) => {
                const isExpanded = expandedRows.has(row.id);
                return (
                    <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 w-6 p-0"
                        disabled={disabled}
                        onClick={(e) => {
                            if (!disabled) {
                                toggleRowExpansion(row.id);
                                e.stopPropagation();
                            }
                        }}
                    >
                        {isExpanded ? (
                            <ChevronDown className="h-4 w-4" />
                        ) : (
                            <ChevronRight className="h-4 w-4" />
                        )}
                    </Button>
                );
            },
            size: 40
        };

        return [expansionColumn, ...columns];
    }, [columns, expandable, expandedRows, toggleRowExpansion, disabled]);

    const table = useReactTable({
        data: filteredData,
        columns: enhancedColumns,
        getCoreRowModel: getCoreRowModel(),
        // Only use client-side pagination if totalCount is not provided
        ...(isServerPagination
            ? {}
            : { getPaginationRowModel: getPaginationRowModel() }),
        onSortingChange: setSorting,
        // Disable client-side sorting for server-side pagination since data is already sorted on server
        ...(isServerPagination
            ? {}
            : { getSortedRowModel: getSortedRowModel() }),
        onColumnFiltersChange: setColumnFilters,
        getFilteredRowModel: getFilteredRowModel(),
        onGlobalFilterChange: setGlobalFilter,
        // Configure pagination state
        ...(isServerPagination
            ? {
                  manualPagination: true,
                  pageCount: totalCount ? Math.ceil(totalCount / pageSize) : 0
              }
            : {}),
        initialState: {
            sorting: defaultSort ? [defaultSort] : [],
            pagination: {
                pageSize: pageSize,
                pageIndex: currentPage
            }
        },
        state: {
            sorting,
            columnFilters,
            globalFilter,
            pagination: {
                pageSize: pageSize,
                pageIndex: currentPage
            }
        }
    });

    // useEffect(() => {
    //     const currentPageSize = table.getState().pagination.pageSize;
    //     if (currentPageSize !== pageSize) {
    //         table.setPageSize(pageSize);

    //         // Persist to localStorage if enabled
    //         if (persistPageSize) {
    //             setStoredPageSize(pageSize, tableId);
    //         }
    //     }
    // }, [pageSize, table, persistPageSize, tableId]);

    // Update table page index when currentPage prop changes (server pagination)
    useEffect(() => {
        if (isServerPagination) {
            const currentPageIndex = table.getState().pagination.pageIndex;
            if (currentPageIndex !== currentPage) {
                table.setPageIndex(currentPage);
            }
        }
    }, [currentPage, table, isServerPagination]);

    const handleTabChange = (value: string) => {
        if (disabled) return;

        setActiveTab(value);
        // Reset to first page when changing tabs
        table.setPageIndex(0);
    };

    // Enhanced pagination component that updates our local state
    const handlePageSizeChange = (newPageSize: number) => {
        if (disabled) return;

        // setPageSize(newPageSize);
        table.setPageSize(newPageSize);

        // Persist immediately when changed
        // if (persistPageSize) {
        //     setStoredPageSize(newPageSize, tableId);
        // }

        // For server pagination, notify parent component
        if (isServerPagination && onPageSizeChangeProp) {
            onPageSizeChangeProp(newPageSize);
        }
    };

    // Handle page changes for server pagination
    const handlePageChange = (newPageIndex: number) => {
        if (disabled) return;

        if (isServerPagination && onPageChange) {
            onPageChange(newPageIndex);
        }
    };

    const handleDateRangeChange = (
        start: DateTimeValue,
        end: DateTimeValue
    ) => {
        if (disabled) return;

        setStartDate(start);
        setEndDate(end);
        onDateRangeChange?.(start, end);
    };

    return (
        <div className="container mx-auto max-w-12xl">
            <Card>
                <CardHeader className="flex flex-col space-y-4 sm:flex-row sm:items-center sm:justify-between sm:space-y-0 pb-4">
                    <div className="flex flex-row items-start w-full sm:mr-2 gap-2">
                        {/* <div className="relative w-full sm:max-w-sm">
                            <Input
                                placeholder={searchPlaceholder}
                                value={globalFilter ?? ""}
                                onChange={(e) =>
                                    table.setGlobalFilter(
                                        String(e.target.value)
                                    )
                                }
                                className="w-full pl-8 m-0"
                            />
                            <Search className="h-4 w-4 absolute left-2 top-1/2 transform -translate-y-1/2 text-muted-foreground" />
                        </div> */}
                        <DateRangePicker
                            startValue={startDate}
                            endValue={endDate}
                            onRangeChange={handleDateRangeChange}
                            className="flex-wrap gap-2"
                            disabled={disabled}
                        />
                    </div>
                    <div className="flex items-start gap-2 sm:justify-end">
                        {onRefresh && (
                            <Button
                                variant="outline"
                                onClick={() => !disabled && onRefresh()}
                                disabled={isRefreshing || disabled}
                            >
                                <RefreshCw
                                    className={`mr-2 h-4 w-4 ${isRefreshing ? "animate-spin" : ""}`}
                                />
                                {t("refresh")}
                            </Button>
                        )}
                        {onExport && (
                            <TooltipProvider>
                                <Tooltip>
                                    <TooltipTrigger asChild>
                                        <Button
                                            onClick={() =>
                                                !disabled && onExport()
                                            }
                                            disabled={
                                                isExporting ||
                                                disabled ||
                                                isExportDisabled
                                            }
                                        >
                                            {isExporting ? (
                                                <Loader className="mr-2 size-4 animate-spin" />
                                            ) : (
                                                <Download className="mr-2 size-4" />
                                            )}
                                            {t("exportCsv")}
                                        </Button>
                                    </TooltipTrigger>
                                    <TooltipContent>
                                        {t("exportCsvTooltip")}
                                    </TooltipContent>
                                </Tooltip>
                            </TooltipProvider>
                        )}
                    </div>
                </CardHeader>
                <CardContent className="relative">
                    <Table>
                        <TableHeader>
                            {table.getHeaderGroups().map((headerGroup) => (
                                <TableRow key={headerGroup.id}>
                                    {headerGroup.headers.map((header) => (
                                        <TableHead key={header.id}>
                                            {header.isPlaceholder
                                                ? null
                                                : flexRender(
                                                      header.column.columnDef
                                                          .header,
                                                      header.getContext()
                                                  )}
                                        </TableHead>
                                    ))}
                                </TableRow>
                            ))}
                        </TableHeader>
                        <TableBody>
                            {table.getRowModel().rows?.length ? (
                                table
                                    .getRowModel()
                                    .rows.map((row) => {
                                        const isExpanded =
                                            expandable &&
                                            expandedRows.has(row.id);
                                        return [
                                            <TableRow
                                                key={row.id}
                                                data-state={
                                                    row.getIsSelected() &&
                                                    "selected"
                                                }
                                                onClick={() =>
                                                    expandable && !disabled
                                                        ? toggleRowExpansion(
                                                              row.id
                                                          )
                                                        : undefined
                                                }
                                                className="text-xs" // made smaller
                                            >
                                                {row
                                                    .getVisibleCells()
                                                    .map((cell) => {
                                                        const originalRow =
                                                            row.original as any;
                                                        const actionValue =
                                                            originalRow?.action;
                                                        let className = "";

                                                        if (
                                                            typeof actionValue ===
                                                            "boolean"
                                                        ) {
                                                            className =
                                                                actionValue
                                                                    ? "bg-green-100 dark:bg-green-900/50"
                                                                    : "bg-red-100 dark:bg-red-900/50";
                                                        }

                                                        return (
                                                            <TableCell
                                                                key={cell.id}
                                                                className={`${className} py-2`} // made smaller
                                                            >
                                                                {flexRender(
                                                                    cell.column
                                                                        .columnDef
                                                                        .cell,
                                                                    cell.getContext()
                                                                )}
                                                            </TableCell>
                                                        );
                                                    })}
                                            </TableRow>,
                                            isExpanded && renderExpandedRow && (
                                                <TableRow
                                                    key={`${row.id}-expanded`}
                                                >
                                                    <TableCell
                                                        colSpan={
                                                            enhancedColumns.length
                                                        }
                                                        className="p-4 bg-muted/50"
                                                    >
                                                        {renderExpandedRow(
                                                            row.original
                                                        )}
                                                    </TableCell>
                                                </TableRow>
                                            )
                                        ].filter(Boolean);
                                    })
                                    .flat()
                            ) : (
                                <TableRow>
                                    <TableCell
                                        colSpan={enhancedColumns.length}
                                        className="h-24 text-center"
                                    >
                                        No results found.
                                    </TableCell>
                                </TableRow>
                            )}
                        </TableBody>
                    </Table>

                    {isLoading && (
                        <>
                            <div className="backdrop-blur-[3px] z-10 absolute inset-0 top-10"></div>
                            <div className="absolute z-20 left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 border border-border rounded-md bg-muted">
                                <div className="flex items-center gap-2 p-6">
                                    <LoaderIcon className="size-4 animate-spin" />
                                    {t("loadingEllipsis")}
                                </div>
                            </div>
                        </>
                    )}

                    <div className="mt-4">
                        <DataTablePagination
                            table={table}
                            onPageSizeChange={handlePageSizeChange}
                            onPageChange={
                                isServerPagination
                                    ? handlePageChange
                                    : undefined
                            }
                            totalCount={totalCount}
                            isServerPagination={isServerPagination}
                            isLoading={isLoading}
                            disabled={disabled}
                            pageSize={pageSize}
                            pageIndex={currentPage}
                        />
                    </div>
                </CardContent>
            </Card>
        </div>
    );
}
