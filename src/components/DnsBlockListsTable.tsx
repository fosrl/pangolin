"use client";

import ConfirmDeleteDialog from "@app/components/ConfirmDeleteDialog";
import { Button } from "@app/components/ui/button";
import {
    DataTable,
    type ExtendedColumnDef
} from "@app/components/ui/data-table";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger
} from "@app/components/ui/dropdown-menu";
import { useEnvContext } from "@app/hooks/useEnvContext";
import { toast } from "@app/hooks/useToast";
import { createApiClient, formatAxiosError } from "@app/lib/api";
import type { DnsBlockListSummary } from "@server/routers/dnsBlocking/types";
import { ArrowUpDown, MoreHorizontal } from "lucide-react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

type DnsBlockListsTableProps = {
    orgId: string;
    lists: DnsBlockListSummary[];
};

export default function DnsBlockListsTable({
    orgId,
    lists
}: DnsBlockListsTableProps) {
    const router = useRouter();
    const t = useTranslations();
    const api = createApiClient(useEnvContext());
    const [selected, setSelected] = useState<DnsBlockListSummary | null>(null);
    const [isDeleteOpen, setIsDeleteOpen] = useState(false);
    const [isRefreshing, startRefresh] = useTransition();
    const [, startNavigation] = useTransition();

    async function deleteList(list: DnsBlockListSummary) {
        try {
            await api.delete(
                `/org/${orgId}/dns-block-list/${list.dnsBlockListId}`
            );
            toast({
                title: t("success"),
                description: t("dnsBlockListDeleted")
            });
            setIsDeleteOpen(false);
            setSelected(null);
            router.refresh();
        } catch (e) {
            toast({
                variant: "destructive",
                title: t("dnsBlockListErrorDelete"),
                description: formatAxiosError(e)
            });
        }
    }

    const columns: ExtendedColumnDef<DnsBlockListSummary>[] = [
        {
            accessorKey: "name",
            enableHiding: false,
            friendlyName: t("name"),
            header: ({ column }) => (
                <Button
                    variant="ghost"
                    onClick={() =>
                        column.toggleSorting(column.getIsSorted() === "asc")
                    }
                >
                    {t("name")}
                    <ArrowUpDown className="ml-2 h-4 w-4" />
                </Button>
            )
        },
        {
            accessorKey: "description",
            friendlyName: t("description"),
            header: () => <span className="p-3">{t("description")}</span>,
            cell: ({ row }) => row.original.description ?? ""
        },
        {
            accessorKey: "domainCount",
            friendlyName: t("dnsBlockListDomains"),
            header: ({ column }) => (
                <Button
                    variant="ghost"
                    onClick={() =>
                        column.toggleSorting(column.getIsSorted() === "asc")
                    }
                >
                    {t("dnsBlockListDomains")}
                    <ArrowUpDown className="ml-2 h-4 w-4" />
                </Button>
            ),
            cell: ({ row }) =>
                t("dnsBlockListDomainCount", {
                    count: row.original.domainCount
                })
        },
        {
            accessorKey: "updatedAt",
            friendlyName: t("dnsBlockListLastUpdated"),
            header: ({ column }) => (
                <Button
                    variant="ghost"
                    onClick={() =>
                        column.toggleSorting(column.getIsSorted() === "asc")
                    }
                >
                    {t("dnsBlockListLastUpdated")}
                    <ArrowUpDown className="ml-2 h-4 w-4" />
                </Button>
            ),
            cell: ({ row }) =>
                new Date(row.original.updatedAt * 1000).toLocaleString()
        },
        {
            id: "actions",
            enableHiding: false,
            header: () => <span className="p-3"></span>,
            cell: ({ row }) => {
                const list = row.original;
                return (
                    <div className="flex items-center gap-2 justify-end">
                        <Link
                            href={`/${orgId}/settings/dns-blocking/${list.dnsBlockListId}`}
                        >
                            <Button variant="outline" size="sm">
                                {t("edit")}
                            </Button>
                        </Link>
                        <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                                <Button variant="ghost" className="h-8 w-8 p-0">
                                    <span className="sr-only">
                                        {t("openMenu")}
                                    </span>
                                    <MoreHorizontal className="h-4 w-4" />
                                </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                                <Link
                                    className="block w-full"
                                    href={`/${orgId}/settings/dns-blocking/${list.dnsBlockListId}`}
                                >
                                    <DropdownMenuItem>
                                        {t("edit")}
                                    </DropdownMenuItem>
                                </Link>
                                <DropdownMenuItem
                                    onClick={() => {
                                        setSelected(list);
                                        setIsDeleteOpen(true);
                                    }}
                                >
                                    <span className="text-red-500">
                                        {t("delete")}
                                    </span>
                                </DropdownMenuItem>
                            </DropdownMenuContent>
                        </DropdownMenu>
                    </div>
                );
            }
        }
    ];

    return (
        <>
            {selected && (
                <ConfirmDeleteDialog
                    open={isDeleteOpen}
                    setOpen={(val) => {
                        setIsDeleteOpen(val);
                        if (!val) setSelected(null);
                    }}
                    dialog={
                        <div className="space-y-2">
                            <p>
                                {t("dnsBlockListDeleteQuestion", {
                                    name: selected.name
                                })}
                            </p>
                            <p>{t("dnsBlockListDeleteWarning")}</p>
                        </div>
                    }
                    buttonText={t("dnsBlockListDeleteButton")}
                    onConfirm={async () => deleteList(selected)}
                    string={selected.name}
                    title={t("dnsBlockListDeleteButton")}
                />
            )}

            <DataTable
                columns={columns}
                data={lists}
                persistPageSize="dns-block-lists-table"
                title={t("sidebarDnsBlocking")}
                searchPlaceholder={t("dnsBlockListsSearch")}
                searchColumn="name"
                addButtonText={t("dnsBlockListAdd")}
                onAdd={() =>
                    startNavigation(() =>
                        router.push(`/${orgId}/settings/dns-blocking/create`)
                    )
                }
                onRefresh={() => startRefresh(() => router.refresh())}
                isRefreshing={isRefreshing}
                enableColumnVisibility={true}
                stickyLeftColumn="name"
                stickyRightColumn="actions"
            />
        </>
    );
}
