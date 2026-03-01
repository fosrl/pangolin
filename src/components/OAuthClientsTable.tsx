"use client";

import { ExtendedColumnDef } from "@app/components/ui/data-table";
import { DataTable } from "@app/components/ui/data-table";
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
import { useEffect, useState } from "react";
import ConfirmDeleteDialog from "@app/components/ConfirmDeleteDialog";
import { Badge } from "@app/components/ui/badge";
import { toast } from "@app/hooks/useToast";
import { createApiClient, formatAxiosError } from "@app/lib/api";
import { useEnvContext } from "@app/hooks/useEnvContext";
import { useTranslations } from "next-intl";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle
} from "@app/components/ui/dialog";
import CopyTextBox from "@app/components/CopyTextBox";

export type OAuthClientRow = {
    clientId: string;
    clientName: string;
    redirectUris: string[];
    scopes: string;
    enabled: boolean;
    createdAt: string;
    lastChars: string;
};

type OAuthClientsTableProps = {
    clients: OAuthClientRow[];
    orgId: string;
};

export default function OAuthClientsTable({
    clients,
    orgId
}: OAuthClientsTableProps) {
    const router = useRouter();
    const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
    const [selected, setSelected] = useState<OAuthClientRow | null>(null);
    const [rows, setRows] = useState<OAuthClientRow[]>(clients);
    useEffect(() => {
        setRows(clients);
    }, [clients]);
    const [isRefreshing, setIsRefreshing] = useState(false);
    const [rotatedSecret, setRotatedSecret] = useState<{
        clientId: string;
        clientSecret: string;
    } | null>(null);

    const api = createApiClient(useEnvContext());
    const t = useTranslations();

    const refreshData = async () => {
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

    const deleteClient = async (clientId: string) => {
        try {
            await api.delete(`/org/${orgId}/oauth-clients/${clientId}`);
            router.refresh();
            setIsDeleteModalOpen(false);
            setRows((prev) =>
                prev.filter((row) => row.clientId !== clientId)
            );
        } catch (e) {
            toast({
                variant: "destructive",
                title: t("oauthClientDeleteErrorTitle"),
                description: formatAxiosError(e)
            });
        }
    };

    const rotateSecret = async (clientId: string) => {
        try {
            const res = await api.post(
                `/org/${orgId}/oauth-clients/${clientId}/rotate-secret`
            );
            setRotatedSecret(res.data.data);
            toast({
                title: t("oauthClientRotateSuccessTitle"),
                description: t("oauthClientRotateSuccessDescription")
            });
        } catch (error) {
            toast({
                variant: "destructive",
                title: t("oauthClientRotateErrorTitle"),
                description: formatAxiosError(error)
            });
        }
    };

    const columns: ExtendedColumnDef<OAuthClientRow>[] = [
        {
            accessorKey: "clientName",
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
            accessorKey: "clientId",
            friendlyName: t("oauthClientIdHeader"),
            header: () => (
                <span className="p-3">{t("oauthClientIdHeader")}</span>
            ),
            cell: ({ row }) => {
                const id = row.original.clientId;
                const truncated =
                    id.length > 14
                        ? `${id.slice(0, 8)}...${id.slice(-4)}`
                        : id;
                return <span className="font-mono text-xs">{truncated}</span>;
            }
        },
        {
            accessorKey: "redirectUris",
            friendlyName: t("oauthClientRedirectUrisHeader"),
            header: () => (
                <span className="p-3">
                    {t("oauthClientRedirectUrisHeader")}
                </span>
            ),
            cell: ({ row }) => {
                const uris = row.original.redirectUris;
                return (
                    <span className="text-xs">
                        {uris.length > 0 ? uris.join(", ") : "-"}
                    </span>
                );
            }
        },
        {
            accessorKey: "enabled",
            friendlyName: t("status"),
            header: () => <span className="p-3">{t("status")}</span>,
            cell: ({ row }) => {
                return row.original.enabled ? (
                    <Badge variant="secondary">{t("enabled")}</Badge>
                ) : (
                    <Badge variant="outline">{t("disabled")}</Badge>
                );
            }
        },
        {
            accessorKey: "createdAt",
            friendlyName: t("createdAt"),
            header: () => <span className="p-3">{t("createdAt")}</span>,
            cell: ({ row }) => {
                return (
                    <span>
                        {new Date(row.original.createdAt).toLocaleDateString()}
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
                                <Button
                                    variant="ghost"
                                    className="h-8 w-8 p-0"
                                >
                                    <span className="sr-only">
                                        {t("openMenu")}
                                    </span>
                                    <MoreHorizontal className="h-4 w-4" />
                                </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                                <Link
                                    className="block w-full"
                                    href={`/${orgId}/settings/oauth-clients/${r.clientId}`}
                                >
                                    <DropdownMenuItem>
                                        {t("viewSettings")}
                                    </DropdownMenuItem>
                                </Link>
                                <DropdownMenuItem
                                    onClick={() => rotateSecret(r.clientId)}
                                >
                                    {t("oauthClientRotateButton")}
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
                        <Link
                            href={`/${orgId}/settings/oauth-clients/${r.clientId}`}
                        >
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
                            <p>{t("oauthClientDeleteConfirm")}</p>
                        </div>
                    }
                    buttonText={t("oauthClientDeleteButton")}
                    onConfirm={async () => deleteClient(selected!.clientId)}
                    string={selected.clientName}
                    title={t("oauthClientDeleteButton")}
                />
            )}

            <Dialog
                open={Boolean(rotatedSecret)}
                onOpenChange={(open) => {
                    if (!open) {
                        setRotatedSecret(null);
                    }
                }}
            >
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>
                            {t("oauthClientNewSecretDialogTitle")}
                        </DialogTitle>
                        <DialogDescription>
                            {t("oauthClientNewSecretDialogDescription")}
                        </DialogDescription>
                    </DialogHeader>
                    {rotatedSecret && (
                        <CopyTextBox
                            text={`${rotatedSecret.clientId}.${rotatedSecret.clientSecret}`}
                            wrapText
                        />
                    )}
                </DialogContent>
            </Dialog>

            <DataTable
                columns={columns}
                data={rows}
                persistPageSize="oauth-clients-table"
                searchPlaceholder={t("oauthClientsSearch")}
                searchColumn="clientName"
                onAdd={() => {
                    router.push(`/${orgId}/settings/oauth-clients/create`);
                }}
                onRefresh={refreshData}
                isRefreshing={isRefreshing}
                addButtonText={t("oauthClientsCreateButton")}
                enableColumnVisibility={true}
                stickyLeftColumn="clientName"
                stickyRightColumn="actions"
            />
        </>
    );
}
