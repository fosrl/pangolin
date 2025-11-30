"use client";

import { Column, ColumnDef } from "@tanstack/react-table";
import { SitesDataTable } from "@app/components/SitesDataTable";
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
    Check,
    MoreHorizontal,
    X
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AxiosResponse } from "axios";
import { useState, useEffect } from "react";
import ConfirmDeleteDialog from "@app/components/ConfirmDeleteDialog";
import { toast } from "@app/hooks/useToast";
import { formatAxiosError } from "@app/lib/api";
import { createApiClient } from "@app/lib/api";
import { useEnvContext } from "@app/hooks/useEnvContext";
import { useTranslations } from "next-intl";
import { parseDataSize } from "@app/lib/dataSize";
import { Badge } from "@app/components/ui/badge";
import { InfoPopup } from "@app/components/ui/info-popup";
import { build } from "@server/build";

export type SiteRow = {
    id: number;
    nice: string;
    name: string;
    mbIn: string;
    mbOut: string;
    orgId: string;
    type: "newt" | "wireguard";
    newtVersion?: string;
    newtUpdateAvailable?: boolean;
    online: boolean;
    address?: string;
    exitNodeName?: string;
    exitNodeEndpoint?: string;
};

type SitesTableProps = {
    sites: SiteRow[];
    orgId: string;
};

export default function SitesTable({ sites, orgId }: SitesTableProps) {
    const router = useRouter();

    const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
    const [selectedSite, setSelectedSite] = useState<SiteRow | null>(null);
    const [rows, setRows] = useState<SiteRow[]>(sites);
    const [isRefreshing, setIsRefreshing] = useState(false);

    const api = createApiClient(useEnvContext());
    const t = useTranslations();
    const { env } = useEnvContext();

    // Update local state when props change (e.g., after refresh)
    useEffect(() => {
        setRows(sites);
    }, [sites]);

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

    const deleteSite = (siteId: number) => {
        api.delete(`/site/${siteId}`)
            .catch((e) => {
                console.error(t("siteErrorDelete"), e);
                toast({
                    variant: "destructive",
                    title: t("siteErrorDelete"),
                    description: formatAxiosError(e, t("siteErrorDelete"))
                });
            })
            .then(() => {
                router.refresh();
                setIsDeleteModalOpen(false);

                const newRows = rows.filter((row) => row.id !== siteId);

                setRows(newRows);
            });
    };

    const columns: ColumnDef<SiteRow>[] = [
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
            accessorKey: "online",
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
                if (
                    originalRow.type == "newt" ||
                    originalRow.type == "wireguard"
                ) {
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
                } else {
                    return <span>-</span>;
                }
            }
        },
        {
            accessorKey: "nice",
            header: ({ column }) => {
                return (
                    <Button
                        variant="ghost"
                        onClick={() =>
                            column.toggleSorting(column.getIsSorted() === "asc")
                        }
                        className="hidden md:flex whitespace-nowrap"
                    >
                        {t("site")}
                        <ArrowUpDown className="ml-2 h-4 w-4" />
                    </Button>
                );
            },
            cell: ({ row }) => {
                return (
                    <div className="hidden md:block whitespace-nowrap">
                        {row.original.nice}
                    </div>
                );
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
                        {t("dataIn")}
                        <ArrowUpDown className="ml-2 h-4 w-4" />
                    </Button>
                );
            },
            sortingFn: (rowA, rowB) =>
                parseDataSize(rowA.original.mbIn) -
                parseDataSize(rowB.original.mbIn)
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
                        {t("dataOut")}
                        <ArrowUpDown className="ml-2 h-4 w-4" />
                    </Button>
                );
            },
            sortingFn: (rowA, rowB) =>
                parseDataSize(rowA.original.mbOut) -
                parseDataSize(rowB.original.mbOut)
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
                        {t("connectionType")}
                        <ArrowUpDown className="ml-2 h-4 w-4" />
                    </Button>
                );
            },
            cell: ({ row }) => {
                const originalRow = row.original;

                if (originalRow.type === "newt") {
                    return (
                        <div className="flex items-center space-x-1">
                            <Badge variant="secondary">
                                <div className="flex items-center space-x-2">
                                    <span>Newt</span>
                                    {originalRow.newtVersion && (
                                        <span className="text-xs text-gray-500">
                                            v{originalRow.newtVersion}
                                        </span>
                                    )}
                                </div>
                            </Badge>
                            {originalRow.newtUpdateAvailable && (
                                <InfoPopup
                                    info={t("newtUpdateAvailableInfo")}
                                />
                            )}
                        </div>
                    );
                }

                if (originalRow.type === "wireguard") {
                    return (
                        <div className="flex items-center space-x-2">
                            <span>WireGuard</span>
                        </div>
                    );
                }

                if (originalRow.type === "local") {
                    return (
                        <div className="flex items-center space-x-2">
                            <span>{t("local")}</span>
                        </div>
                    );
                }
            }
        },
        {
            accessorKey: "exitNode",
            header: ({ column }) => {
                return (
                    <Button
                        variant="ghost"
                        onClick={() =>
                            column.toggleSorting(column.getIsSorted() === "asc")
                        }
                    >
                        {t("exitNode")}
                        <ArrowUpDown className="ml-2 h-4 w-4" />
                    </Button>
                );
            },
            cell: ({ row }) => {
                const originalRow = row.original;
                return originalRow.exitNodeName ? (
                    <div className="flex items-center space-x-2">
                        <span>{originalRow.exitNodeName}</span>
                        {build == "saas" &&
                            originalRow.exitNodeName &&
                            [
                                "mercury",
                                "venus",
                                "earth",
                                "mars",
                                "jupiter",
                                "saturn",
                                "uranus",
                                "neptune"
                            ].includes(
                                originalRow.exitNodeName.toLowerCase()
                            ) && <Badge variant="secondary">Cloud</Badge>}
                    </div>
                ) : (
                    "-"
                );
            }
        },
        ...(env.flags.enableClients
            ? [
                  {
                      accessorKey: "address",
                      header: ({
                          column
                      }: {
                          column: Column<SiteRow, unknown>;
                      }) => {
                          return (
                              <Button
                                  variant="ghost"
                                  onClick={() =>
                                      column.toggleSorting(
                                          column.getIsSorted() === "asc"
                                      )
                                  }
                              >
                                  Address
                                  <ArrowUpDown className="ml-2 h-4 w-4" />
                              </Button>
                          );
                      },
                      cell: ({ row }: { row: any }) => {
                          const originalRow = row.original;
                          return originalRow.address ? (
                              <div className="flex items-center space-x-2">
                                  <span>{originalRow.address}</span>
                              </div>
                          ) : (
                              "-"
                          );
                      }
                  }
              ]
            : []),
        {
            id: "actions",
            cell: ({ row }) => {
                const siteRow = row.original;
                return (
                    <div className="flex items-center justify-end gap-2">
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
                                    href={`/${siteRow.orgId}/settings/sites/${siteRow.nice}`}
                                >
                                    <DropdownMenuItem>
                                        {t("viewSettings")}
                                    </DropdownMenuItem>
                                </Link>
                                <DropdownMenuItem
                                    onClick={() => {
                                        setSelectedSite(siteRow);
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
                            href={`/${siteRow.orgId}/settings/sites/${siteRow.nice}`}
                        >
                            <Button variant={"secondary"} size="sm">
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
            {selectedSite && (
                <ConfirmDeleteDialog
                    open={isDeleteModalOpen}
                    setOpen={(val) => {
                        setIsDeleteModalOpen(val);
                        setSelectedSite(null);
                    }}
                    dialog={
                        <div className="">
                            <p>
                                {t("siteQuestionRemove")}
                            </p>
                            <p>{t("siteMessageRemove")}</p>
                        </div>
                    }
                    buttonText={t("siteConfirmDelete")}
                    onConfirm={async () => deleteSite(selectedSite!.id)}
                    string={selectedSite.name}
                    title={t("siteDelete")}
                />
            )}

            <SitesDataTable
                columns={columns}
                data={rows}
                createSite={() =>
                    router.push(`/${orgId}/settings/sites/create`)
                }
                onRefresh={refreshData}
                isRefreshing={isRefreshing}
            />
        </>
    );
}
