"use client";

import ConfirmDeleteDialog from "@app/components/ConfirmDeleteDialog";
import UptimeMiniBar from "@app/components/UptimeMiniBar";

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
import { toast } from "@app/hooks/useToast";
import { createApiClient, formatAxiosError } from "@app/lib/api";
import { getNextSortOrder, getSortDirection } from "@app/lib/sortColumn";
import { build } from "@server/build";
import { type PaginationState } from "@tanstack/react-table";
import {
    ArrowDown01Icon,
    ArrowRight,
    ArrowUp10Icon,
    ArrowUpRight,
    ChevronDown,
    ChevronsUpDownIcon,
    MoreHorizontal
} from "lucide-react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { startTransition, useMemo, useState, useTransition } from "react";
import { useDebouncedCallback } from "use-debounce";
import z from "zod";
import { ColumnFilterButton } from "./ColumnFilterButton";
import {
    ControlledDataTable,
    type ExtendedColumnDef
} from "./ui/controlled-data-table";

import { useOptimisticLabels } from "@app/hooks/useOptimisticLabels";
import { usePaidStatus } from "@app/hooks/usePaidStatus";
import { tierMatrix } from "@server/lib/billing/tierMatrix";
import { LabelColumnFilterButton } from "./LabelColumnFilterButton";
import { LabelsTableCell } from "./LabelsTableCell";

export type SiteRow = {
    id: number;
    nice: string;
    name: string;
    mbIn: string;
    mbOut: string;
    orgId: string;
    type: "newt" | "wireguard" | "local";
    newtVersion?: string;
    newtUpdateAvailable?: boolean;
    online?: boolean | null;
    address?: string;
    exitNodeName?: string;
    exitNodeEndpoint?: string;
    remoteExitNodeId?: string;
    resourceCount: number;
    dnsStatus?: string | null;
    labels?: Array<{
        labelId: number;
        name: string;
        color: string;
    }>;
};

type SitesTableProps = {
    sites: SiteRow[];
    pagination: PaginationState;
    orgId: string;
    rowCount: number;
};

export default function SitesTable({
    sites,
    orgId,
    pagination,
    rowCount
}: SitesTableProps) {
    const router = useRouter();
    const pathname = usePathname();
    const {
        navigate: filter,
        isNavigating: isFiltering,
        searchParams
    } = useNavigationContext();

    const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
    const [selectedSite, setSelectedSite] = useState<SiteRow | null>(null);
    const [resourcesDialogSite, setResourcesDialogSite] =
        useState<SiteRow | null>(null);
    const [isRefreshing, startTransition] = useTransition();
    const [isNavigatingToAddPage, startNavigation] = useTransition();

    const { isPaidUser } = usePaidStatus();
    const isLabelFeatureEnabled = isPaidUser(tierMatrix.labels);

    const api = createApiClient(useEnvContext());
    const t = useTranslations();

    // useEffect(() => {
    //     const interval = setInterval(() => {
    //         router.refresh();
    //     }, 30_000);
    //     return () => clearInterval(interval);
    // }, []);

    const booleanSearchFilterSchema = z
        .enum(["true", "false"])
        .optional()
        .catch(undefined);

    function handleFilterChange(
        column: string,
        value: string | undefined | null | string[]
    ) {
        const sp = new URLSearchParams(searchParams);
        sp.delete(column);
        sp.delete("page");

        if (typeof value === "string") {
            sp.set(column, value);
        } else if (value) {
            value.forEach((val) => sp.append(column, val));
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

    function deleteSite(siteId: number) {
        startTransition(async () => {
            await api
                .delete(`/site/${siteId}`)
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
                });
        });
    }

    const columns = useMemo<ExtendedColumnDef<SiteRow>[]>(() => {
        const cols: ExtendedColumnDef<SiteRow>[] = [
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
                friendlyName: t("status"),
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
                            label={t("status")}
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
            {
                id: "uptime",
                friendlyName: "Uptime",
                header: () => <span className="p-3">{t("uptime30d")}</span>,
                cell: ({ row }) => {
                    const originalRow = row.original;
                    if (originalRow.type == "local") {
                        return <span>-</span>;
                    }
                    return <UptimeMiniBar siteId={originalRow.id} days={30} />;
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
                                            <span>
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
                id: "dnsStatus",
                accessorKey: "dnsStatus",
                friendlyName: t("dnsAuthorityShort"),
                header: () => <span className="p-3">{t("dnsAuthorityShort")}</span>,
                cell: ({ row }) => {
                    const status = row.original.dnsStatus;
                    if (!status || status === "disabled") {
                        return <span className="text-neutral-500">{t("siteDnsAuthorityStatusDisabled")}</span>;
                    }
                    if (status === "running") {
                        return <span className="text-green-500">{t("siteDnsAuthorityStatusRunning")}</span>;
                    }
                    if (status === "warning") {
                        return <span className="text-yellow-500">{t("siteDnsAuthorityStatusWarning")}</span>;
                    }
                    if (status === "error") {
                        return <span className="text-red-500">{t("siteDnsAuthorityStatusError")}</span>;
                    }
                    return <span>-</span>;
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

                    // Self-hosted node
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

                    // Fallback if no remoteExitNodeId
                    return <span>{originalRow.exitNodeName}</span>;
                }
            },
            {
                accessorKey: "address",
                header: () => {
                    return <span className="p-3">{t("address")}</span>;
                },
                cell: ({ row }) => {
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
                    return (
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
                                    <Link
                                        className="block w-full"
                                        href={`/${siteRow.orgId}/settings/sites/${siteRow.nice}`}
                                    >
                                        <DropdownMenuItem>
                                            {t("viewSettings")}
                                        </DropdownMenuItem>
                                    </Link>
                                    <Link
                                        className="block w-full"
                                        href={`/${siteRow.orgId}/settings/resources/public?siteId=${siteRow.id}`}
                                    >
                                        <DropdownMenuItem>
                                            {t("sitesTableViewPublicResources")}
                                        </DropdownMenuItem>
                                    </Link>
                                    <Link
                                        className="block w-full"
                                        href={`/${siteRow.orgId}/settings/resources/private?siteId=${siteRow.id}`}
                                    >
                                        <DropdownMenuItem>
                                            {t(
                                                "sitesTableViewPrivateResources"
                                            )}
                                        </DropdownMenuItem>
                                    </Link>
                                </DropdownMenuContent>
                            </DropdownMenu>
                            <Link
                                href={`/${siteRow.orgId}/settings/sites/${siteRow.nice}`}
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

        if (isLabelFeatureEnabled) {
            cols.splice(cols.length - 1, 0, {
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
                cell: ({ row }: { row: { original: SiteRow } }) => (
                    <SiteLabelCell site={row.original} orgId={orgId} />
                )
            });
        }

        return cols;
    }, [isLabelFeatureEnabled, orgId, t, searchParams]);

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
                    open={isDeleteModalOpen}
                    setOpen={(val) => {
                        setIsDeleteModalOpen(val);
                        setSelectedSite(null);
                    }}
                    dialog={
                        <div className="space-y-2">
                            <p>{t("siteQuestionRemove")}</p>
                            <p>{t("siteMessageRemove")}</p>
                        </div>
                    }
                    buttonText={t("siteConfirmDelete")}
                    onConfirm={async () =>
                        startTransition(() => deleteSite(selectedSite!.id))
                    }
                    string={selectedSite.name}
                    title={t("siteDelete")}
                />
            )}

            <ControlledDataTable
                columns={columns}
                rows={sites}
                tableId="sites-table"
                searchPlaceholder={t("searchSitesProgress")}
                pagination={pagination}
                onPaginationChange={handlePaginationChange}
                onAdd={() =>
                    startNavigation(() =>
                        router.push(`/${orgId}/settings/sites/create`)
                    )
                }
                isNavigatingToAddPage={isNavigatingToAddPage}
                searchQuery={searchParams.get("query")?.toString()}
                onSearch={handleSearchChange}
                addButtonText={t("siteAdd")}
                onRefresh={refreshData}
                isRefreshing={isRefreshing || isFiltering}
                rowCount={rowCount}
                columnVisibility={{
                    niceId: false,
                    nice: false,
                    exitNode: false,
                    address: false,
                    labels: true
                }}
                enableColumnVisibility
                stickyLeftColumn="name"
                stickyRightColumn="actions"
            />
        </>
    );
}

type SiteLabelCellProps = {
    site: SiteRow;
    orgId: string;
};

function SiteLabelCell({ site, orgId }: SiteLabelCellProps) {
    const { localLabels, refresh, toggleLabel } = useOptimisticLabels({
        serverLabels: site.labels,
        orgId,
        entityId: site.id,
        entityIdField: "siteId"
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
