"use client";

import { Timestamp } from "@app/components/Timestamp";
import { ColumnDef } from "@tanstack/react-table";
import { ExtendedColumnDef } from "@app/components/ui/data-table";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger
} from "@app/components/ui/dropdown-menu";
import { Button } from "@app/components/ui/button";
import { ArrowRight, ArrowUpDown, MoreHorizontal } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import ConfirmDeleteDialog from "@app/components/ConfirmDeleteDialog";
import { toast } from "@app/hooks/useToast";
import { formatAxiosError } from "@app/lib/api";
import { createApiClient } from "@app/lib/api";
import { useEnvContext } from "@app/hooks/useEnvContext";
import { ApiKeysDataTable } from "@app/components/ApiKeysDataTable";
import { useTranslations } from "next-intl";

export type ApiKeyRow = {
    id: string;
    key: string;
    name: string;
    createdAt: string;
};

type ApiKeyTableProps = {
    apiKeys: ApiKeyRow[];
};

export default function ApiKeysTable({ apiKeys }: ApiKeyTableProps) {
    const router = useRouter();

    const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
    const [selected, setSelected] = useState<ApiKeyRow | null>(null);
    const [rows, setRows] = useState<ApiKeyRow[]>(apiKeys);

    const api = createApiClient(useEnvContext());

    const t = useTranslations();

    const [isRefreshing, setIsRefreshing] = useState(false);

    const refreshData = async () => {
        console.log("Data refreshed");
        setIsRefreshing(true);
        try {
            await new Promise((resolve) => setTimeout(resolve, 200));
            router.refresh();
        } catch (error) {
            toast({
                title: t("error"),
                description: t("refreshError"),
                variant: "destructive"
            });
        } finally {
            setIsRefreshing(false);
        }
    };

    const deleteSite = (apiKeyId: string) => {
        api.delete(`/api-key/${apiKeyId}`)
            .catch((e) => {
                console.error(t("apiKeysErrorDelete"), e);
                toast({
                    variant: "destructive",
                    title: t("apiKeysErrorDelete"),
                    description: formatAxiosError(
                        e,
                        t("apiKeysErrorDeleteMessage")
                    )
                });
            })
            .then(() => {
                router.refresh();
                setIsDeleteModalOpen(false);

                const newRows = rows.filter((row) => row.id !== apiKeyId);

                setRows(newRows);
            });
    };

    const columns: ExtendedColumnDef<ApiKeyRow>[] = [
        {
            accessorKey: "name",
            enableHiding: false,
            friendlyName: t("name"),
            header: ({ column }) => {
                return (
                    <Button
                        variant="ghost"
                        onClick={() =>
                            column.toggleSorting(column.getIsSorted() === "asc")
                        }
                    >
                        {t("name")}
                        <ArrowUpDown className="ml-2 h-4 w-4" />
                    </Button>
                );
            }
        },
        {
            accessorKey: "key",
            friendlyName: t("key"),
            header: () => <span className="p-3">{t("key")}</span>,
            cell: ({ row }) => {
                const r = row.original;
                return <span className="font-mono">{r.key}</span>;
            }
        },
        {
            accessorKey: "createdAt",
            friendlyName: t("createdAt"),
            header: () => <span className="p-3">{t("createdAt")}</span>,
            cell: ({ row }) => {
                const r = row.original;
                return (
                    <span>
                        <Timestamp value={r.createdAt} />{" "}
                    </span>
                );
            }
        },
        {
            id: "actions",
            enableHiding: false,
            header: () => <span className="p-3"></span>,
            cell: ({ row }) => {
                const r = row.original;
                return (
                    <div className="flex items-center gap-2 justify-end">
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
                                <DropdownMenuItem
                                    onClick={() => {
                                        setSelected(r);
                                    }}
                                >
                                    <span>{t("viewSettings")}</span>
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                    onClick={() => {
                                        setSelected(r);
                                        setIsDeleteModalOpen(true);
                                    }}
                                >
                                    <span className="text-red-500">
                                        {t("delete")}
                                    </span>
                                </DropdownMenuItem>
                            </DropdownMenuContent>
                        </DropdownMenu>
                        <Link href={`/admin/api-keys/${r.id}`}>
                            <Button variant={"outline"}>
                                {t("edit")}
                                <ArrowRight className="ml-2 w-4 h-4" />
                            </Button>
                        </Link>
                    </div>
                );
            }
        }
    ];

    return (
        <>
            {selected && (
                <ConfirmDeleteDialog
                    open={isDeleteModalOpen}
                    setOpen={(val) => {
                        setIsDeleteModalOpen(val);
                        setSelected(null);
                    }}
                    dialog={
                        <div className="space-y-2">
                            <p>{t("apiKeysQuestionRemove")}</p>

                            <p>{t("apiKeysMessageRemove")}</p>
                        </div>
                    }
                    buttonText={t("apiKeysDeleteConfirm")}
                    onConfirm={async () => deleteSite(selected!.id)}
                    string={selected.name}
                    title={t("apiKeysDelete")}
                />
            )}

            <ApiKeysDataTable
                columns={columns}
                data={rows}
                addApiKey={() => {
                    router.push(`/admin/api-keys/create`);
                }}
                onRefresh={refreshData}
                isRefreshing={isRefreshing}
            />
        </>
    );
}
