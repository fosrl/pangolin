"use client";

import { ColumnDef } from "@tanstack/react-table";
import { OrgApiKeysDataTable } from "@app/components/OrgApiKeysDataTable";
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
import moment from "moment";
import { useTranslations } from "next-intl";

export type OrgApiKeyRow = {
    id: string;
    key: string;
    name: string;
    createdAt: string;
};

type OrgApiKeyTableProps = {
    apiKeys: OrgApiKeyRow[];
    orgId: string;
};

export default function OrgApiKeysTable({
    apiKeys,
    orgId
}: OrgApiKeyTableProps) {
    const router = useRouter();

    const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
    const [selected, setSelected] = useState<OrgApiKeyRow | null>(null);
    const [rows, setRows] = useState<OrgApiKeyRow[]>(apiKeys);

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
        api.delete(`/org/${orgId}/api-key/${apiKeyId}`)
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

    const columns: ColumnDef<OrgApiKeyRow>[] = [
        {
            accessorKey: "name",
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
            header: t("key"),
            cell: ({ row }) => {
                const r = row.original;
                return <span className="font-mono">{r.key}</span>;
            }
        },
        {
            accessorKey: "createdAt",
            header: t("createdAt"),
            cell: ({ row }) => {
                const r = row.original;
                return <span>{moment(r.createdAt).format("lll")}</span>;
            }
        },
        {
            id: "actions",
            cell: ({ row }) => {
                const r = row.original;
                return (
                    <div className="flex items-center justify-end">
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
                                    <Link href={`/${orgId}/settings/api-keys/${r.id}`}>
                                        {t("viewSettings")}
                                    </Link>
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

                        <Link href={`/${orgId}/settings/api-keys/${r.id}`}>
                            <Button
                                variant={"secondary"}
                                className="ml-2"
                                size="sm"
                            >
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
                        <div>
                            <p>
                                {t("apiKeysQuestionRemove")}
                            </p>

                            <p>
                                {t("apiKeysMessageRemove")}
                            </p>
                        </div>
                    }
                    buttonText={t("apiKeysDeleteConfirm")}
                    onConfirm={async () => deleteSite(selected!.id)}
                    string={selected.name}
                    title={t("apiKeysDelete")}
                />
            )}

            <OrgApiKeysDataTable
                columns={columns}
                data={rows}
                addApiKey={() => {
                    router.push(`/${orgId}/settings/api-keys/create`);
                }}
                onRefresh={refreshData}
                isRefreshing={isRefreshing}
            />
        </>
    );
}
