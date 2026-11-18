"use client";

import {
    ColumnDef,
    flexRender,
    getCoreRowModel,
    useReactTable,
    getPaginationRowModel,
    getSortedRowModel,
    getFilteredRowModel
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
import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";

type TabFilter = {
    id: string;
    label: string;
    filterFn: (row: any) => boolean;
};

type DNSRecordsDataTableProps<TData, TValue> = {
    columns: ColumnDef<TData, TValue>[];
    data: TData[];
    title?: string;
    addButtonText?: string;
    onAdd?: () => void;
    onRefresh?: () => void;
    isRefreshing?: boolean;
    searchPlaceholder?: string;
    searchColumn?: string;
    defaultSort?: {
        id: string;
        desc: boolean;
    };
    tabs?: TabFilter[];
    defaultTab?: string;
    persistPageSize?: boolean | string;
    defaultPageSize?: number;
    type?: string | null;
};

export function DNSRecordsDataTable<TData, TValue>({
    columns,
    data,
    tabs,
    defaultTab
}: DNSRecordsDataTableProps<TData, TValue>) {
    const t = useTranslations();

    const [activeTab, setActiveTab] = useState<string>(
        defaultTab || tabs?.[0]?.id || ""
    );

    const filteredData = useMemo(() => {
        if (!tabs || activeTab === "") {
            return data;
        }

        const activeTabFilter = tabs.find((tab) => tab.id === activeTab);
        if (!activeTabFilter) {
            return data;
        }

        return data.filter(activeTabFilter.filterFn);
    }, [data, tabs, activeTab]);

    const table = useReactTable({
        data: filteredData,
        columns,
        getCoreRowModel: getCoreRowModel(),
        getPaginationRowModel: getPaginationRowModel(),
        getSortedRowModel: getSortedRowModel(),
        getFilteredRowModel: getFilteredRowModel()
    });

    return (
        <TableContainer>
            <Table>
                <TableHeader>
                    {table.getHeaderGroups().map((headerGroup) => (
                        <TableRow key={headerGroup.id}>
                            {headerGroup.headers.map((header) => (
                                <TableHead key={header.id}>
                                    {header.isPlaceholder
                                        ? null
                                        : flexRender(
                                              header.column.columnDef.header,
                                              header.getContext()
                                          )}
                                </TableHead>
                            ))}
                        </TableRow>
                    ))}
                </TableHeader>
                <TableBody>
                    {table.getRowModel().rows?.length ? (
                        table.getRowModel().rows.map((row) => (
                            <TableRow
                                key={row.id}
                                data-state={
                                    row.getIsSelected() && "selected"
                                }
                            >
                                {row.getVisibleCells().map((cell) => (
                                    <TableCell key={cell.id}>
                                        {flexRender(
                                            cell.column.columnDef.cell,
                                            cell.getContext()
                                        )}
                                    </TableCell>
                                ))}
                            </TableRow>
                        ))
                    ) : (
                        <TableRow>
                            <TableCell
                                colSpan={columns.length}
                                className="h-24 text-center"
                            >
                                {t("noResults")}
                            </TableCell>
                        </TableRow>
                    )}
                </TableBody>
            </Table>
        </TableContainer>
    );
}
