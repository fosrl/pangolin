"use client";

import ConfirmDeleteDialog from "@app/components/ConfirmDeleteDialog";
import { Button } from "@app/components/ui/button";
import { ExtendedColumnDef } from "@app/components/ui/data-table";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger
} from "@app/components/ui/dropdown-menu";
import { useEnvContext } from "@app/hooks/useEnvContext";
import { useNavigationContext } from "@app/hooks/useNavigationContext";
import { useOptimisticLabels } from "@app/hooks/useOptimisticLabels";
import { usePaidStatus } from "@app/hooks/usePaidStatus";
import { toast } from "@app/hooks/useToast";
import { createApiClient, formatAxiosError } from "@app/lib/api";
import { getNextSortOrder, getSortDirection } from "@app/lib/sortColumn";
import { tierMatrix } from "@server/lib/billing/tierMatrix";
import type { PaginationState } from "@tanstack/react-table";
import {
    ArrowDown01Icon,
    ArrowRight,
    ArrowUp10Icon,
    ChevronsUpDownIcon,
    CircleSlash,
    MoreHorizontal
} from "lucide-react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { startTransition, useMemo, useState, useTransition } from "react";
import { useDebouncedCallback } from "use-debounce";
import { ColumnFilterButton } from "./ColumnFilterButton";
import { LabelColumnFilterButton } from "./LabelColumnFilterButton";
import { LabelsTableCell } from "./LabelsTableCell";
import { Badge } from "./ui/badge";
import { ControlledDataTable } from "./ui/controlled-data-table";
import {
    productUpdatesQueries,
    type LatestVersionResponse
} from "@app/lib/queries";
import { useQuery } from "@tanstack/react-query";
import semver from "semver";
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
    userId: string | null;
    username: string | null;
    userEmail: string | null;
    niceId: string;
    agent: string | null;
    archived?: boolean;
    blocked?: boolean;
    approvalState: "approved" | "pending" | "denied";
    labels?: Array<{
        labelId: number;
        name: string;
        color: string;
    }>;
};

type ClientTableProps = {
    machineClients: ClientRow[];
    orgId: string;
    pagination: PaginationState;
    rowCount: number;
};

export default function MachineClientsTable({
    machineClients,
    orgId,
    pagination,
    rowCount
}: ClientTableProps) {
    const router = useRouter();

    const {
        navigate: filter,
        isNavigating: isFiltering,
        searchParams
    } = useNavigationContext();

    const t = useTranslations();

    const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
    const [selectedClient, setSelectedClient] = useState<ClientRow | null>(
        null
    );

    const api = createApiClient(useEnvContext());
    const [isRefreshing, startRefreshTransition] = useTransition();
    const [isNavigatingToAddPage, startNavigation] = useTransition();

    const { isPaidUser } = usePaidStatus();
    const data = useQuery(productUpdatesQueries.latestVersion(true));

    const latestPlatformVersions = data.data?.data;

    const defaultMachineColumnVisibility = {
        subnet: false,
        userId: false,
        niceId: false,
        labels: true
    };

    const refreshData = () => {
        startRefreshTransition(() => {
            try {
                router.refresh();
            } catch (error) {
                toast({
                    title: t("error"),
                    description: t("refreshError"),
                    variant: "destructive"
                });
            }
        });
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
                startTransition(() => {
                    router.refresh();
                    setIsDeleteModalOpen(false);
                });
            });
    };

    const archiveClient = (clientId: number) => {
        api.post(`/client/${clientId}/archive`)
            .catch((e) => {
                console.error("Error archiving client", e);
                toast({
                    variant: "destructive",
                    title: "Error archiving client",
                    description: formatAxiosError(e, "Error archiving client")
                });
            })
            .then(() => {
                startTransition(() => {
                    router.refresh();
                });
            });
    };

    const unarchiveClient = (clientId: number) => {
        api.post(`/client/${clientId}/unarchive`)
            .catch((e) => {
                console.error("Error unarchiving client", e);
                toast({
                    variant: "destructive",
                    title: "Error unarchiving client",
                    description: formatAxiosError(e, "Error unarchiving client")
                });
            })
            .then(() => {
                startTransition(() => {
                    router.refresh();
                });
            });
    };

    const blockClient = (clientId: number) => {
        api.post(`/client/${clientId}/block`)
            .catch((e) => {
                console.error("Error blocking client", e);
                toast({
                    variant: "destructive",
                    title: "Error blocking client",
                    description: formatAxiosError(e, "Error blocking client")
                });
            })
            .then(() => {
                startTransition(() => {
                    router.refresh();
                });
            });
    };

    const unblockClient = (clientId: number) => {
        api.post(`/client/${clientId}/unblock`)
            .catch((e) => {
                console.error("Error unblocking client", e);
                toast({
                    variant: "destructive",
                    title: "Error unblocking client",
                    description: formatAxiosError(e, "Error unblocking client")
                });
            })
            .then(() => {
                startTransition(() => {
                    router.refresh();
                });
            });
    };

    // Check if there are any rows without userIds in the current view's data
    const hasRowsWithoutUserId = useMemo(() => {
        return machineClients.some((client) => !client.userId) ?? false;
    }, [machineClients]);

    const columns: ExtendedColumnDef<ClientRow>[] = useMemo(() => {
        const baseColumns: ExtendedColumnDef<ClientRow>[] = [
            {
                accessorKey: "name",
                enableHiding: false,
                friendlyName: t("name"),
                header: () => {
                    const nameOrder = getSortDirection("name", searchParams);
                    const Icon =
                        nameOrder === "asc"
                            ? ArrowDown01Icon
                            : nameOrder === "desc"
                              ? ArrowUp10Icon
                              : ChevronsUpDownIcon;

                    return (
                        <Button
                            variant="ghost"
                            onClick={() => toggleSort("name")}
                            className="px-3"
                        >
                            {t("name")}
                            <Icon className="ml-2 h-4 w-4" />
                        </Button>
                    );
                },
                cell: ({ row }) => {
                    const r = row.original;
                    return (
                        <div className="flex items-center gap-2">
                            <span>{r.name}</span>
                            {r.archived && (
                                <Badge variant="secondary">
                                    {t("archived")}
                                </Badge>
                            )}
                            {r.blocked && (
                                <Badge
                                    variant="destructive"
                                    className="flex items-center gap-1"
                                >
                                    <CircleSlash className="h-3 w-3" />
                                    {t("blocked")}
                                </Badge>
                            )}
                        </div>
                    );
                }
            },
            {
                accessorKey: "niceId",
                friendlyName: "Identifier",
                header: () => <span className="px-3">{t("identifier")}</span>
            },
            {
                accessorKey: "online",
                friendlyName: t("status"),
                header: () => {
                    return (
                        <ColumnFilterButton
                            options={[
                                {
                                    value: "true",
                                    label: t("connected")
                                },
                                {
                                    value: "false",
                                    label: t("disconnected")
                                }
                            ]}
                            selectedValue={
                                searchParams.get("online") ?? undefined
                            }
                            onValueChange={(value) =>
                                handleFilterChange("online", value)
                            }
                            searchPlaceholder={t("searchPlaceholder")}
                            emptyMessage={t("emptySearchOptions")}
                            label={t("status")}
                            className="p-3"
                        />
                    );
                },
                cell: ({ row }) => {
                    const originalRow = row.original;
                    if (originalRow.online) {
                        return (
                            <span className="flex items-center space-x-2">
                                <div className="w-2 h-2 bg-green-500 rounded-full"></div>
                                <span>{t("connected")}</span>
                            </span>
                        );
                    } else {
                        return (
                            <span className="flex items-center space-x-2">
                                <div className="w-2 h-2 bg-neutral-500 rounded-full"></div>
                                <span>{t("disconnected")}</span>
                            </span>
                        );
                    }
                }
            },
            {
                accessorKey: "mbIn",
                friendlyName: t("dataIn"),
                header: () => {
                    const dataInOrder = getSortDirection(
                        "megabytesIn",
                        searchParams
                    );

                    const Icon =
                        dataInOrder === "asc"
                            ? ArrowDown01Icon
                            : dataInOrder === "desc"
                              ? ArrowUp10Icon
                              : ChevronsUpDownIcon;
                    return (
                        <Button
                            variant="ghost"
                            onClick={() => toggleSort("megabytesIn")}
                        >
                            {t("dataIn")}
                            <Icon className="ml-2 h-4 w-4" />
                        </Button>
                    );
                }
            },
            {
                accessorKey: "mbOut",
                friendlyName: t("dataOut"),
                header: () => {
                    const dataOutOrder = getSortDirection(
                        "megabytesOut",
                        searchParams
                    );

                    const Icon =
                        dataOutOrder === "asc"
                            ? ArrowDown01Icon
                            : dataOutOrder === "desc"
                              ? ArrowUp10Icon
                              : ChevronsUpDownIcon;
                    return (
                        <Button
                            variant="ghost"
                            onClick={() => toggleSort("megabytesOut")}
                        >
                            {t("dataOut")}
                            <Icon className="ml-2 h-4 w-4" />
                        </Button>
                    );
                }
            },
            {
                accessorKey: "client",
                friendlyName: t("agent"),
                header: () => <span className="px-3">{t("agent")}</span>,
                cell: ({ row }) => {
                    const originalRow = row.original;

                    const agentVersionMap: Record<string, string> = {
                        "Pangolin Windows": "windows",
                        "Pangolin Android": "android",
                        "Pangolin iOS": "ios",
                        "Pangolin iPadOS": "ios",
                        "Pangolin macOS": "mac",
                        "Pangolin CLI": "cli",
                        "Olm CLI": "olm"
                    };

                    let updateAvailable = false;

                    if (
                        originalRow.olmVersion &&
                        originalRow.agent &&
                        latestPlatformVersions
                    ) {
                        const agent = agentVersionMap[
                            originalRow.agent
                        ] as keyof LatestVersionResponse;

                        if (agent in latestPlatformVersions) {
                            const agentVersion = latestPlatformVersions[agent];

                            updateAvailable = Boolean(
                                semver.valid(originalRow.olmVersion) &&
                                semver.lt(
                                    originalRow.olmVersion,
                                    agentVersion.latestVersion
                                )
                            );
                        }
                    }

                    return (
                        <div className="flex items-center space-x-1">
                            {originalRow.agent && originalRow.olmVersion ? (
                                <Badge variant="secondary">
                                    {originalRow.agent +
                                        " v" +
                                        originalRow.olmVersion}
                                </Badge>
                            ) : (
                                "-"
                            )}
                            {updateAvailable && (
                                <InfoPopup info={t("updateAvailableInfo")} />
                            )}
                        </div>
                    );
                }
            },
            {
                accessorKey: "subnet",
                friendlyName: t("address"),
                header: () => <span className="px-3">{t("address")}</span>
            },
            {
                id: "labels",
                accessorKey: "labels",
                header: () => (
                    <LabelColumnFilterButton
                        orgId={orgId}
                        selectedValues={searchParams.getAll("labels")}
                        onSelectedValuesChange={(value) =>
                            handleFilterChange("labels", value)
                        }
                        label={t("labels")}
                        className="p-3"
                    />
                ),
                cell: ({ row }: { row: { original: ClientRow } }) => (
                    <MachineClientLabelCell
                        client={row.original}
                        orgId={orgId}
                    />
                )
            }
        ];

        // Only include actions column if there are rows without userIds
        if (hasRowsWithoutUserId) {
            baseColumns.push({
                id: "actions",
                enableHiding: false,
                header: () => <span className="p-3"></span>,
                cell: ({ row }) => {
                    const clientRow = row.original;
                    return !clientRow.userId ? (
                        <div className="flex items-center gap-2 justify-end">
                            <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                    <Button
                                        variant="ghost"
                                        className="h-8 w-8 p-0"
                                    >
                                        <span className="sr-only">
                                            Open menu
                                        </span>
                                        <MoreHorizontal className="h-4 w-4" />
                                    </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end">
                                    <DropdownMenuItem
                                        onClick={() => {
                                            if (clientRow.archived) {
                                                unarchiveClient(clientRow.id);
                                            } else {
                                                archiveClient(clientRow.id);
                                            }
                                        }}
                                    >
                                        <span>
                                            {clientRow.archived
                                                ? "Unarchive"
                                                : "Archive"}
                                        </span>
                                    </DropdownMenuItem>
                                    <DropdownMenuItem
                                        onClick={() => {
                                            if (clientRow.blocked) {
                                                unblockClient(clientRow.id);
                                            } else {
                                                blockClient(clientRow.id);
                                            }
                                        }}
                                    >
                                        <span>
                                            {clientRow.blocked
                                                ? "Unblock"
                                                : "Block"}
                                        </span>
                                    </DropdownMenuItem>
                                    <DropdownMenuItem
                                        onClick={() => {
                                            setSelectedClient(clientRow);
                                            setIsDeleteModalOpen(true);
                                        }}
                                    >
                                        <span className="text-red-500">
                                            Delete
                                        </span>
                                    </DropdownMenuItem>
                                </DropdownMenuContent>
                            </DropdownMenu>
                            <Link
                                href={`/${clientRow.orgId}/settings/clients/machine/${clientRow.niceId}`}
                            >
                                <Button variant={"outline"}>
                                    {t("edit")}
                                    <ArrowRight className="ml-2 w-4 h-4" />
                                </Button>
                            </Link>
                        </div>
                    ) : null;
                }
            });
        }

        return baseColumns;
    }, [hasRowsWithoutUserId, orgId, t, searchParams]);

    function handleFilterChange(
        column: string,
        value: string | null | undefined | string[]
    ) {
        searchParams.delete(column);
        searchParams.delete("page");

        if (typeof value === "string") {
            searchParams.set(column, value);
        } else if (value) {
            for (const val of value) {
                searchParams.append(column, val);
            }
        }

        filter({
            searchParams
        });
    }

    function toggleSort(column: string) {
        const newSearch = getNextSortOrder(column, searchParams);

        filter({
            searchParams: newSearch
        });
    }

    const handlePaginationChange = (newPage: PaginationState) => {
        searchParams.set("page", (newPage.pageIndex + 1).toString());
        searchParams.set("pageSize", newPage.pageSize.toString());
        filter({
            searchParams
        });
    };

    const handleSearchChange = useDebouncedCallback((query: string) => {
        searchParams.set("query", query);
        searchParams.delete("page");
        filter({
            searchParams
        });
    }, 300);

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
                        <div className="space-y-2">
                            <p>{t("deleteClientQuestion")}</p>
                            <p>{t("clientMessageRemove")}</p>
                        </div>
                    }
                    buttonText="Confirm Delete Client"
                    onConfirm={async () => deleteClient(selectedClient!.id)}
                    string={selectedClient.name}
                    title="Delete Client"
                />
            )}
            <ControlledDataTable
                columns={columns}
                rows={machineClients}
                tableId="machine-clients"
                searchPlaceholder={t("machinesSearch")}
                searchQuery={searchParams.get("query")?.toString()}
                onAdd={() =>
                    startNavigation(() =>
                        router.push(`/${orgId}/settings/clients/machine/create`)
                    )
                }
                pagination={pagination}
                rowCount={rowCount}
                addButtonText={t("createClient")}
                onRefresh={refreshData}
                isRefreshing={isRefreshing || isFiltering}
                onSearch={handleSearchChange}
                onPaginationChange={handlePaginationChange}
                isNavigatingToAddPage={isNavigatingToAddPage}
                enableColumnVisibility
                columnVisibility={defaultMachineColumnVisibility}
                stickyLeftColumn="name"
                stickyRightColumn="actions"
            />
        </>
    );
}

type MachineClientLabelCellProps = {
    client: ClientRow;
    orgId: string;
};

function MachineClientLabelCell({
    client,
    orgId
}: MachineClientLabelCellProps) {
    const { localLabels, refresh, toggleLabel } = useOptimisticLabels({
        serverLabels: client.labels,
        orgId,
        entityId: client.id,
        entityIdField: "clientId"
    });

    return (
        <LabelsTableCell
            orgId={orgId}
            selectedLabels={localLabels}
            onToggleLabel={toggleLabel}
            onClosePopover={() => startTransition(refresh)}
        />
    );
}
