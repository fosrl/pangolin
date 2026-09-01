"use client";

import {
    ColumnDef,
    flexRender,
    getCoreRowModel,
    useReactTable,
    getPaginationRowModel,
    SortingState,
    getSortedRowModel,
    ColumnFiltersState,
    getFilteredRowModel,
    VisibilityState,
    PaginationState
} from "@tanstack/react-table";

// Extended ColumnDef type that includes optional friendlyName for column visibility dropdown
export type ExtendedColumnDef<TData, TValue = unknown> = ColumnDef<
    TData,
    TValue
> & {
    friendlyName?: string;
};
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow
} from "@/components/ui/table";
import { DataTableEmptyState } from "@/components/ui/data-table-empty-state";
import { Button } from "@app/components/ui/button";
import { useEffect, useMemo, useRef, useState } from "react";
import { Input } from "@app/components/ui/input";
import { DataTablePagination } from "@app/components/DataTablePagination";
import { dataTableFilterDropdownContentClassName } from "@app/lib/dataTableFilterPopover";
import {
    ChevronDown,
    Plus,
    Search,
    RefreshCw,
    Columns,
    Filter
} from "lucide-react";
import {
    Card,
    CardContent,
    CardHeader,
    CardTitle
} from "@app/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@app/components/ui/tabs";
import { useTranslations } from "next-intl";
import {
    DropdownMenu,
    DropdownMenuCheckboxItem,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger
} from "@app/components/ui/dropdown-menu";

const STORAGE_KEYS = {
    PAGE_SIZE: "datatable-page-size",
    COLUMN_VISIBILITY: "datatable-column-visibility",
    getTablePageSize: (tableId?: string) =>
        tableId ? `${tableId}-size` : STORAGE_KEYS.PAGE_SIZE,
    getTableColumnVisibility: (tableId?: string) =>
        tableId
            ? `${tableId}-column-visibility`
            : STORAGE_KEYS.COLUMN_VISIBILITY
};

const getStoredPageSize = (tableId?: string, defaultSize = 20): number => {
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

const setStoredPageSize = (pageSize: number, tableId?: string): void => {
    if (typeof window === "undefined") return;

    try {
        const key = STORAGE_KEYS.getTablePageSize(tableId);
        localStorage.setItem(key, pageSize.toString());
    } catch (error) {
        console.warn("Failed to save page size to localStorage:", error);
    }
};

const getStoredColumnVisibility = (
    tableId?: string,
    defaultVisibility?: Record<string, boolean>
): Record<string, boolean> => {
    if (typeof window === "undefined") return defaultVisibility || {};

    try {
        const key = STORAGE_KEYS.getTableColumnVisibility(tableId);
        const stored = localStorage.getItem(key);
        if (stored) {
            const parsed = JSON.parse(stored);
            // Validate that it's an object
            if (typeof parsed === "object" && parsed !== null) {
                return parsed;
            }
        }
    } catch (error) {
        console.warn(
            "Failed to read column visibility from localStorage:",
            error
        );
    }
    return defaultVisibility || {};
};

const setStoredColumnVisibility = (
    visibility: Record<string, boolean>,
    tableId?: string
): void => {
    if (typeof window === "undefined") return;

    try {
        const key = STORAGE_KEYS.getTableColumnVisibility(tableId);
        localStorage.setItem(key, JSON.stringify(visibility));
    } catch (error) {
        console.warn(
            "Failed to save column visibility to localStorage:",
            error
        );
    }
};

type TabFilter = {
    id: string;
    label: string;
    filterFn: (row: any) => boolean;
};

type FilterOption = {
    id: string;
    label: string;
    value: string | number | boolean;
};

type DataTableFilter = {
    id: string;
    label: string;
    options: FilterOption[];
    multiSelect?: boolean;
    filterFn: (
        row: any,
        selectedValues: (string | number | boolean)[]
    ) => boolean;
    defaultValues?: (string | number | boolean)[];
    displayMode?: "label" | "calculated"; // How to display the filter button text
};

export type DataTablePaginationState = PaginationState & {
    pageCount: number;
};

export type DataTablePaginationUpdateFn = (newPage: PaginationState) => void;

/** When set (non-empty), replaces the single add button with a dropdown; `onAdd` is not used. */
export type DataTableAddAction = {
    label: string;
    onSelect: () => void;
};

type DataTableProps<TData, TValue> = {
    columns: ExtendedColumnDef<TData, TValue>[];
    data: TData[];
    title?: string;
    addButtonText?: string;
    onAdd?: () => void;
    /** Prefer over `onAdd` when non-empty. */
    addActions?: DataTableAddAction[];
    addButtonDisabled?: boolean;
    onRefresh?: () => void;
    isRefreshing?: boolean;
    refreshButtonDisabled?: boolean;
    searchPlaceholder?: string;
    searchColumn?: string;
    defaultSort?: {
        id: string;
        desc: boolean;
    };
    tabs?: TabFilter[];
    defaultTab?: string;
    filters?: DataTableFilter[];
    filterDisplayMode?: "label" | "calculated"; // Global filter display mode (can be overridden per filter)
    persistPageSize?: boolean | string;
    defaultPageSize?: number;
    columnVisibility?: Record<string, boolean>;
    enableColumnVisibility?: boolean;
    manualFiltering?: boolean;
    /** When true, row order is controlled externally (e.g. server-side sorting). */
    manualSorting?: boolean;
    onSearch?: (input: string) => void;
    searchQuery?: string;
    pagination?: DataTablePaginationState;
    onPaginationChange?: DataTablePaginationUpdateFn;
    persistColumnVisibility?: boolean | string;
    stickyLeftColumn?: string; // Column ID or accessorKey for left sticky column
    stickyRightColumn?: string; // Column ID or accessorKey for right sticky column (typically "actions")
};

export function DataTable<TData, TValue>({
    columns,
    data,
    title,
    addButtonText,
    onAdd,
    addActions,
    addButtonDisabled = false,
    onRefresh,
    isRefreshing,
    refreshButtonDisabled = false,
    searchPlaceholder = "Search...",
    searchColumn = "name",
    defaultSort,
    tabs,
    defaultTab,
    filters,
    filterDisplayMode = "label",
    persistPageSize = false,
    defaultPageSize = 20,
    columnVisibility: defaultColumnVisibility,
    enableColumnVisibility = false,
    persistColumnVisibility = false,
    manualFiltering = false,
    manualSorting = false,
    pagination: paginationState,
    stickyLeftColumn,
    onSearch,
    searchQuery,
    onPaginationChange,
    stickyRightColumn
}: DataTableProps<TData, TValue>) {
    const t = useTranslations();

    // Determine table identifier for storage
    // Use persistPageSize string if provided, otherwise use persistColumnVisibility string, otherwise undefined
    const tableId =
        typeof persistPageSize === "string"
            ? persistPageSize
            : typeof persistColumnVisibility === "string"
              ? persistColumnVisibility
              : undefined;

    // Auto-enable persistence if column visibility is enabled
    // Use explicit persistColumnVisibility if provided, otherwise auto-enable when enableColumnVisibility is true and we have a tableId
    const shouldPersistColumnVisibility =
        persistColumnVisibility === true ||
        typeof persistColumnVisibility === "string" ||
        (enableColumnVisibility && tableId !== undefined);

    // Compute initial column visibility (from localStorage if enabled, otherwise from prop/default)
    const initialColumnVisibility = (() => {
        if (shouldPersistColumnVisibility) {
            return getStoredColumnVisibility(tableId, defaultColumnVisibility);
        }
        return defaultColumnVisibility || {};
    })();

    // Initialize page size from storage or default
    const [pageSize, setPageSize] = useState<number>(() => {
        if (persistPageSize) {
            return getStoredPageSize(tableId, defaultPageSize);
        }
        return defaultPageSize;
    });

    const [sorting, setSorting] = useState<SortingState>(
        defaultSort ? [defaultSort] : []
    );
    const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);
    const [globalFilter, setGlobalFilter] = useState<any>([]);
    const [columnVisibility, setColumnVisibility] = useState<VisibilityState>(
        initialColumnVisibility
    );
    const [_pagination, setPagination] = useState<PaginationState>({
        pageIndex: 0,
        pageSize: pageSize
    });

    const pagination = paginationState ?? _pagination;

    const [activeTab, setActiveTab] = useState<string>(
        defaultTab || tabs?.[0]?.id || ""
    );
    const [activeFilters, setActiveFilters] = useState<
        Record<string, (string | number | boolean)[]>
    >(() => {
        const initial: Record<string, (string | number | boolean)[]> = {};
        filters?.forEach((filter) => {
            initial[filter.id] = filter.defaultValues || [];
        });
        return initial;
    });

    // Track initial values to avoid storing defaults on first render
    const initialPageSize = useRef(pageSize);
    const initialColumnVisibilityState = useRef(columnVisibility);
    const hasUserChangedPageSize = useRef(false);
    const hasUserChangedColumnVisibility = useRef(false);

    // Apply tab and custom filters to data
    const filteredData = useMemo(() => {
        let result = data;

        // Apply tab filter
        if (tabs && activeTab !== "") {
            const activeTabFilter = tabs.find((tab) => tab.id === activeTab);
            if (activeTabFilter) {
                result = result.filter(activeTabFilter.filterFn);
            }
        }

        // Apply custom filters
        if (filters && filters.length > 0) {
            filters.forEach((filter) => {
                const selectedValues = activeFilters[filter.id] || [];
                if (selectedValues.length > 0) {
                    result = result.filter((row) =>
                        filter.filterFn(row, selectedValues)
                    );
                }
            });
        }

        return result;
    }, [data, tabs, activeTab, filters, activeFilters]);

    const table = useReactTable({
        data: filteredData,
        columns,
        getCoreRowModel: getCoreRowModel(),
        getPaginationRowModel: getPaginationRowModel(),
        onSortingChange: setSorting,
        getSortedRowModel: getSortedRowModel(),
        onColumnFiltersChange: setColumnFilters,
        getFilteredRowModel: getFilteredRowModel(),
        onGlobalFilterChange: setGlobalFilter,
        onColumnVisibilityChange: setColumnVisibility,
        onPaginationChange: onPaginationChange
            ? (state) => {
                  const newState =
                      typeof state === "function" ? state(pagination) : state;
                  onPaginationChange(newState);
              }
            : setPagination,
        manualFiltering,
        manualSorting,
        manualPagination: Boolean(paginationState),
        pageCount: paginationState?.pageCount,
        initialState: {
            pagination,
            columnVisibility: initialColumnVisibility
        },
        state: {
            sorting,
            columnFilters,
            globalFilter,
            columnVisibility,
            pagination
        }
    });

    // Persist pageSize to localStorage when it changes (but not on initial mount)
    useEffect(() => {
        if (persistPageSize && pagination.pageSize !== pageSize) {
            // Only store if user has actually changed it from initial value
            if (
                hasUserChangedPageSize.current &&
                pagination.pageSize !== initialPageSize.current
            ) {
                setStoredPageSize(pagination.pageSize, tableId);
            }
            setPageSize(pagination.pageSize);
        }
    }, [pagination.pageSize, persistPageSize, tableId, pageSize]);

    useEffect(() => {
        // Persist column visibility to localStorage when it changes (but not on initial mount)
        if (shouldPersistColumnVisibility) {
            const hasChanged =
                JSON.stringify(columnVisibility) !==
                JSON.stringify(initialColumnVisibilityState.current);
            if (hasChanged) {
                // Mark as user-initiated change and persist
                hasUserChangedColumnVisibility.current = true;
                setStoredColumnVisibility(columnVisibility, tableId);
            }
        }
    }, [columnVisibility, shouldPersistColumnVisibility, tableId]);

    const handleTabChange = (value: string) => {
        setActiveTab(value);
        // Reset to first page when changing tabs
        setPagination((prev) => ({ ...prev, pageIndex: 0 }));
    };

    const handleFilterChange = (
        filterId: string,
        optionValue: string | number | boolean,
        checked: boolean
    ) => {
        setActiveFilters((prev) => {
            const currentValues = prev[filterId] || [];
            const filter = filters?.find((f) => f.id === filterId);

            if (!filter) return prev;

            let newValues: (string | number | boolean)[];

            if (filter.multiSelect) {
                // Multi-select: add or remove the value
                if (checked) {
                    newValues = [...currentValues, optionValue];
                } else {
                    newValues = currentValues.filter((v) => v !== optionValue);
                }
            } else {
                // Single-select: replace the value
                newValues = checked ? [optionValue] : [];
            }

            return {
                ...prev,
                [filterId]: newValues
            };
        });
        // Reset to first page when changing filters
        setPagination((prev) => ({ ...prev, pageIndex: 0 }));
    };

    // Calculate display text for a filter based on selected values
    const getFilterDisplayText = (filter: DataTableFilter): string => {
        const selectedValues = activeFilters[filter.id] || [];

        if (selectedValues.length === 0) {
            return filter.label;
        }

        const selectedOptions = filter.options.filter((option) =>
            selectedValues.includes(option.value)
        );

        if (selectedOptions.length === 0) {
            return filter.label;
        }

        if (selectedOptions.length === 1) {
            return selectedOptions[0].label;
        }

        // Multiple selections: always join with "and"
        return selectedOptions.map((opt) => opt.label).join(" and ");
    };

    // Enhanced pagination component that updates our local state
    const handlePageSizeChange = (newPageSize: number) => {
        hasUserChangedPageSize.current = true;
        setPagination((prev) => ({
            ...prev,
            pageSize: newPageSize,
            pageIndex: 0
        }));
        setPageSize(newPageSize);

        // Persist immediately when user changes it
        if (persistPageSize) {
            setStoredPageSize(newPageSize, tableId);
        }
    };

    // Helper function to check if a column should be sticky
    const isStickyColumn = (
        columnId: string | undefined,
        accessorKey: string | undefined,
        position: "left" | "right"
    ): boolean => {
        if (position === "left" && stickyLeftColumn) {
            return (
                columnId === stickyLeftColumn ||
                accessorKey === stickyLeftColumn
            );
        }
        if (position === "right" && stickyRightColumn) {
            return (
                columnId === stickyRightColumn ||
                accessorKey === stickyRightColumn
            );
        }
        return false;
    };

    // Get sticky column classes
    const getStickyClasses = (
        columnId: string | undefined,
        accessorKey: string | undefined
    ): string => {
        if (isStickyColumn(columnId, accessorKey, "left")) {
            return "md:sticky md:left-0 z-10 bg-card [mask-image:linear-gradient(to_left,transparent_0%,black_20px)]";
        }
        if (isStickyColumn(columnId, accessorKey, "right")) {
            return "sticky right-0 z-10 w-auto min-w-fit bg-card [mask-image:linear-gradient(to_right,transparent_0%,black_20px)]";
        }
        return "";
    };

    const tableRows = table.getRowModel().rows;
    const hasRows = tableRows.length > 0;
    const hasAddAction = Boolean(
        addButtonText && ((addActions && addActions.length > 0) || onAdd)
    );
    const showAddActionInEmptyState = !hasRows && hasAddAction;
    const addAction =
        addActions && addActions.length > 0 && addButtonText ? (
            <DropdownMenu>
                <DropdownMenuTrigger asChild>
                    <Button disabled={addButtonDisabled}>
                        <Plus className="mr-2 h-4 w-4" />
                        {addButtonText}
                        <ChevronDown className="ml-2 h-4 w-4" />
                    </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                    {addActions.map((action, i) => (
                        <DropdownMenuItem
                            key={i}
                            onSelect={() => action.onSelect()}
                        >
                            {action.label}
                        </DropdownMenuItem>
                    ))}
                </DropdownMenuContent>
            </DropdownMenu>
        ) : onAdd && addButtonText ? (
            <Button onClick={onAdd} disabled={addButtonDisabled}>
                <Plus className="mr-2 h-4 w-4" />
                {addButtonText}
            </Button>
        ) : null;

    return (
        <div className="container mx-auto max-w-12xl">
            <Card>
                <CardHeader className="flex flex-col space-y-4 sm:flex-row sm:items-center sm:justify-between sm:space-y-0 pb-4">
                    <div className="flex flex-row space-y-3 w-full sm:mr-2 gap-2">
                        <div className="relative w-full sm:max-w-sm">
                            <Input
                                placeholder={searchPlaceholder}
                                defaultValue={searchQuery}
                                value={onSearch ? undefined : globalFilter}
                                onChange={(e) => {
                                    onSearch
                                        ? onSearch(e.currentTarget.value)
                                        : table.setGlobalFilter(
                                              String(e.target.value)
                                          );
                                }}
                                className="w-full pl-8"
                            />
                            <Search className="h-4 w-4 absolute left-2 top-1/2 transform -translate-y-1/2 text-muted-foreground" />
                        </div>
                        {filters && filters.length > 0 && (
                            <div className="flex gap-2">
                                {filters.map((filter) => {
                                    const selectedValues =
                                        activeFilters[filter.id] || [];
                                    const hasActiveFilters =
                                        selectedValues.length > 0;
                                    const displayMode =
                                        filter.displayMode || filterDisplayMode;
                                    const displayText =
                                        displayMode === "calculated"
                                            ? getFilterDisplayText(filter)
                                            : filter.label;

                                    return (
                                        <DropdownMenu key={filter.id}>
                                            <DropdownMenuTrigger asChild>
                                                <Button
                                                    variant={"outline"}
                                                    size="sm"
                                                    className="h-9"
                                                >
                                                    <Filter className="h-4 w-4 mr-2" />
                                                    {displayText}
                                                    {displayMode === "label" &&
                                                        hasActiveFilters && (
                                                            <span className="ml-2 bg-muted text-foreground rounded-full px-2 py-0.5 text-xs">
                                                                {
                                                                    selectedValues.length
                                                                }
                                                            </span>
                                                        )}
                                                </Button>
                                            </DropdownMenuTrigger>
                                            <DropdownMenuContent
                                                align="start"
                                                className={
                                                    dataTableFilterDropdownContentClassName
                                                }
                                            >
                                                <DropdownMenuLabel>
                                                    {filter.label}
                                                </DropdownMenuLabel>
                                                <DropdownMenuSeparator />
                                                {filter.options.map(
                                                    (option) => {
                                                        const isChecked =
                                                            selectedValues.includes(
                                                                option.value
                                                            );
                                                        return (
                                                            <DropdownMenuCheckboxItem
                                                                key={option.id}
                                                                checked={
                                                                    isChecked
                                                                }
                                                                onCheckedChange={(
                                                                    checked
                                                                ) =>
                                                                    handleFilterChange(
                                                                        filter.id,
                                                                        option.value,
                                                                        checked
                                                                    )
                                                                }
                                                                onSelect={(e) =>
                                                                    e.preventDefault()
                                                                }
                                                            >
                                                                {option.label}
                                                            </DropdownMenuCheckboxItem>
                                                        );
                                                    }
                                                )}
                                            </DropdownMenuContent>
                                        </DropdownMenu>
                                    );
                                })}
                            </div>
                        )}
                        {tabs && tabs.length > 0 && (
                            <Tabs
                                value={activeTab}
                                onValueChange={handleTabChange}
                                className="w-full"
                            >
                                <TabsList>
                                    {tabs.map((tab) => (
                                        <TabsTrigger
                                            key={tab.id}
                                            value={tab.id}
                                        >
                                            {tab.label} (
                                            {data.filter(tab.filterFn).length})
                                        </TabsTrigger>
                                    ))}
                                </TabsList>
                            </Tabs>
                        )}
                    </div>
                    <div className="flex items-center gap-2 sm:justify-end">
                        {onRefresh && (
                            <div>
                                <Button
                                    variant="outline"
                                    onClick={onRefresh}
                                    disabled={
                                        isRefreshing || refreshButtonDisabled
                                    }
                                >
                                    <RefreshCw
                                        className={`mr-0 sm:mr-2 h-4 w-4 ${isRefreshing ? "animate-spin" : ""}`}
                                    />
                                    <span className="hidden sm:inline">
                                        {t("refresh")}
                                    </span>
                                </Button>
                            </div>
                        )}
                        {addAction && (
                            <>
                                <div className="sm:hidden">{addAction}</div>
                                {!showAddActionInEmptyState && (
                                    <div className="hidden sm:block">
                                        {addAction}
                                    </div>
                                )}
                            </>
                        )}
                    </div>
                </CardHeader>
                <CardContent>
                    <div className="overflow-x-auto overflow-y-hidden">
                        <Table>
                            <TableHeader>
                                {table.getHeaderGroups().map((headerGroup) => (
                                    <TableRow key={headerGroup.id}>
                                        {headerGroup.headers.map((header) => {
                                            const columnId = header.column.id;
                                            const accessorKey = (
                                                header.column.columnDef as any
                                            ).accessorKey as string | undefined;
                                            const stickyClasses =
                                                getStickyClasses(
                                                    columnId,
                                                    accessorKey
                                                );
                                            const isRightSticky =
                                                isStickyColumn(
                                                    columnId,
                                                    accessorKey,
                                                    "right"
                                                );
                                            const hasHideableColumns =
                                                enableColumnVisibility &&
                                                table
                                                    .getAllColumns()
                                                    .some((col) =>
                                                        col.getCanHide()
                                                    );

                                            return (
                                                <TableHead
                                                    key={header.id}
                                                    className={`whitespace-nowrap ${stickyClasses}`}
                                                >
                                                    {header.isPlaceholder ? null : isRightSticky &&
                                                      hasHideableColumns ? (
                                                        <div className="flex flex-col items-end pr-3">
                                                            <DropdownMenu>
                                                                <DropdownMenuTrigger
                                                                    asChild
                                                                >
                                                                    <Button
                                                                        variant="ghost"
                                                                        size="sm"
                                                                        className="h-7 w-7 p-0 mb-1"
                                                                    >
                                                                        <Columns className="h-4 w-4" />
                                                                        <span className="sr-only">
                                                                            {t(
                                                                                "columns"
                                                                            ) ||
                                                                                "Columns"}
                                                                        </span>
                                                                    </Button>
                                                                </DropdownMenuTrigger>
                                                                <DropdownMenuContent
                                                                    align="end"
                                                                    className="w-48"
                                                                >
                                                                    {table
                                                                        .getAllColumns()
                                                                        .filter(
                                                                            (
                                                                                column
                                                                            ) =>
                                                                                column.getCanHide()
                                                                        )
                                                                        .map(
                                                                            (
                                                                                column
                                                                            ) => {
                                                                                const columnDef =
                                                                                    column.columnDef as any;
                                                                                const friendlyName =
                                                                                    columnDef.friendlyName;
                                                                                const displayName =
                                                                                    friendlyName ||
                                                                                    (typeof columnDef.header ===
                                                                                    "string"
                                                                                        ? columnDef.header
                                                                                        : column.id);
                                                                                return (
                                                                                    <DropdownMenuCheckboxItem
                                                                                        key={
                                                                                            column.id
                                                                                        }
                                                                                        className="capitalize"
                                                                                        checked={column.getIsVisible()}
                                                                                        onCheckedChange={(
                                                                                            value
                                                                                        ) =>
                                                                                            column.toggleVisibility(
                                                                                                !!value
                                                                                            )
                                                                                        }
                                                                                        onSelect={(
                                                                                            e
                                                                                        ) =>
                                                                                            e.preventDefault()
                                                                                        }
                                                                                    >
                                                                                        {
                                                                                            displayName
                                                                                        }
                                                                                    </DropdownMenuCheckboxItem>
                                                                                );
                                                                            }
                                                                        )}
                                                                </DropdownMenuContent>
                                                            </DropdownMenu>
                                                            <div className="h-0 opacity-0 pointer-events-none overflow-hidden">
                                                                {flexRender(
                                                                    header
                                                                        .column
                                                                        .columnDef
                                                                        .header,
                                                                    header.getContext()
                                                                )}
                                                            </div>
                                                        </div>
                                                    ) : (
                                                        flexRender(
                                                            header.column
                                                                .columnDef
                                                                .header,
                                                            header.getContext()
                                                        )
                                                    )}
                                                </TableHead>
                                            );
                                        })}
                                    </TableRow>
                                ))}
                            </TableHeader>
                            <TableBody>
                                {table.getRowModel().rows?.length ? (
                                    table.getRowModel().rows.map((row) => (
                                        <TableRow
                                            key={row.id}
                                            data-state={
                                                row.getIsSelected() &&
                                                "selected"
                                            }
                                        >
                                            {row
                                                .getVisibleCells()
                                                .map((cell) => {
                                                    const columnId =
                                                        cell.column.id;
                                                    const accessorKey = (
                                                        cell.column
                                                            .columnDef as any
                                                    ).accessorKey as
                                                        | string
                                                        | undefined;
                                                    const stickyClasses =
                                                        getStickyClasses(
                                                            columnId,
                                                            accessorKey
                                                        );
                                                    const isRightSticky =
                                                        isStickyColumn(
                                                            columnId,
                                                            accessorKey,
                                                            "right"
                                                        );
                                                    return (
                                                        <TableCell
                                                            key={cell.id}
                                                            className={`whitespace-nowrap ${stickyClasses} ${isRightSticky ? "text-right" : ""}`}
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
                                        </TableRow>
                                    ))
                                ) : (
                                    <DataTableEmptyState
                                        colSpan={columns.length}
                                        action={
                                            showAddActionInEmptyState ? (
                                                <div className="hidden sm:block">
                                                    {addAction}
                                                </div>
                                            ) : undefined
                                        }
                                    />
                                )}
                            </TableBody>
                        </Table>
                    </div>
                    <div className="mt-4">
                        {table.getRowModel().rows?.length > 0 && (
                            <DataTablePagination
                                table={table}
                                onPageSizeChange={handlePageSizeChange}
                                pageSize={pagination.pageSize}
                                pageIndex={pagination.pageIndex}
                            />
                        )}
                    </div>
                </CardContent>
            </Card>
        </div>
    );
}
