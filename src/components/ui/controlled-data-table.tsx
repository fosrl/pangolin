"use client";

import {
    ColumnDef,
    ColumnFiltersState,
    flexRender,
    getCoreRowModel,
    PaginationState,
    useReactTable
} from "@tanstack/react-table";

import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
    TableContainer
} from "@/components/ui/table";
import { DataTableEmptyState } from "@/components/ui/data-table-empty-state";
import { DataTablePagination } from "@app/components/DataTablePagination";
import type { DataTableAddAction } from "@app/components/ui/data-table";
import { Button } from "@app/components/ui/button";
import {
    DropdownMenu,
    DropdownMenuCheckboxItem,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger
} from "@app/components/ui/dropdown-menu";
import { Input } from "@app/components/ui/input";
import { useStoredColumnVisibility } from "@app/hooks/useStoredColumnVisibility";
import { dataTableFilterDropdownContentClassName } from "@app/lib/dataTableFilterPopover";

import {
    ChevronDown,
    ChevronRight,
    Settings,
    Filter,
    Plus,
    RefreshCw,
    Search
} from "lucide-react";
import { useTranslations } from "next-intl";
import {
    Fragment,
    useMemo,
    useState,
    type MouseEvent,
    type ReactNode
} from "react";

// Extended ColumnDef type that includes optional friendlyName for column visibility dropdown
export type ExtendedColumnDef<TData, TValue = unknown> = ColumnDef<
    TData,
    TValue
> & {
    friendlyName?: string;
};

type FilterOption = {
    id: string;
    label: string;
    value: string;
};

type DataTableFilter = {
    id: string;
    label: string;
    options: FilterOption[];
    multiSelect?: boolean;
    onValueChange: (selectedValues: string[]) => void;
    values?: string[];
    displayMode?: "label" | "calculated"; // How to display the filter button text
};

export type DataTablePaginationUpdateFn = (newPage: PaginationState) => void;

type ControlledDataTableProps<TData, TValue> = {
    columns: ExtendedColumnDef<TData, TValue>[];
    rows: TData[];
    tableId: string;
    addButtonText?: string;
    onAdd?: () => void;
    addActions?: DataTableAddAction[];
    addButtonDisabled?: boolean;
    onRefresh?: () => void;
    isRefreshing?: boolean;
    refreshButtonDisabled?: boolean;
    isNavigatingToAddPage?: boolean;
    searchPlaceholder?: string;
    filters?: DataTableFilter[];
    /** Extra filter controls (e.g. searchable entity pickers) shown after the filter dropdowns. */
    filterExtras?: ReactNode;
    filterDisplayMode?: "label" | "calculated"; // Global filter display mode (can be overridden per filter)
    columnVisibility?: Record<string, boolean>;
    enableColumnVisibility?: boolean;
    onSearch?: (input: string) => void;
    searchQuery?: string;
    onPaginationChange: DataTablePaginationUpdateFn;
    stickyLeftColumn?: string; // Column ID or accessorKey for left sticky column
    stickyRightColumn?: string; // Column ID or accessorKey for right sticky column (typically "actions")
    rowCount: number;
    pagination: PaginationState;
    /** Renders details below a row; rows become expandable when set. */
    renderExpandedRow?: (row: TData) => ReactNode;
    /** Stable row ids keep rows expanded across refreshes. */
    getRowId?: (row: TData) => string;
};

const EXPAND_COLUMN_ID = "expand";

// Clicks on controls inside a row shouldn't also toggle it
function isInteractiveTarget(event: MouseEvent): boolean {
    const target = event.target as HTMLElement | null;
    return Boolean(
        target?.closest(
            "a, button, input, select, textarea, [role='button'], [role='checkbox'], [role='menuitem']"
        )
    );
}

export function ControlledDataTable<TData, TValue>({
    columns,
    rows,
    addButtonText,
    onAdd,
    addActions,
    addButtonDisabled = false,
    onRefresh,
    isRefreshing,
    refreshButtonDisabled = false,
    searchPlaceholder = "Search...",
    filters,
    filterExtras,
    filterDisplayMode = "label",
    columnVisibility: defaultColumnVisibility,
    enableColumnVisibility = false,
    tableId,
    pagination,
    stickyLeftColumn,
    onSearch,
    searchQuery,
    onPaginationChange,
    stickyRightColumn,
    rowCount,
    isNavigatingToAddPage,
    renderExpandedRow,
    getRowId
}: ControlledDataTableProps<TData, TValue>) {
    const t = useTranslations();

    const expandable = Boolean(renderExpandedRow);
    const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());

    const toggleRowExpansion = (rowId: string) => {
        setExpandedRows((prev) => {
            const next = new Set(prev);
            if (next.has(rowId)) {
                next.delete(rowId);
            } else {
                next.add(rowId);
            }
            return next;
        });
    };

    const tableColumns = useMemo<ExtendedColumnDef<TData, TValue>[]>(() => {
        if (!expandable) {
            return columns;
        }
        const expandColumn: ExtendedColumnDef<TData, TValue> = {
            id: EXPAND_COLUMN_ID,
            enableHiding: false,
            header: () => null,
            cell: ({ row }) => (
                <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 w-6 p-0"
                    aria-label={t("toggleRowDetails")}
                    aria-expanded={expandedRows.has(row.id)}
                    onClick={() => toggleRowExpansion(row.id)}
                >
                    {expandedRows.has(row.id) ? (
                        <ChevronDown className="h-4 w-4" />
                    ) : (
                        <ChevronRight className="h-4 w-4" />
                    )}
                </Button>
            ),
            size: 40,
            minSize: 40,
            maxSize: 40
        };
        return [expandColumn, ...columns];
    }, [columns, expandable, expandedRows, t]);

    const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);

    const [columnVisibility, setColumnVisibility] = useStoredColumnVisibility(
        tableId,
        defaultColumnVisibility
    );

    // TODO: filters
    const activeFilters = useMemo(() => {
        const initial: Record<string, string[]> = {};
        filters?.forEach((filter) => {
            initial[filter.id] = filter.values || [];
        });
        return initial;
    }, [filters]);

    const table = useReactTable({
        data: rows,
        columns: tableColumns,
        getRowId: getRowId ? (row) => getRowId(row) : undefined,
        getCoreRowModel: getCoreRowModel(),
        // getFilteredRowModel: getFilteredRowModel(),
        onColumnVisibilityChange: setColumnVisibility,
        onPaginationChange: (state) => {
            const newState =
                typeof state === "function" ? state(pagination) : state;
            onPaginationChange(newState);
        },
        manualFiltering: true,
        manualPagination: true,
        rowCount,
        state: {
            columnFilters,
            columnVisibility,
            pagination
        }
    });

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
        return selectedOptions.map((opt) => opt.label).join(" or ");
    };

    const handleFilterChange = (
        filterId: string,
        optionValue: string,
        checked: boolean
    ) => {
        const currentValues = activeFilters[filterId] || [];
        const filter = filters?.find((f) => f.id === filterId);

        if (!filter) return;

        let newValues: string[];

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

        filter.onValueChange(newValues);
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
        accessorKey: string | undefined,
        atLeftEdge = false
    ): string => {
        if (isStickyColumn(columnId, accessorKey, "left")) {
            return `md:sticky md:left-0 z-10 bg-card${atLeftEdge ? " shadow-none" : ""}`;
        }
        if (isStickyColumn(columnId, accessorKey, "right")) {
            return "sticky right-0 z-10 w-auto min-w-fit bg-card shadow-none";
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
                    <Button
                        disabled={addButtonDisabled || isNavigatingToAddPage}
                    >
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
            <Button
                onClick={onAdd}
                loading={isNavigatingToAddPage}
                disabled={addButtonDisabled}
            >
                <Plus className="mr-2 h-4 w-4" />
                {addButtonText}
            </Button>
        ) : null;

    return (
        <div className="flex w-full min-w-0 flex-col gap-4">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex flex-row flex-wrap w-full sm:mr-2 gap-2">
                    {onSearch && (
                        <div className="relative w-full sm:max-w-sm">
                            <Input
                                placeholder={searchPlaceholder}
                                defaultValue={searchQuery}
                                onChange={(e) =>
                                    onSearch(e.currentTarget.value)
                                }
                                className="w-full pl-8"
                                type="search"
                            />
                            <Search className="h-4 w-4 absolute left-2 top-1/2 transform -translate-y-1/2 text-muted-foreground" />
                        </div>
                    )}

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
                                            {filter.options.map((option) => {
                                                const isChecked =
                                                    selectedValues.includes(
                                                        option.value
                                                    );
                                                return (
                                                    <DropdownMenuCheckboxItem
                                                        key={option.id}
                                                        checked={isChecked}
                                                        onCheckedChange={(
                                                            checked
                                                        ) => {
                                                            handleFilterChange(
                                                                filter.id,
                                                                option.value,
                                                                checked
                                                            );
                                                        }}
                                                        onSelect={(e) =>
                                                            e.preventDefault()
                                                        }
                                                    >
                                                        {option.label}
                                                    </DropdownMenuCheckboxItem>
                                                );
                                            })}
                                        </DropdownMenuContent>
                                    </DropdownMenu>
                                );
                            })}
                        </div>
                    )}
                    {filterExtras}
                </div>
                <div className="flex items-center gap-2 sm:justify-end">
                    {onRefresh && (
                        <div>
                            <Button
                                variant="outline"
                                onClick={onRefresh}
                                disabled={isRefreshing || refreshButtonDisabled}
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
            </div>
            <div className="relative flex flex-col gap-4">
                <TableContainer>
                    <Table>
                        <TableHeader>
                            {table.getHeaderGroups().map((headerGroup) => (
                                <TableRow key={headerGroup.id}>
                                    {headerGroup.headers.map((header) => {
                                        const columnId = header.column.id;
                                        const accessorKey = (
                                            header.column.columnDef as any
                                        ).accessorKey as string | undefined;
                                        const atLeftEdge =
                                            header.index === 0 ||
                                            (expandable &&
                                                header.index === 1 &&
                                                headerGroup.headers[0]?.column
                                                    .id === EXPAND_COLUMN_ID);
                                        const stickyClasses = getStickyClasses(
                                            columnId,
                                            accessorKey,
                                            atLeftEdge
                                        );
                                        const isRightSticky = isStickyColumn(
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
                                                className={`whitespace-nowrap ${stickyClasses}${atLeftEdge ? " shadow-none" : ""}`}
                                            >
                                                {header.isPlaceholder ? null : isRightSticky &&
                                                  hasHideableColumns ? (
                                                    <div className="relative flex h-10 w-full items-center justify-end pr-3">
                                                        <DropdownMenu>
                                                            <DropdownMenuTrigger
                                                                asChild
                                                            >
                                                                <Button
                                                                    variant="ghost"
                                                                    size="sm"
                                                                    className="h-7 w-7 p-0"
                                                                >
                                                                    <Settings className="!size-4" />
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
                                                        <div className="pointer-events-none absolute h-0 w-0 overflow-hidden opacity-0">
                                                            {flexRender(
                                                                header.column
                                                                    .columnDef
                                                                    .header,
                                                                header.getContext()
                                                            )}
                                                        </div>
                                                    </div>
                                                ) : (
                                                    flexRender(
                                                        header.column.columnDef
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
                            {(table.getRowModel().rows ?? []).length > 0 ? (
                                table.getRowModel().rows.map((row) => (
                                    <Fragment key={row.id}>
                                        <TableRow
                                            data-state={
                                                row.getIsSelected() &&
                                                "selected"
                                            }
                                            className={
                                                expandable
                                                    ? "cursor-pointer"
                                                    : undefined
                                            }
                                            onClick={
                                                expandable
                                                    ? (e) => {
                                                          if (
                                                              !isInteractiveTarget(
                                                                  e
                                                              )
                                                          ) {
                                                              toggleRowExpansion(
                                                                  row.id
                                                              );
                                                          }
                                                      }
                                                    : undefined
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
                                                        string | undefined;
                                                    const atLeftEdge =
                                                        cell.column.getIndex() ===
                                                            0 ||
                                                        (expandable &&
                                                            cell.column.getIndex() ===
                                                                1 &&
                                                            row.getVisibleCells()[0]
                                                                ?.column.id ===
                                                                EXPAND_COLUMN_ID);
                                                    const stickyClasses =
                                                        getStickyClasses(
                                                            columnId,
                                                            accessorKey,
                                                            atLeftEdge
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
                                        {expandable &&
                                            expandedRows.has(row.id) && (
                                                <TableRow className="hover:bg-transparent">
                                                    <TableCell
                                                        colSpan={
                                                            row.getVisibleCells()
                                                                .length
                                                        }
                                                        className="bg-muted/50 p-4"
                                                    >
                                                        {/* w-0 min-w-full keeps the details from widening the table's columns */}
                                                        <div className="w-0 min-w-full">
                                                            {renderExpandedRow?.(
                                                                row.original
                                                            )}
                                                        </div>
                                                    </TableCell>
                                                </TableRow>
                                            )}
                                    </Fragment>
                                ))
                            ) : (
                                <DataTableEmptyState
                                    colSpan={tableColumns.length}
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
                </TableContainer>
                <div>
                    {rowCount > 0 && (
                        <DataTablePagination
                            table={table}
                            totalCount={rowCount}
                            onPageSizeChange={(pageSize) =>
                                onPaginationChange({
                                    ...pagination,
                                    pageSize
                                })
                            }
                            onPageChange={(pageIndex) => {
                                onPaginationChange({
                                    ...pagination,
                                    pageIndex
                                });
                            }}
                            isServerPagination
                            pageSize={pagination.pageSize}
                            pageIndex={pagination.pageIndex}
                        />
                    )}
                </div>
            </div>
        </div>
    );
}
