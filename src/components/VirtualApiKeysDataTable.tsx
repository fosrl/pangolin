"use client";

import { ColumnDef } from "@tanstack/react-table";
import { DataTable } from "@app/components/ui/data-table";
import { useTranslations } from "next-intl";

type DataTableProps<TData, TValue> = {
    columns: ColumnDef<TData, TValue>[];
    data: TData[];
    createVirtualApiKey?: () => void;
    onRefresh?: () => void;
    isRefreshing?: boolean;
};

export function VirtualApiKeysDataTable<TData, TValue>({
    columns,
    data,
    createVirtualApiKey,
    onRefresh,
    isRefreshing
}: DataTableProps<TData, TValue>) {
    const t = useTranslations();

    return (
        <DataTable
            columns={columns}
            data={data}
            persistPageSize="virtualApiKeys-table"
            title={t("virtualApiKeys")}
            searchPlaceholder={t("virtualApiKeysSearch")}
            searchColumn="name"
            onAdd={createVirtualApiKey}
            onRefresh={onRefresh}
            isRefreshing={isRefreshing}
            addButtonText={t("virtualApiKeysCreate")}
            enableColumnVisibility={true}
            stickyLeftColumn="name"
            stickyRightColumn="actions"
        />
    );
}
