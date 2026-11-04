"use client";

import { ColumnDef } from "@tanstack/react-table";
import { DataTable } from "@app/components/ui/data-table";
import { useTranslations } from "next-intl";

interface DataTableProps<TData, TValue> {
    columns: ColumnDef<TData, TValue>[];
    data: TData[];
    createShareLink?: () => void;
    onRefresh?: () => void;
    isRefreshing?: boolean;
}

export function ShareLinksDataTable<TData, TValue>({
    columns,
    data,
    createShareLink,
    onRefresh,
    isRefreshing
}: DataTableProps<TData, TValue>) {
    const t = useTranslations();

    return (
        <DataTable
            columns={columns}
            data={data}
            persistPageSize="shareLinks-table"
            title={t("shareLinks")}
            searchPlaceholder={t("shareSearch")}
            searchColumn="name"
            onAdd={createShareLink}
            onRefresh={onRefresh}
            isRefreshing={isRefreshing}
            addButtonText={t("shareCreate")}
            enableColumnVisibility={true}
            stickyLeftColumn="title"
            stickyRightColumn="delete"
        />
    );
}
