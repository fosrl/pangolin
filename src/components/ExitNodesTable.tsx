"use client";

import { ColumnDef } from "@tanstack/react-table";
import { ExtendedColumnDef } from "@app/components/ui/data-table";
import { ExitNodesDataTable } from "@app/components/ExitNodesDataTable";
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
import { useState, useEffect } from "react";
import ConfirmDeleteDialog from "@app/components/ConfirmDeleteDialog";
import { toast } from "@app/hooks/useToast";
import { formatAxiosError } from "@app/lib/api";
import { createApiClient } from "@app/lib/api";
import { useEnvContext } from "@app/hooks/useEnvContext";
import { useTranslations } from "next-intl";
import { Badge } from "@app/components/ui/badge";

export type RemoteExitNodeRow = {
    id: string;
    exitNodeId: number | null;
    name: string;
    address: string;
    endpoint: string;
    orgId: string;
    type: string | null;
    online: boolean;
    dateCreated: string;
    version?: string;
};

type ExitNodesTableProps = {
    remoteExitNodes: RemoteExitNodeRow[];
    orgId: string;
};

export default function ExitNodesTable({
    remoteExitNodes,
    orgId
}: ExitNodesTableProps) {
    const router = useRouter();

    const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
    const [selectedNode, setSelectedNode] = useState<RemoteExitNodeRow | null>(
        null
    );
    const [rows, setRows] = useState<RemoteExitNodeRow[]>(remoteExitNodes);
    const [isRefreshing, setIsRefreshing] = useState(false);

    const api = createApiClient(useEnvContext());
    const t = useTranslations();

    useEffect(() => {
        setRows(remoteExitNodes);
    }, [remoteExitNodes]);

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

    const deleteRemoteExitNode = (remoteExitNodeId: string) => {
        api.delete(`/org/${orgId}/remote-exit-node/${remoteExitNodeId}`)
            .catch((e) => {
                console.error(t("remoteExitNodeErrorDelete"), e);
                toast({
                    variant: "destructive",
                    title: t("remoteExitNodeErrorDelete"),
                    description: formatAxiosError(
                        e,
                        t("remoteExitNodeErrorDelete")
                    )
                });
            })
            .then(() => {
                setIsDeleteModalOpen(false);

                const newRows = rows.filter(
                    (row) => row.id !== remoteExitNodeId
                );
                setRows(newRows);
            });
    };

    const columns: ExtendedColumnDef<RemoteExitNodeRow>[] = [
        {
            accessorKey: "name",
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
            accessorKey: "online",
            friendlyName: t("online"),
            header: ({ column }) => {
                return (
                    <Button
                        variant="ghost"
                        onClick={() =>
                            column.toggleSorting(column.getIsSorted() === "asc")
                        }
                    >
                        {t("online")}
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
                            <span>{t("online")}</span>
                        </span>
                    );
                } else {
                    return (
                        <span className="text-neutral-500 flex items-center space-x-2">
                            <div className="w-2 h-2 bg-gray-500 rounded-full"></div>
                            <span>{t("offline")}</span>
                        </span>
                    );
                }
            }
        },
        {
            accessorKey: "type",
            friendlyName: t("connectionType"),
            header: ({ column }) => {
                return (
                    <Button
                        variant="ghost"
                        onClick={() =>
                            column.toggleSorting(column.getIsSorted() === "asc")
                        }
                    >
                        {t("connectionType")}
                        <ArrowUpDown className="ml-2 h-4 w-4" />
                    </Button>
                );
            },
            cell: ({ row }) => {
                const originalRow = row.original;
                return (
                    <Badge variant="secondary">
                        {originalRow.type === "remoteExitNode"
                            ? "Remote Exit Node"
                            : originalRow.type}
                    </Badge>
                );
            }
        },
        {
            accessorKey: "address",
            friendlyName: "Address",
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
            accessorKey: "endpoint",
            friendlyName: "Endpoint",
            header: ({ column }) => {
                return (
                    <Button
                        variant="ghost"
                        onClick={() =>
                            column.toggleSorting(column.getIsSorted() === "asc")
                        }
                    >
                        Endpoint
                        <ArrowUpDown className="ml-2 h-4 w-4" />
                    </Button>
                );
            }
        },
        {
            accessorKey: "version",
            header: ({ column }) => {
                return (
                    <Button
                        variant="ghost"
                        onClick={() =>
                            column.toggleSorting(column.getIsSorted() === "asc")
                        }
                    >
                        Version
                        <ArrowUpDown className="ml-2 h-4 w-4" />
                    </Button>
                );
            },
            cell: ({ row }) => {
                const originalRow = row.original;
                return (
                    <div className="flex items-center space-x-1">
                        {originalRow.version && originalRow.version ? (
                            <Badge variant="secondary">
                                {"v" + originalRow.version}
                            </Badge>
                        ) : (
                            "-"
                        )}
                    </div>
                );
            }
        },
        {
            id: "actions",
            enableHiding: false,
            header: () => <span className="p-3"></span>,
            cell: ({ row }) => {
                const nodeRow = row.original;
                const remoteExitNodeId = nodeRow.id;
                return (
                    <div className="flex items-center gap-2 justify-end">
                        <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                                <Button variant="ghost" className="h-8 w-8 p-0">
                                    <span className="sr-only">Open menu</span>
                                    <MoreHorizontal className="h-4 w-4" />
                                </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                                <Link
                                    className="block w-full"
                                    href={`/${nodeRow.orgId}/settings/remote-exit-nodes/${remoteExitNodeId}`}
                                >
                                    <DropdownMenuItem>
                                        {t("viewSettings")}
                                    </DropdownMenuItem>
                                </Link>
                                <DropdownMenuItem
                                    onClick={() => {
                                        setSelectedNode(nodeRow);
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
                            href={`/${nodeRow.orgId}/settings/remote-exit-nodes/${remoteExitNodeId}`}
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
            {selectedNode && (
                <ConfirmDeleteDialog
                    open={isDeleteModalOpen}
                    setOpen={(val) => {
                        setIsDeleteModalOpen(val);
                        setSelectedNode(null);
                    }}
                    dialog={
                        <div className="space-y-2">
                            <p>{t("remoteExitNodeQuestionRemove")}</p>

                            <p>{t("remoteExitNodeMessageRemove")}</p>
                        </div>
                    }
                    buttonText={t("remoteExitNodeConfirmDelete")}
                    onConfirm={async () =>
                        deleteRemoteExitNode(selectedNode!.id)
                    }
                    string={selectedNode.name}
                    title={t("remoteExitNodeDelete")}
                />
            )}

            <ExitNodesDataTable
                columns={columns}
                data={rows}
                createRemoteExitNode={() =>
                    router.push(`/${orgId}/settings/remote-exit-nodes/create`)
                }
                onRefresh={refreshData}
                isRefreshing={isRefreshing}
                columnVisibility={{
                    type: false,
                    address: false,
                }}
                enableColumnVisibility={true}
            />
        </>
    );
}
