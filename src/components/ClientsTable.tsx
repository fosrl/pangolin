"use client";

import { ColumnDef } from "@tanstack/react-table";
import { ClientsDataTable } from "@app/components/ClientsDataTable";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger
} from "@app/components/ui/dropdown-menu";
import { Button } from "@app/components/ui/button";
import {
    ArrowRight,
    ArrowUpDown,
    ArrowUpRight,
    Check,
    MoreHorizontal,
    X
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import ConfirmDeleteDialog from "@app/components/ConfirmDeleteDialog";
import { toast } from "@app/hooks/useToast";
import { formatAxiosError } from "@app/lib/api";
import { createApiClient } from "@app/lib/api";
import { useEnvContext } from "@app/hooks/useEnvContext";
import { useTranslations } from "next-intl";
import { Badge } from "./ui/badge";
import { InfoPopup } from "./ui/info-popup";

export type ClientRow = {
    id: number;
    name: string;
    subnet: string;
    // siteIds: string;
    mbIn: string;
    mbOut: string;
    orgId: string;
    online: boolean;
    olmVersion?: string;
    olmUpdateAvailable: boolean;
};

type ClientTableProps = {
    clients: ClientRow[];
    orgId: string;
};

export default function ClientsTable({ clients, orgId }: ClientTableProps) {
    const router = useRouter();

    const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
    const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
    const [selectedClient, setSelectedClient] = useState<ClientRow | null>(
        null
    );
    const [rows, setRows] = useState<ClientRow[]>(clients);

    const api = createApiClient(useEnvContext());
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

    const deleteClient = (clientId: number) => {
        api.delete(`/client/${clientId}`)
            .catch((e) => {
                console.error("Error deleting client", e);
                toast({
                    variant: "destructive",
                    title: "Error deleting client",
                    description: formatAxiosError(e, "Error deleting client")
                });
            })
            .then(() => {
                router.refresh();
                setIsDeleteModalOpen(false);

                const newRows = rows.filter((row) => row.id !== clientId);

                setRows(newRows);
            });
    };

    const columns: ColumnDef<ClientRow>[] = [
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
                        Name
                        <ArrowUpDown className="ml-2 h-4 w-4" />
                    </Button>
                );
            }
        },
        // {
        //     accessorKey: "siteName",
        //     header: ({ column }) => {
        //         return (
        //             <Button
        //                 variant="ghost"
        //                 onClick={() =>
        //                     column.toggleSorting(column.getIsSorted() === "asc")
        //                 }
        //             >
        //                 Site
        //                 <ArrowUpDown className="ml-2 h-4 w-4" />
        //             </Button>
        //         );
        //     },
        //     cell: ({ row }) => {
        //         const r = row.original;
        //         return (
        //             <Link href={`/${r.orgId}/settings/sites/${r.siteId}`}>
        //                 <Button variant="outline">
        //                     {r.siteName}
        //                     <ArrowUpRight className="ml-2 h-4 w-4" />
        //                 </Button>
        //             </Link>
        //         );
        //     }
        // },
        {
            accessorKey: "online",
            header: ({ column }) => {
                return (
                    <Button
                        variant="ghost"
                        onClick={() =>
                            column.toggleSorting(column.getIsSorted() === "asc")
                        }
                    >
                        Connectivity
                        <ArrowUpDown className="ml-2 h-4 w-4" />
                    </Button>
                );
            },
            cell: ({ row }) => {
                const originalRow = row.original;
                if (originalRow.online) {
                    return (
                        <span className="text-green-500 flex items-center space-x-2">
                            <div className="w-2 h-2 bg-green-500 rounded-full"></div>
                            <span>Connected</span>
                        </span>
                    );
                } else {
                    return (
                        <span className="text-neutral-500 flex items-center space-x-2">
                            <div className="w-2 h-2 bg-gray-500 rounded-full"></div>
                            <span>Disconnected</span>
                        </span>
                    );
                }
            }
        },
        {
            accessorKey: "mbIn",
            header: ({ column }) => {
                return (
                    <Button
                        variant="ghost"
                        onClick={() =>
                            column.toggleSorting(column.getIsSorted() === "asc")
                        }
                    >
                        Data In
                        <ArrowUpDown className="ml-2 h-4 w-4" />
                    </Button>
                );
            }
        },
        {
            accessorKey: "mbOut",
            header: ({ column }) => {
                return (
                    <Button
                        variant="ghost"
                        onClick={() =>
                            column.toggleSorting(column.getIsSorted() === "asc")
                        }
                    >
                        Data Out
                        <ArrowUpDown className="ml-2 h-4 w-4" />
                    </Button>
                );
            }
        },
        {
            accessorKey: "client",
            header: ({ column }) => {
                return (
                    <Button
                        variant="ghost"
                        onClick={() =>
                            column.toggleSorting(column.getIsSorted() === "asc")
                        }
                    >
                        {t("client")}
                        <ArrowUpDown className="ml-2 h-4 w-4" />
                    </Button>
                );
            },
            cell: ({ row }) => {
                const originalRow = row.original;

                return (
                    <div className="flex items-center space-x-1">
                        <Badge variant="secondary">
                            <div className="flex items-center space-x-2">
                                <span>Olm</span>
                                {originalRow.olmVersion && (
                                    <span className="text-xs text-gray-500">
                                        v{originalRow.olmVersion}
                                    </span>
                                )}
                            </div>
                        </Badge>
                        {originalRow.olmUpdateAvailable && (
                            <InfoPopup
                                info={t("olmUpdateAvailableInfo")}
                            />
                        )}
                    </div>
                );
            }
        },
        {
            accessorKey: "subnet",
            header: ({ column }) => {
                return (
                    <Button
                        variant="ghost"
                        onClick={() =>
                            column.toggleSorting(column.getIsSorted() === "asc")
                        }
                    >
                        Address
                        <ArrowUpDown className="ml-2 h-4 w-4" />
                    </Button>
                );
            }
        },
        {
            id: "actions",
            cell: ({ row }) => {
                const clientRow = row.original;
                return (
                    <div className="flex items-center justify-end">

                        <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                                <Button variant="ghost" className="h-8 w-8 p-0">
                                    <span className="sr-only">Open menu</span>
                                    <MoreHorizontal className="h-4 w-4" />
                                </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                                {/* <Link */}
                                {/*     className="block w-full" */}
                                {/*     href={`/${clientRow.orgId}/settings/sites/${clientRow.nice}`} */}
                                {/* > */}
                                {/*     <DropdownMenuItem> */}
                                {/*         View settings */}
                                {/*     </DropdownMenuItem> */}
                                {/* </Link> */}
                                <DropdownMenuItem
                                    onClick={() => {
                                        setSelectedClient(clientRow);
                                        setIsDeleteModalOpen(true);
                                    }}
                                >
                                    <span className="text-red-500">Delete</span>
                                </DropdownMenuItem>
                            </DropdownMenuContent>
                        </DropdownMenu>
                        <Link
                            href={`/${clientRow.orgId}/settings/clients/${clientRow.id}`}
                        >
                            <Button variant={"secondary"} className="ml-2">
                                Edit
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
            {selectedClient && (
                <ConfirmDeleteDialog
                    open={isDeleteModalOpen}
                    setOpen={(val) => {
                        setIsDeleteModalOpen(val);
                        setSelectedClient(null);
                    }}
                    dialog={
                        <div>
                            <p>
                                {t("deleteClientQuestion")}
                            </p>
                            <p>
                                {t("clientMessageRemove")}
                            </p>
                        </div>
                    }
                    buttonText="Confirm Delete Client"
                    onConfirm={async () => deleteClient(selectedClient!.id)}
                    string={selectedClient.name}
                    title="Delete Client"
                />
            )}

            <ClientsDataTable
                columns={columns}
                data={rows}
                addClient={() => {
                    router.push(`/${orgId}/settings/clients/create`);
                }}
                onRefresh={refreshData}
                isRefreshing={isRefreshing}
            />
        </>
    );
}
