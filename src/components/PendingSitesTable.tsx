"use client";

import ConfirmDeleteDialog from "@app/components/ConfirmDeleteDialog";
import {
    Credenza,
    CredenzaBody,
    CredenzaContent,
    CredenzaDescription,
    CredenzaFooter,
    CredenzaHeader,
    CredenzaTitle
} from "@app/components/Credenza";
import SiteResourcesOverview from "@app/components/SiteResourcesOverview";
import { Badge } from "@app/components/ui/badge";
import { Button } from "@app/components/ui/button";
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
import { build } from "@server/build";
import { TierFeature, tierMatrix } from "@server/lib/billing/tierMatrix";
import { usePaidStatus } from "@app/hooks/usePaidStatus";
import { type PaginationState } from "@tanstack/react-table";
import {
    ArrowDown01Icon,
    ArrowUp10Icon,
    ArrowUpRight,
    Check,
    ChevronDown,
    ChevronsUpDownIcon,
    MoreHorizontal,
    X
} from "lucide-react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { useDebouncedCallback } from "use-debounce";
import z from "zod";
import { ColumnFilterButton } from "./ColumnFilterButton";
import {
    ControlledDataTable,
    type ExtendedColumnDef
} from "./ui/controlled-data-table";
import { SiteRow } from "./SitesTable";

type PendingSitesTableProps = {
    sites: SiteRow[];
    pagination: PaginationState;
    orgId: string;
    rowCount: number;
};

export default function PendingSitesTable({
    sites,
    orgId,
    pagination,
    rowCount
}: PendingSitesTableProps) {
    const router = useRouter();
    const pathname = usePathname();
    const {
        navigate: filter,
        isNavigating: isFiltering,
        searchParams
    } = useNavigationContext();

    const [isRefreshing, startTransition] = useTransition();
    const [approvingIds, setApprovingIds] = useState<Set<number>>(new Set());
    const [rejectingIds, setRejectingIds] = useState<Set<number>>(new Set());
    const [isRejectModalOpen, setIsRejectModalOpen] = useState(false);
    const [selectedSite, setSelectedSite] = useState<SiteRow | null>(null);
    const [resourcesDialogSite, setResourcesDialogSite] =
        useState<SiteRow | null>(null);

    const api = createApiClient(useEnvContext());
    const t = useTranslations();
    const { isPaidUser } = usePaidStatus();
    const canUseSiteProvisioning =
        isPaidUser(tierMatrix[TierFeature.SiteProvisioningKeys]) &&
        build !== "oss";

    const booleanSearchFilterSchema = z
        .enum(["true", "false"])
        .optional()
        .catch(undefined);

    function handleFilterChange(
        column: string,
        value: string | undefined | null
    ) {
        const sp = new URLSearchParams(searchParams);
        sp.delete(column);
        sp.delete("page");

        if (value) {
            sp.set(column, value);
        }
        startTransition(() => router.push(`${pathname}?${sp.toString()}`));
    }

    function refreshData() {
        startTransition(async () => {
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
    }

    async function approveSite(siteId: number) {
        setApprovingIds((prev) => new Set(prev).add(siteId));
        try {
            await api.post(`/site/${siteId}/approve`);
            toast({
                title: t("success"),
                description: t("siteApproveSuccess"),
                variant: "default"
            });
            router.refresh();
        } catch (e) {
            toast({
                variant: "destructive",
                title: t("siteApproveError"),
                description: formatAxiosError(e, t("siteApproveError"))
            });
        } finally {
            setApprovingIds((prev) => {
                const next = new Set(prev);
                next.delete(siteId);
                return next;
            });
        }
    }

    async function rejectSite(siteId: number) {
        setRejectingIds((prev) => new Set(prev).add(siteId));
        try {
            await api.post(`/site/${siteId}/reject`);
            toast({
                title: t("success"),
                description: t("siteRejectSuccess"),
                variant: "default"
            });
            setIsRejectModalOpen(false);
            setSelectedSite(null);
            router.refresh();
        } catch (e) {
            toast({
                variant: "destructive",
                title: t("siteRejectError"),
                description: formatAxiosError(e, t("siteRejectError"))
            });
        } finally {
            setRejectingIds((prev) => {
                const next = new Set(prev);
                next.delete(siteId);
                return next;
            });
        }
    }

    const columns: ExtendedColumnDef<SiteRow>[] = [
        {
            accessorKey: "name",
            enableHiding: false,
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
                        className="p-3"
                        onClick={() => toggleSort("name")}
                    >
                        {t("name")}
                        <Icon className="ml-2 h-4 w-4" />
                    </Button>
                );
            }
        },
        {
            id: "niceId",
            accessorKey: "nice",
            friendlyName: t("identifier"),
            enableHiding: true,
            header: () => {
                return <span className="p-3">{t("identifier")}</span>;
            },
            cell: ({ row }) => {
                return <span>{row.original.nice || "-"}</span>;
            }
        },
        {
            accessorKey: "online",
            friendlyName: t("online"),
            header: () => {
                return (
                    <ColumnFilterButton
                        options={[
                            { value: "true", label: t("online") },
                            { value: "false", label: t("offline") }
                        ]}
                        selectedValue={booleanSearchFilterSchema.parse(
                            searchParams.get("online")
                        )}
                        onValueChange={(value) =>
                            handleFilterChange("online", value)
                        }
                        searchPlaceholder={t("searchPlaceholder")}
                        emptyMessage={t("emptySearchOptions")}
                        label={t("online")}
                        className="p-3"
                    />
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
                            <span className="flex items-center space-x-2">
                                <div className="w-2 h-2 bg-green-500 rounded-full"></div>
                                <span>{t("online")}</span>
                            </span>
                        );
                    } else {
                        return (
                            <span className="flex items-center space-x-2">
                                <div className="w-2 h-2 bg-neutral-500 rounded-full"></div>
                                <span>{t("offline")}</span>
                            </span>
                        );
                    }
                } else {
                    return <span>-</span>;
                }
            }
        },
        // {
        //     accessorKey: "mbIn",
        //     friendlyName: t("dataIn"),
        //     header: () => {
        //         const dataInOrder = getSortDirection(
        //             "megabytesIn",
        //             searchParams
        //         );
        //         const Icon =
        //             dataInOrder === "asc"
        //                 ? ArrowDown01Icon
        //                 : dataInOrder === "desc"
        //                   ? ArrowUp10Icon
        //                   : ChevronsUpDownIcon;
        //         return (
        //             <Button
        //                 variant="ghost"
        //                 onClick={() => toggleSort("megabytesIn")}
        //             >
        //                 {t("dataIn")}
        //                 <Icon className="ml-2 h-4 w-4" />
        //             </Button>
        //         );
        //     }
        // },
        // {
        //     accessorKey: "mbOut",
        //     friendlyName: t("dataOut"),
        //     header: () => {
        //         const dataOutOrder = getSortDirection(
        //             "megabytesOut",
        //             searchParams
        //         );
        //         const Icon =
        //             dataOutOrder === "asc"
        //                 ? ArrowDown01Icon
        //                 : dataOutOrder === "desc"
        //                   ? ArrowUp10Icon
        //                   : ChevronsUpDownIcon;
        //         return (
        //             <Button
        //                 variant="ghost"
        //                 onClick={() => toggleSort("megabytesOut")}
        //             >
        //                 {t("dataOut")}
        //                 <Icon className="ml-2 h-4 w-4" />
        //             </Button>
        //         );
        //     }
        // },
        {
            accessorKey: "type",
            friendlyName: t("type"),
            header: () => {
                return <span className="p-3">{t("type")}</span>;
            },
            cell: ({ row }) => {
                const originalRow = row.original;

                if (originalRow.type === "newt") {
                    return (
                        <div className="flex items-center space-x-1">
                            <Badge variant="secondary">
                                <div className="flex items-center space-x-1">
                                    <span>Newt</span>
                                    {originalRow.newtVersion && (
                                        <span>v{originalRow.newtVersion}</span>
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
                            <Badge variant="secondary">WireGuard</Badge>
                        </div>
                    );
                }

                if (originalRow.type === "local") {
                    return (
                        <div className="flex items-center space-x-2">
                            <Badge variant="secondary">Local</Badge>
                        </div>
                    );
                }
            }
        },
        {
            id: "resources",
            accessorKey: "resourceCount",
            friendlyName: t("resources"),
            header: () => <span className="p-3">{t("resources")}</span>,
            cell: ({ row }) => {
                const siteRow = row.original;
                return (
                    <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => setResourcesDialogSite(siteRow)}
                        className="flex h-8 items-center gap-2 px-0 font-normal"
                    >
                        <span className="text-sm tabular-nums">
                            {siteRow.resourceCount} {t("resources")}
                        </span>
                        <ChevronDown className="h-3 w-3 shrink-0" />
                    </Button>
                );
            }
        },
        {
            accessorKey: "exitNode",
            friendlyName: t("exitNode"),
            header: () => {
                return <span className="p-3">{t("exitNode")}</span>;
            },
            cell: ({ row }) => {
                const originalRow = row.original;
                if (!originalRow.exitNodeName) {
                    return "-";
                }

                const isCloudNode =
                    build == "saas" &&
                    originalRow.exitNodeName &&
                    [
                        "mercury",
                        "venus",
                        "earth",
                        "mars",
                        "jupiter",
                        "saturn",
                        "uranus",
                        "neptune",
                        "pluto"
                    ].includes(originalRow.exitNodeName.toLowerCase());

                if (isCloudNode) {
                    const capitalizedName =
                        originalRow.exitNodeName.charAt(0).toUpperCase() +
                        originalRow.exitNodeName.slice(1).toLowerCase();
                    return (
                        <Badge variant="secondary">
                            Pangolin {capitalizedName}
                        </Badge>
                    );
                }

                if (originalRow.remoteExitNodeId) {
                    return (
                        <Link
                            href={`/${originalRow.orgId}/settings/remote-exit-nodes/${originalRow.remoteExitNodeId}`}
                        >
                            <Button variant="outline" size="sm">
                                {originalRow.exitNodeName}
                                <ArrowUpRight className="ml-2 h-3 w-3" />
                            </Button>
                        </Link>
                    );
                }

                return <span>{originalRow.exitNodeName}</span>;
            }
        },
        {
            accessorKey: "address",
            header: () => {
                return <span className="p-3">{t("address")}</span>;
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
        },
        {
            id: "actions",
            enableHiding: false,
            header: () => <span className="p-3"></span>,
            cell: ({ row }) => {
                const siteRow = row.original;
                const isApproving = approvingIds.has(siteRow.id);
                const isRejecting = rejectingIds.has(siteRow.id);
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
                                    href={`/${siteRow.orgId}/settings/sites/${siteRow.nice}`}
                                >
                                    <DropdownMenuItem>
                                        {t("viewSettings")}
                                    </DropdownMenuItem>
                                </Link>
                            </DropdownMenuContent>
                        </DropdownMenu>
                        <Button
                            variant="outline"
                            disabled={isApproving || isRejecting}
                            onClick={() => {
                                setSelectedSite(siteRow);
                                setIsRejectModalOpen(true);
                            }}
                        >
                            <X className="mr-2 w-4 h-4" />
                            {t("reject")}
                        </Button>
                        <Button
                            variant="outline"
                            disabled={isApproving || isRejecting}
                            onClick={() => approveSite(siteRow.id)}
                        >
                            <Check className="mr-2 w-4 h-4" />
                            {t("approve")}
                        </Button>
                    </div>
                );
            }
        }
    ];

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
            <Credenza
                open={Boolean(resourcesDialogSite)}
                onOpenChange={(open) => {
                    if (!open) setResourcesDialogSite(null);
                }}
            >
                <CredenzaContent className="md:max-w-7xl">
                    <CredenzaHeader>
                        <CredenzaTitle>{t("siteResourcesTab")}</CredenzaTitle>
                        <CredenzaDescription>
                            {t("siteResourcesDialogDescription")}
                        </CredenzaDescription>
                    </CredenzaHeader>
                    <CredenzaBody>
                        {resourcesDialogSite != null && (
                            <SiteResourcesOverview
                                orgIdOverride={orgId}
                                siteId={resourcesDialogSite.id}
                                initialPublicData={null}
                                initialPrivateData={null}
                                initialPublicForbidden={false}
                                initialPrivateForbidden={false}
                                showViewAllLinks={false}
                            />
                        )}
                    </CredenzaBody>
                    <CredenzaFooter>
                        <Button
                            type="button"
                            variant="outline"
                            onClick={() => setResourcesDialogSite(null)}
                        >
                            {t("close")}
                        </Button>
                    </CredenzaFooter>
                </CredenzaContent>
            </Credenza>

            {selectedSite && (
                <ConfirmDeleteDialog
                    open={isRejectModalOpen}
                    setOpen={(val) => {
                        setIsRejectModalOpen(val);
                        if (!val) {
                            setSelectedSite(null);
                        }
                    }}
                    dialog={
                        <div className="space-y-2">
                            <p>{t("siteQuestionReject")}</p>
                            <p>{t("siteMessageReject")}</p>
                        </div>
                    }
                    buttonText={t("siteConfirmReject")}
                    onConfirm={async () => rejectSite(selectedSite.id)}
                    string={selectedSite.name}
                    title={t("siteReject")}
                />
            )}
            <ControlledDataTable
                columns={columns}
                rows={sites}
                tableId="pending-sites-table"
                searchPlaceholder={t("searchSitesProgress")}
                pagination={pagination}
                onPaginationChange={handlePaginationChange}
                searchQuery={searchParams.get("query")?.toString()}
                onSearch={handleSearchChange}
                onRefresh={refreshData}
                isRefreshing={isRefreshing || isFiltering}
                refreshButtonDisabled={!canUseSiteProvisioning}
                rowCount={rowCount}
                columnVisibility={{
                    niceId: false,
                    nice: false,
                    exitNode: false,
                    address: false
                }}
                enableColumnVisibility
                stickyLeftColumn="name"
                stickyRightColumn="actions"
            />
        </>
    );
}
