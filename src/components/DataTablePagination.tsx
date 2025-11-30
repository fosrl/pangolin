import {
    ChevronLeftIcon,
    ChevronRightIcon,
    DoubleArrowLeftIcon,
    DoubleArrowRightIcon
} from "@radix-ui/react-icons";
import { Table } from "@tanstack/react-table";

import { Button } from "@app/components/ui/button";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue
} from "@app/components/ui/select";
import { useTranslations } from "next-intl";

interface DataTablePaginationProps<TData> {
    table: Table<TData>;
    onPageSizeChange?: (pageSize: number) => void;
    onPageChange?: (pageIndex: number) => void;
    totalCount?: number;
    isServerPagination?: boolean;
    isLoading?: boolean;
    disabled?: boolean;
}

export function DataTablePagination<TData>({
    table,
    onPageSizeChange,
    onPageChange,
    totalCount,
    isServerPagination = false,
    isLoading = false,
    disabled = false
}: DataTablePaginationProps<TData>) {
    const t = useTranslations();

    const handlePageSizeChange = (value: string) => {
        const newPageSize = Number(value);
        table.setPageSize(newPageSize);
        
        // Call the callback if provided (for persistence)
        if (onPageSizeChange) {
            onPageSizeChange(newPageSize);
        }
    };

    const handlePageNavigation = (action: 'first' | 'previous' | 'next' | 'last') => {
        if (isServerPagination && onPageChange) {
            const currentPage = table.getState().pagination.pageIndex;
            const pageCount = table.getPageCount();
            
            let newPage: number;
            switch (action) {
                case 'first':
                    newPage = 0;
                    break;
                case 'previous':
                    newPage = Math.max(0, currentPage - 1);
                    break;
                case 'next':
                    newPage = Math.min(pageCount - 1, currentPage + 1);
                    break;
                case 'last':
                    newPage = pageCount - 1;
                    break;
                default:
                    return;
            }
            
            if (newPage !== currentPage) {
                onPageChange(newPage);
            }
        } else {
            // Use table's built-in navigation for client-side pagination
            switch (action) {
                case 'first':
                    table.setPageIndex(0);
                    break;
                case 'previous':
                    table.previousPage();
                    break;
                case 'next':
                    table.nextPage();
                    break;
                case 'last':
                    table.setPageIndex(table.getPageCount() - 1);
                    break;
            }
        }
    };

    return (
        <div className="flex items-center justify-between text-muted-foreground">
            <div className="flex items-center space-x-2">
                <Select
                    value={`${table.getState().pagination.pageSize}`}
                    onValueChange={handlePageSizeChange}
                    disabled={disabled}
                >
                    <SelectTrigger className="h-8 w-[73px]" disabled={disabled}>
                        <SelectValue
                            placeholder={table.getState().pagination.pageSize}
                        />
                    </SelectTrigger>
                    <SelectContent side="bottom">
                        {[10, 20, 30, 40, 50, 100].map((pageSize) => (
                            <SelectItem key={pageSize} value={`${pageSize}`}>
                                {pageSize}
                            </SelectItem>
                        ))}
                    </SelectContent>
                </Select>
            </div>

            <div className="flex items-center space-x-3 lg:space-x-8">
                <div className="flex items-center justify-center text-sm font-medium">
                    {isServerPagination && totalCount !== undefined ? (
                        t('paginator', {
                            current: table.getState().pagination.pageIndex + 1, 
                            last: Math.ceil(totalCount / table.getState().pagination.pageSize)
                        })
                    ) : (
                        t('paginator', {current: table.getState().pagination.pageIndex + 1, last: table.getPageCount()})
                    )}
                </div>
                <div className="flex items-center space-x-2">
                    <Button
                        variant="outline"
                        className="hidden h-8 w-8 p-0 lg:flex"
                        onClick={() => handlePageNavigation('first')}
                        disabled={!table.getCanPreviousPage() || isLoading || disabled}
                    >
                        <span className="sr-only">{t('paginatorToFirst')}</span>
                        <DoubleArrowLeftIcon className="h-4 w-4" />
                    </Button>
                    <Button
                        variant="outline"
                        className="h-8 w-8 p-0"
                        onClick={() => handlePageNavigation('previous')}
                        disabled={!table.getCanPreviousPage() || isLoading || disabled}
                    >
                        <span className="sr-only">{t('paginatorToPrevious')}</span>
                        <ChevronLeftIcon className="h-4 w-4" />
                    </Button>
                    <Button
                        variant="outline"
                        className="h-8 w-8 p-0"
                        onClick={() => handlePageNavigation('next')}
                        disabled={!table.getCanNextPage() || isLoading || disabled}
                    >
                        <span className="sr-only">{t('paginatorToNext')}</span>
                        <ChevronRightIcon className="h-4 w-4" />
                    </Button>
                    <Button
                        variant="outline"
                        className="hidden h-8 w-8 p-0 lg:flex"
                        onClick={() => handlePageNavigation('last')}
                        disabled={!table.getCanNextPage() || isLoading || disabled}
                    >
                        <span className="sr-only">{t('paginatorToLast')}</span>
                        <DoubleArrowRightIcon className="h-4 w-4" />
                    </Button>
                </div>
            </div>
        </div>
    );
}
