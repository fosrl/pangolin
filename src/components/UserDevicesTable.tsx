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
import { InfoPopup } from "@app/components/ui/info-popup";
import { useEnvContext } from "@app/hooks/useEnvContext";
import { useNavigationContext } from "@app/hooks/useNavigationContext";
import { getNextSortOrder, getSortDirection } from "@app/lib/sortColumn";
import { toast } from "@app/hooks/useToast";
import { createApiClient, formatAxiosError } from "@app/lib/api";
import { formatFingerprintInfo } from "@app/lib/formatDeviceFingerprint";
import { getUserDisplayName } from "@app/lib/getUserDisplayName";
import { build } from "@server/build";
import type { PaginationState } from "@tanstack/react-table";
import {
    ArrowDown01Icon,
    ArrowRight,
    ArrowUp10Icon,
    ArrowUpRight,
    ChevronsUpDownIcon,
    CircleSlash,
    MoreHorizontal
} from "lucide-react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { useDebouncedCallback } from "use-debounce";
import ClientDownloadBanner from "./ClientDownloadBanner";
import { ColumnFilterButton } from "./ColumnFilterButton";
import IdpTypeBadge from "./IdpTypeBadge";
import { Badge } from "./ui/badge";
import { ControlledDataTable } from "./ui/controlled-data-table";
import {
    productUpdatesQueries,
    type LatestVersionResponse
} from "@app/lib/queries";
import { useQuery } from "@tanstack/react-query";
import semver from "semver";

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
    userType: string | null;
    idpName: string | null;
    idpVariant: string | null;
    niceId: string;
    agent: string | null;
    approvalState: "approved" | "pending" | "denied" | null;
    archived?: boolean;
    blocked?: boolean;
    fingerprint?: {
        platform: string | null;
        osVersion: string | null;
        kernelVersion: string | null;
        arch: string | null;
        deviceModel: string | null;
        serialNumber: string | null;
        username: string | null;
        hostname: string | null;
    } | null;
};

type ClientTableProps = {
    userClients: ClientRow[];
    orgId: string;
    pagination: PaginationState;
    rowCount: number;
};

export default function UserDevicesTable({
    userClients,
    pagination,
    rowCount
}: ClientTableProps) {
    const router = useRouter();
    const t = useTranslations();

    const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
    const [selectedClient, setSelectedClient] = useState<ClientRow | null>(
        null
    );

    const api = createApiClient(useEnvContext());
    const {
        navigate: filter,
        isNavigating: isFiltering,
        searchParams
    } = useNavigationContext();
    const [isRefreshing, startTransition] = useTransition();
    const data = useQuery(productUpdatesQueries.latestVersion(true));

    const latestPlatformVersions = data.data?.data;

    const defaultUserColumnVisibility = {
        subnet: false,
        niceId: false
    };

    const refreshData = () => {
        startTransition(() => {
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

    const approveDevice = async (clientRow: ClientRow) => {
        try {
            // Fetch approvalId for this client using clientId query parameter
            const approvalsRes = await api.get<{
                data: {
                    approvals: Array<{ approvalId: number; clientId: number }>;
                };
            }>(
                `/org/${clientRow.orgId}/approvals?approvalState=pending&clientId=${clientRow.id}`
            );

            const approval = approvalsRes.data.data.approvals[0];

            if (!approval) {
                toast({
                    variant: "destructive",
                    title: t("error"),
                    description: t("accessApprovalErrorUpdateDescription")
                });
                return;
            }

            await api.put(
                `/org/${clientRow.orgId}/approvals/${approval.approvalId}`,
                {
                    decision: "approved"
                }
            );

            toast({
                title: t("accessApprovalUpdated"),
                description: t("accessApprovalApprovedDescription")
            });

            startTransition(() => {
                router.refresh();
            });
        } catch (e) {
            toast({
                variant: "destructive",
                title: t("accessApprovalErrorUpdate"),
                description: formatAxiosError(
                    e,
                    t("accessApprovalErrorUpdateDescription")
                )
            });
        }
    };

    const denyDevice = async (clientRow: ClientRow) => {
        try {
            // Fetch approvalId for this client using clientId query parameter
            const approvalsRes = await api.get<{
                data: {
                    approvals: Array<{ approvalId: number; clientId: number }>;
                };
            }>(
                `/org/${clientRow.orgId}/approvals?approvalState=pending&clientId=${clientRow.id}`
            );

            const approval = approvalsRes.data.data.approvals[0];

            if (!approval) {
                toast({
                    variant: "destructive",
                    title: t("error"),
                    description: t("accessApprovalErrorUpdateDescription")
                });
                return;
            }

            await api.put(
                `/org/${clientRow.orgId}/approvals/${approval.approvalId}`,
                {
                    decision: "denied"
                }
            );

            toast({
                title: t("accessApprovalUpdated"),
                description: t("accessApprovalDeniedDescription")
            });

            startTransition(() => {
                router.refresh();
            });
        } catch (e) {
            toast({
                variant: "destructive",
                title: t("accessApprovalErrorUpdate"),
                description: formatAxiosError(
                    e,
                    t("accessApprovalErrorUpdateDescription")
                )
            });
        }
    };

    // Check if there are any rows without userIds in the current view's data
    const hasRowsWithoutUserId = useMemo(() => {
        return userClients.some((client) => !client.userId);
    }, [userClients]);

    const columns: ExtendedColumnDef<ClientRow>[] = useMemo(() => {
        const baseColumns: ExtendedColumnDef<ClientRow>[] = [
            {
                accessorKey: "name",
                enableHiding: false,
                friendlyName: t("name"),
                header: () => <span className="px-3">{t("name")}</span>,
                cell: ({ row }) => {
                    const r = row.original;
                    const fingerprintInfo = r.fingerprint
                        ? formatFingerprintInfo(r.fingerprint, t)
                        : null;
                    return (
                        <div className="flex items-center gap-2">
                            <span>{r.name}</span>
                            {fingerprintInfo && (
                                <InfoPopup>
                                    <div className="space-y-1 text-sm">
                                        <div className="font-semibold mb-2">
                                            {t("deviceInformation")}
                                        </div>
                                        <div className="text-muted-foreground whitespace-pre-line">
                                            {fingerprintInfo}
                                        </div>
                                    </div>
                                </InfoPopup>
                            )}
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
                            {r.approvalState === "pending" && (
                                <Badge
                                    variant="outlinePrimary"
                                    className="flex items-center gap-1"
                                >
                                    {t("pendingApproval")}
                                </Badge>
                            )}
                        </div>
                    );
                }
            },
            {
                accessorKey: "niceId",
                friendlyName: t("identifier"),
                header: () => <span className="px-3">{t("identifier")}</span>
            },
            {
                accessorKey: "userEmail",
                friendlyName: t("users"),
                header: () => <span className="px-3">{t("users")}</span>,
                cell: ({ row }) => {
                    const r = row.original;
                    return r.userId ? (
                        <div className="flex items-center gap-2">
                            <Link
                                href={`/${r.orgId}/settings/access/users/${r.userId}`}
                            >
                                <Button variant="outline" size="sm">
                                    {getUserDisplayName({
                                        email: r.userEmail,
                                        username: r.username
                                    }) || r.userId}
                                    <ArrowUpRight className="ml-2 h-3 w-3" />
                                </Button>
                            </Link>
                            {(r.userType ?? "internal") !== "internal" && (
                                <IdpTypeBadge
                                    type={r.userType ?? "oidc"}
                                    name={
                                        r.idpName?.trim()
                                            ? r.idpName
                                            : t("idpNameInternal")
                                    }
                                    variant={r.idpVariant ?? undefined}
                                />
                            )}
                        </div>
                    ) : (
                        "-"
                    );
                }
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
                header: () => (
                    <ColumnFilterButton
                        options={[
                            {
                                value: "macos",
                                label: "Pangolin macOS"
                            },
                            {
                                value: "ios",
                                label: "Pangolin iOS"
                            },
                            {
                                value: "ipados",
                                label: "Pangolin iPadOS"
                            },
                            {
                                value: "android",
                                label: "Pangolin Android"
                            },
                            {
                                value: "windows",
                                label: "Pangolin Windows"
                            },
                            {
                                value: "cli",
                                label: "Pangolin CLI"
                            },
                            {
                                value: "olm",
                                label: "Olm CLI"
                            },
                            {
                                value: "unknown",
                                label: t("unknown")
                            }
                        ]}
                        selectedValue={searchParams.get("agent") ?? undefined}
                        onValueChange={(value) =>
                            handleFilterChange("agent", value)
                        }
                        searchPlaceholder={t("searchPlaceholder")}
                        emptyMessage={t("emptySearchOptions")}
                        label={t("agent")}
                        className="p-3"
                    />
                ),
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

                            updateAvailable = semver.lt(
                                originalRow.olmVersion,
                                agentVersion.latestVersion
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
            }
        ];

        baseColumns.push({
            id: "actions",
            enableHiding: false,
            header: () => <span className="p-3"></span>,
            cell: ({ row }) => {
                const clientRow = row.original;
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
                                {clientRow.approvalState === "pending" &&
                                    build !== "oss" && (
                                        <>
                                            <DropdownMenuItem
                                                onClick={() =>
                                                    approveDevice(clientRow)
                                                }
                                            >
                                                <span>{t("approve")}</span>
                                            </DropdownMenuItem>
                                            <DropdownMenuItem
                                                onClick={() =>
                                                    denyDevice(clientRow)
                                                }
                                            >
                                                <span>{t("deny")}</span>
                                            </DropdownMenuItem>
                                        </>
                                    )}
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
                                            ? t("actionUnarchiveClient")
                                            : t("actionArchiveClient")}
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
                                            ? t("actionUnblockClient")
                                            : t("actionBlockClient")}
                                    </span>
                                </DropdownMenuItem>
                                {!clientRow.userId && (
                                    // Machine client - also show delete option
                                    <DropdownMenuItem
                                        onClick={() => {
                                            setSelectedClient(clientRow);
                                            setIsDeleteModalOpen(true);
                                        }}
                                    >
                                        <span className="text-red-500">
                                            {t("delete")}
                                        </span>
                                    </DropdownMenuItem>
                                )}
                            </DropdownMenuContent>
                        </DropdownMenu>
                        <Link
                            href={`/${clientRow.orgId}/settings/clients/user/${clientRow.niceId}`}
                        >
                            <Button variant={"outline"}>
                                {t("viewDetails")}
                                <ArrowRight className="ml-2 w-4 h-4" />
                            </Button>
                        </Link>
                    </div>
                );
            }
        });

        return baseColumns;
    }, [hasRowsWithoutUserId, t, getSortDirection, toggleSort]);

    const statusFilterOptions = useMemo(() => {
        const allOptions = [
            {
                id: "active",
                label: t("active"),
                value: "active"
            },
            {
                id: "pending",
                label: t("pendingApproval"),
                value: "pending"
            },
            {
                id: "denied",
                label: t("deniedApproval"),
                value: "denied"
            },
            {
                id: "archived",
                label: t("archived"),
                value: "archived"
            },
            {
                id: "blocked",
                label: t("blocked"),
                value: "blocked"
            }
        ];

        if (build === "oss") {
            return allOptions.filter(
                (option) =>
                    option.value !== "pending" && option.value !== "denied"
            );
        }

        return allOptions;
    }, [t, latestPlatformVersions]);

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
            {selectedClient && !selectedClient.userId && (
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
                    buttonText={t("actionDeleteClient")}
                    onConfirm={async () => deleteClient(selectedClient!.id)}
                    string={selectedClient.name}
                    title={t("actionDeleteClient")}
                />
            )}
            <ClientDownloadBanner />

            <ControlledDataTable
                columns={columns}
                rows={userClients || []}
                tableId="user-clients"
                searchPlaceholder={t("userDevicesSearch")}
                onRefresh={refreshData}
                isRefreshing={isRefreshing || isFiltering}
                enableColumnVisibility
                columnVisibility={defaultUserColumnVisibility}
                onSearch={handleSearchChange}
                onPaginationChange={handlePaginationChange}
                searchQuery={searchParams.get("query")?.toString()}
                pagination={pagination}
                rowCount={rowCount}
                stickyLeftColumn="name"
                stickyRightColumn="actions"
                filters={[
                    {
                        id: "status",
                        label: t("status") || "Status",
                        multiSelect: true,
                        displayMode: "calculated",
                        options: statusFilterOptions,
                        onValueChange: (selectedValues: string[]) => {
                            handleFilterChange("status", selectedValues);
                        },
                        values: searchParams.getAll("status")
                    }
                ]}
            />
        </>
    );
}
