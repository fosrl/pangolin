"use client";

import { ColumnDef } from "@tanstack/react-table";
import {
    DataTable,
    type DataTableAddAction
} from "@app/components/ui/data-table";
import { useTranslations } from "next-intl";

interface DataTableProps<TData, TValue> {
    columns: ColumnDef<TData, TValue>[];
    data: TData[];
    onAdd?: () => void;
    addActions?: DataTableAddAction[];
    onRefresh?: () => void;
    isRefreshing?: boolean;
}

export function DomainsDataTable<TData, TValue>({
    columns,
    data,
    onAdd,
    addActions,
    onRefresh,
    isRefreshing
}: DataTableProps<TData, TValue>) {
    const t = useTranslations();

    return (
        <DataTable
            columns={columns}
            data={data}
            persistPageSize="domains-table"
            title={t("domains")}
            searchPlaceholder={t("domainsSearch")}
            searchColumn="baseDomain"
            addButtonText={t("domainAdd")}
            onAdd={onAdd}
            addActions={addActions}
            onRefresh={onRefresh}
            isRefreshing={isRefreshing}
            enableColumnVisibility={true}
            stickyLeftColumn="baseDomain"
            stickyRightColumn="actions"
        />
    );
}
