"use client";

import { ColumnDef } from "@tanstack/react-table";
import { IdpDataTable } from "@app/components/AdminIdpDataTable";
import { Button } from "@app/components/ui/button";
import { ArrowRight, ArrowUpDown, MoreHorizontal } from "lucide-react";
import { useState } from "react";
import ConfirmDeleteDialog from "@app/components/ConfirmDeleteDialog";
import { toast } from "@app/hooks/useToast";
import { formatAxiosError } from "@app/lib/api";
import { createApiClient } from "@app/lib/api";
import { useEnvContext } from "@app/hooks/useEnvContext";
import { Badge } from "@app/components/ui/badge";
import { useRouter } from "next/navigation";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger
} from "@app/components/ui/dropdown-menu";
import Link from "next/link";
import { useTranslations } from "next-intl";
import IdpTypeBadge from "./IdpTypeBadge";

export type IdpRow = {
    idpId: number;
    name: string;
    type: string;
    orgCount: number;
    variant?: string;
};

type Props = {
    idps: IdpRow[];
};

export default function IdpTable({ idps }: Props) {
    const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
    const [selectedIdp, setSelectedIdp] = useState<IdpRow | null>(null);
    const api = createApiClient(useEnvContext());
    const router = useRouter();
    const [isRefreshing, setIsRefreshing] = useState(false);
    const t = useTranslations();

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

    const deleteIdp = async (idpId: number) => {
        try {
            await api.delete(`/idp/${idpId}`);
            toast({
                title: t("success"),
                description: t("idpDeletedDescription")
            });
            setIsDeleteModalOpen(false);
            router.refresh();
        } catch (e) {
            toast({
                title: t("error"),
                description: formatAxiosError(e),
                variant: "destructive"
            });
        }
    };

    const columns: ColumnDef<IdpRow>[] = [
        {
            accessorKey: "idpId",
            header: ({ column }) => {
                return (
                    <Button
                        variant="ghost"
                        onClick={() =>
                            column.toggleSorting(column.getIsSorted() === "asc")
                        }
                    >
                        ID
                        <ArrowUpDown className="ml-2 h-4 w-4" />
                    </Button>
                );
            }
        },
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
            accessorKey: "type",
            header: ({ column }) => {
                return (
                    <Button
                        variant="ghost"
                        onClick={() =>
                            column.toggleSorting(column.getIsSorted() === "asc")
                        }
                    >
                        {t("type")}
                        <ArrowUpDown className="ml-2 h-4 w-4" />
                    </Button>
                );
            },
            cell: ({ row }) => {
                const type = row.original.type;
                const variant = row.original.variant;
                return <IdpTypeBadge type={type} variant={variant} />;
            }
        },
        {
            id: "actions",
            cell: ({ row }) => {
                const siteRow = row.original;
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
                                <Link
                                    className="block w-full"
                                    href={`/admin/idp/${siteRow.idpId}/general`}
                                >
                                    <DropdownMenuItem>
                                        {t("viewSettings")}
                                    </DropdownMenuItem>
                                </Link>
                                <DropdownMenuItem
                                    onClick={() => {
                                        setSelectedIdp(siteRow);
                                        setIsDeleteModalOpen(true);
                                    }}
                                >
                                    <span className="text-red-500">
                                        {t("delete")}
                                    </span>
                                </DropdownMenuItem>
                            </DropdownMenuContent>
                        </DropdownMenu>
                        <Link href={`/admin/idp/${siteRow.idpId}/general`}>
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
            {selectedIdp && (
                <ConfirmDeleteDialog
                    open={isDeleteModalOpen}
                    setOpen={(val) => {
                        setIsDeleteModalOpen(val);
                        setSelectedIdp(null);
                    }}
                    dialog={
                        <div>
                            <p>
                                {t("idpQuestionRemove", {
                                    name: selectedIdp.name
                                })}
                            </p>
                            <p>
                                <b>{t("idpMessageRemove")}</b>
                            </p>
                            <p>{t("idpMessageConfirm")}</p>
                        </div>
                    }
                    buttonText={t("idpConfirmDelete")}
                    onConfirm={async () => deleteIdp(selectedIdp.idpId)}
                    string={selectedIdp.name}
                    title={t("idpDelete")}
                />
            )}

            <IdpDataTable
                columns={columns}
                data={idps}
                onRefresh={refreshData}
                isRefreshing={isRefreshing}
            />
        </>
    );
}
