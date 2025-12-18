"use client";

import { ColumnDef } from "@tanstack/react-table";
import { DataTable } from "@app/components/ui/data-table";
import { useTranslations } from "next-intl";

interface DataTableProps<TData, TValue> {
    columns: ColumnDef<TData, TValue>[];
    data: TData[];
    createRemoteExitNode?: () => void;
    onRefresh?: () => void;
    isRefreshing?: boolean;
    columnVisibility?: Record<string, boolean>;
    enableColumnVisibility?: boolean;
}

export function ExitNodesDataTable<TData, TValue>({
    columns,
    data,
    createRemoteExitNode,
    onRefresh,
    isRefreshing,
    columnVisibility,
    enableColumnVisibility
}: DataTableProps<TData, TValue>) {
    const t = useTranslations();

    return (
        <DataTable
            columns={columns}
            data={data}
            title={t("remoteExitNodes")}
            searchPlaceholder={t("searchRemoteExitNodes")}
            searchColumn="name"
            onAdd={createRemoteExitNode}
            addButtonText={t("remoteExitNodeAdd")}
            onRefresh={onRefresh}
            isRefreshing={isRefreshing}
            defaultSort={{
                id: "name",
                desc: false
            }}
            columnVisibility={columnVisibility}
            enableColumnVisibility={enableColumnVisibility}
            stickyLeftColumn="name"
            stickyRightColumn="actions"
        />
    );
}
