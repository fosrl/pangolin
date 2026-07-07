"use client";

import UptimeMiniBar from "@app/components/UptimeMiniBar";

import ConfirmDeleteDialog from "@app/components/ConfirmDeleteDialog";
import HealthCheckCredenza, {
    HealthCheckRow
} from "@app/components/HealthCheckCredenza";
import { ColumnFilterButton } from "@app/components/ColumnFilterButton";
import { Badge } from "@app/components/ui/badge";
import { Button } from "@app/components/ui/button";
import {
    ControlledDataTable,
    type ExtendedColumnDef
} from "@app/components/ui/controlled-data-table";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger
} from "@app/components/ui/dropdown-menu";
import {
    Popover,
    PopoverContent,
    PopoverTrigger
} from "@app/components/ui/popover";
import { Switch } from "@app/components/ui/switch";
import { toast } from "@app/hooks/useToast";
import { useEnvContext } from "@app/hooks/useEnvContext";
import { createApiClient, formatAxiosError } from "@app/lib/api";
import { Selectedsite, SitesSelector } from "@app/components/site-selector";
import {
    ResourceSelector,
    SelectedResource
} from "@app/components/resource-selector";
import {
    ArrowUpDown,
    ArrowUpRight,
    Funnel,
    MoreHorizontal
} from "lucide-react";
import { useTranslations } from "next-intl";
import { useState, useTransition, useEffect, useMemo } from "react";
import type { PaginationState } from "@tanstack/react-table";
import { useNavigationContext } from "@app/hooks/useNavigationContext";
import { useDebouncedCallback } from "use-debounce";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { PaidFeaturesAlert } from "@app/components/PaidFeaturesAlert";
import { usePaidStatus } from "@app/hooks/usePaidStatus";
import { tierMatrix } from "@server/lib/billing/tierMatrix";
import { cn } from "@app/lib/cn";
import { dataTableFilterPopoverContentClassName } from "@app/lib/dataTableFilterPopover";

type StandaloneHealthChecksTableProps = {
    orgId: string;
    healthChecks: HealthCheckRow[];
    rowCount: number;
    pagination: PaginationState;
    initialFilterSite?: Selectedsite | null;
    initialFilterResource?: SelectedResource | null;
};

function formatTarget(row: HealthCheckRow): string {
    if (!row.hcHostname) return "-";
    if (row.hcMode === "tcp") {
        if (!row.hcPort) return row.hcHostname;
        return `${row.hcHostname}:${row.hcPort}`;
    }
    if (row.hcMode === "snmp" || row.hcMode === "ping") {
        if (row.hcPort) {
            return `${row.hcHostname}:${row.hcPort}`;
        }
        return row.hcHostname;
    }
    // HTTP / default
    const scheme = row.hcScheme ?? "http";
    const host = row.hcHostname;
    const port = row.hcPort ? `:${row.hcPort}` : "";
    const path = row.hcPath ?? "/";
    return `${scheme}://${host}${port}${path}`;
}

export default function HealthChecksTable({
    orgId,
    healthChecks,
    rowCount,
    pagination,
    initialFilterSite = null,
    initialFilterResource = null
}: StandaloneHealthChecksTableProps) {
    const router = useRouter();
    const t = useTranslations();
    const api = createApiClient(useEnvContext());
    const [isRefreshing, startRefresh] = useTransition();
    const { isPaidUser } = usePaidStatus();
    const isPaid = isPaidUser(tierMatrix.standaloneHealthChecks);

    const [credenzaOpen, setCredenzaOpen] = useState(false);
    const {
        navigate: filter,
        isNavigating: isFiltering,
        searchParams
    } = useNavigationContext();

    const [deleteOpen, setDeleteOpen] = useState(false);
    const [selected, setSelected] = useState<HealthCheckRow | null>(null);
    const [togglingId, setTogglingId] = useState<number | null>(null);
    const [siteFilterOpen, setSiteFilterOpen] = useState(false);
    const [resourceFilterOpen, setResourceFilterOpen] = useState(false);

    const query = searchParams.get("query") ?? undefined;

    const siteIdQ = searchParams.get("siteId");
    const siteIdNum = siteIdQ ? parseInt(siteIdQ, 10) : NaN;
    const selectedSite: Selectedsite | null = useMemo(() => {
        if (!siteIdQ || !Number.isInteger(siteIdNum) || siteIdNum <= 0) {
            return null;
        }
        if (initialFilterSite && initialFilterSite.siteId === siteIdNum) {
            return initialFilterSite;
        }
        return {
            siteId: siteIdNum,
            name: t("standaloneHcFilterSiteIdFallback", { id: siteIdNum }),
            type: "newt"
        };
    }, [initialFilterSite, siteIdQ, siteIdNum, t]);

    const resourceIdQ = searchParams.get("resourceId");
    const resourceIdNum = resourceIdQ ? parseInt(resourceIdQ, 10) : NaN;
    const selectedResource: SelectedResource | null = useMemo(() => {
        if (
            !resourceIdQ ||
            !Number.isInteger(resourceIdNum) ||
            resourceIdNum <= 0
        ) {
            return null;
        }
        if (
            initialFilterResource &&
            initialFilterResource.resourceId === resourceIdNum
        ) {
            return initialFilterResource;
        }
        return {
            name: t("standaloneHcFilterResourceIdFallback", {
                id: resourceIdNum
            }),
            resourceId: resourceIdNum,
            fullDomain: null,
            niceId: "",
            ssl: false,
            wildcard: false
        };
    }, [initialFilterResource, resourceIdQ, resourceIdNum, t]);

    const rows = healthChecks;

    function refreshList() {
        startRefresh(() => {
            router.refresh();
        });
    }

    // useEffect(() => {
    //     const interval = setInterval(() => {
    //         router.refresh();
    //     }, 30_000);
    //     return () => clearInterval(interval);
    // }, [router]);

    const handlePaginationChange = (newState: PaginationState) => {
        searchParams.set("page", (newState.pageIndex + 1).toString());
        searchParams.set("pageSize", newState.pageSize.toString());
        filter({ searchParams });
    };

    const handleSearchChange = useDebouncedCallback((value: string) => {
        if (value) {
            searchParams.set("query", value);
        } else {
            searchParams.delete("query");
        }
        searchParams.delete("page");
        filter({ searchParams });
    }, 300);

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
        filter({ searchParams: sp });
    }

    const clearSiteFilter = () => {
        handleFilterChange("siteId", undefined);
        setSiteFilterOpen(false);
    };

    const clearResourceFilter = () => {
        handleFilterChange("resourceId", undefined);
        setResourceFilterOpen(false);
    };

    const onPickSite = (site: Selectedsite) => {
        handleFilterChange("siteId", String(site.siteId));
        setSiteFilterOpen(false);
    };

    const onPickResource = (resource: SelectedResource) => {
        handleFilterChange("resourceId", String(resource.resourceId));
        setResourceFilterOpen(false);
    };

    const handleToggleEnabled = async (
        row: HealthCheckRow,
        enabled: boolean
    ) => {
        setTogglingId(row.targetHealthCheckId);
        try {
            await api.post(
                `/org/${orgId}/health-check/${row.targetHealthCheckId}`,
                { hcEnabled: enabled }
            );
            refreshList();
        } catch (e) {
            toast({
                title: t("error"),
                description: formatAxiosError(e),
                variant: "destructive"
            });
        } finally {
            setTogglingId(null);
        }
    };

    const handleDelete = async () => {
        if (!selected) return;
        try {
            await api.delete(
                `/org/${orgId}/health-check/${selected.targetHealthCheckId}`
            );
            refreshList();
            toast({ title: t("standaloneHcDeleted") });
        } catch (e) {
            toast({
                title: t("error"),
                description: formatAxiosError(e),
                variant: "destructive"
            });
        } finally {
            setDeleteOpen(false);
            setSelected(null);
        }
    };

    const modeParam = searchParams.get("hcMode");
    const selectedHcMode =
        modeParam === "http" ||
        modeParam === "tcp" ||
        modeParam === "snmp" ||
        modeParam === "ping"
            ? modeParam
            : undefined;
    const healthParam = searchParams.get("hcHealth");
    const selectedHcHealth =
        healthParam === "healthy" ||
        healthParam === "unhealthy" ||
        healthParam === "unknown"
            ? healthParam
            : undefined;
    const enabledParam = searchParams.get("hcEnabled");
    const selectedHcEnabled =
        enabledParam === "true" || enabledParam === "false"
            ? enabledParam
            : undefined;

    const columns: ExtendedColumnDef<HealthCheckRow>[] = [
        {
            accessorKey: "name",
            enableHiding: false,
            friendlyName: t("name"),
            header: ({ column }) => (
                <Button
                    variant="ghost"
                    onClick={() =>
                        column.toggleSorting(column.getIsSorted() === "asc")
                    }
                >
                    {t("name")}
                    <ArrowUpDown className="ml-2 h-4 w-4" />
                </Button>
            ),
            cell: ({ row }) => (
                <span>{row.original.name ? row.original.name : "-"}</span>
            )
        },
        {
            id: "mode",
            friendlyName: t("standaloneHcColumnMode"),
            header: () => (
                <ColumnFilterButton
                    options={[
                        {
                            value: "http",
                            label: t("standaloneHcFilterModeHttp")
                        },
                        { value: "tcp", label: t("standaloneHcFilterModeTcp") },
                        {
                            value: "snmp",
                            label: t("standaloneHcFilterModeSnmp")
                        },
                        {
                            value: "ping",
                            label: t("standaloneHcFilterModePing")
                        }
                    ]}
                    selectedValue={selectedHcMode}
                    onValueChange={(value) =>
                        handleFilterChange("hcMode", value)
                    }
                    searchPlaceholder={t("searchPlaceholder")}
                    emptyMessage={t("emptySearchOptions")}
                    label={t("standaloneHcColumnMode")}
                    className="p-3"
                />
            ),
            cell: ({ row }) => (
                <span>{row.original.hcMode?.toUpperCase() ?? "-"}</span>
            )
        },
        {
            id: "target",
            friendlyName: t("standaloneHcColumnTarget"),
            header: () => (
                <span className="p-3">{t("standaloneHcColumnTarget")}</span>
            ),
            cell: ({ row }) => <span>{formatTarget(row.original)}</span>
        },
        {
            id: "resource",
            friendlyName: t("resource"),
            header: () => (
                <Popover
                    open={resourceFilterOpen}
                    onOpenChange={setResourceFilterOpen}
                >
                    <PopoverTrigger asChild>
                        <Button
                            type="button"
                            variant="ghost"
                            role="combobox"
                            className={cn(
                                "justify-between text-sm h-8 px-2 w-full p-3",
                                !selectedResource && "text-muted-foreground"
                            )}
                        >
                            <div className="flex items-center gap-2 min-w-0">
                                {t("resource")}
                                <Funnel className="size-4 flex-none" />
                                {selectedResource && (
                                    <Badge
                                        className="truncate max-w-[10rem]"
                                        variant="secondary"
                                    >
                                        {selectedResource.name}
                                    </Badge>
                                )}
                            </div>
                        </Button>
                    </PopoverTrigger>
                    <PopoverContent
                        className={dataTableFilterPopoverContentClassName}
                        align="start"
                    >
                        <div className="border-b p-1">
                            <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                className="h-8 w-full justify-start font-normal"
                                onClick={clearResourceFilter}
                            >
                                {t("standaloneHcFilterAnyResource")}
                            </Button>
                        </div>
                        <ResourceSelector
                            orgId={orgId}
                            selectedResource={selectedResource}
                            onSelectResource={onPickResource}
                        />
                    </PopoverContent>
                </Popover>
            ),
            cell: ({ row }) => {
                const r = row.original;
                if (!r.resourceId || !r.resourceName || !r.resourceNiceId) {
                    return <span className="text-neutral-400">-</span>;
                }
                return (
                    <Link
                        href={`/${orgId}/settings/resources/public/${r.resourceNiceId}`}
                    >
                        <Button variant="outline" size="sm">
                            {r.resourceName}
                            <ArrowUpRight className="ml-2 h-3 w-3" />
                        </Button>
                    </Link>
                );
            }
        },
        {
            id: "site",
            friendlyName: t("site"),
            header: () => (
                <Popover open={siteFilterOpen} onOpenChange={setSiteFilterOpen}>
                    <PopoverTrigger asChild>
                        <Button
                            type="button"
                            variant="ghost"
                            role="combobox"
                            className={cn(
                                "justify-between text-sm h-8 px-2 w-full p-3",
                                !selectedSite && "text-muted-foreground"
                            )}
                        >
                            <div className="flex items-center gap-2 min-w-0">
                                {t("site")}
                                <Funnel className="size-4 flex-none" />
                                {selectedSite && (
                                    <Badge
                                        className="truncate max-w-[10rem]"
                                        variant="secondary"
                                    >
                                        {selectedSite.name}
                                    </Badge>
                                )}
                            </div>
                        </Button>
                    </PopoverTrigger>
                    <PopoverContent
                        className={dataTableFilterPopoverContentClassName}
                        align="start"
                    >
                        <div className="border-b p-1">
                            <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                className="h-8 w-full justify-start font-normal"
                                onClick={clearSiteFilter}
                            >
                                {t("standaloneHcFilterAnySite")}
                            </Button>
                        </div>
                        <SitesSelector
                            orgId={orgId}
                            selectedSite={selectedSite}
                            onSelectSite={onPickSite}
                        />
                    </PopoverContent>
                </Popover>
            ),
            cell: ({ row }) => {
                const r = row.original;
                if (!r.siteId || !r.siteName || !r.siteNiceId) {
                    return <span className="text-neutral-400">-</span>;
                }
                return (
                    <Link
                        href={`/${orgId}/settings/sites/${r.siteNiceId}/general`}
                    >
                        <Button variant="outline" size="sm">
                            {r.siteName}
                            <ArrowUpRight className="ml-2 h-3 w-3" />
                        </Button>
                    </Link>
                );
            }
        },
        {
            id: "health",
            friendlyName: t("standaloneHcColumnHealth"),
            header: () => (
                <ColumnFilterButton
                    options={[
                        {
                            value: "healthy",
                            label: t("standaloneHcHealthStateHealthy")
                        },
                        {
                            value: "unhealthy",
                            label: t("standaloneHcHealthStateUnhealthy")
                        },
                        {
                            value: "unknown",
                            label: t("standaloneHcHealthStateUnknown")
                        }
                    ]}
                    selectedValue={selectedHcHealth}
                    onValueChange={(value) =>
                        handleFilterChange("hcHealth", value)
                    }
                    searchPlaceholder={t("searchPlaceholder")}
                    emptyMessage={t("emptySearchOptions")}
                    label={t("standaloneHcColumnHealth")}
                    className="p-3"
                />
            ),
            cell: ({ row }) => {
                const health = row.original.hcHealth;
                if (health === "healthy") {
                    return (
                        <span className="flex items-center space-x-2">
                            <div className="w-2 h-2 bg-green-500 rounded-full" />
                            <span>{t("standaloneHcHealthStateHealthy")}</span>
                        </span>
                    );
                } else if (health === "unhealthy") {
                    return (
                        <span className="flex items-center space-x-2">
                            <div className="w-2 h-2 bg-red-500 rounded-full" />
                            <span>{t("standaloneHcHealthStateUnhealthy")}</span>
                        </span>
                    );
                } else {
                    return (
                        <span className="flex items-center space-x-2">
                            <div className="w-2 h-2 bg-neutral-500 rounded-full" />
                            <span>{t("standaloneHcHealthStateUnknown")}</span>
                        </span>
                    );
                }
            }
        },
        {
            id: "uptime",
            friendlyName: t("uptime30d"),
            header: () => <span className="p-3">{t("uptime30d")}</span>,
            cell: ({ row }) => {
                return (
                    <UptimeMiniBar
                        orgId={orgId}
                        healthCheckId={row.original.targetHealthCheckId}
                        days={30}
                    />
                );
            }
        },
        {
            accessorKey: "hcEnabled",
            friendlyName: t("alertingColumnEnabled"),
            header: () => (
                <ColumnFilterButton
                    options={[
                        {
                            value: "true",
                            label: t("standaloneHcFilterEnabledOn")
                        },
                        {
                            value: "false",
                            label: t("standaloneHcFilterEnabledOff")
                        }
                    ]}
                    selectedValue={selectedHcEnabled}
                    onValueChange={(value) =>
                        handleFilterChange("hcEnabled", value)
                    }
                    searchPlaceholder={t("searchPlaceholder")}
                    emptyMessage={t("emptySearchOptions")}
                    label={t("alertingColumnEnabled")}
                    className="p-3"
                />
            ),
            cell: ({ row }) => {
                const r = row.original;
                return (
                    <Switch
                        checked={r.hcEnabled}
                        disabled={
                            !isPaid ||
                            togglingId === r.targetHealthCheckId ||
                            !!r.resourceId
                        }
                        onCheckedChange={(v) => handleToggleEnabled(r, v)}
                    />
                );
            }
        },
        {
            id: "rowActions",
            enableHiding: false,
            header: () => <span className="p-3" />,
            cell: ({ row }) => {
                const r = row.original;
                return (
                    <div className="flex items-center gap-2 justify-end">
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
                                    disabled={!isPaid || !!r.resourceId}
                                    onClick={() => {
                                        setSelected(r);
                                        setDeleteOpen(true);
                                    }}
                                >
                                    <span className="text-red-500">
                                        {t("delete")}
                                    </span>
                                </DropdownMenuItem>
                            </DropdownMenuContent>
                        </DropdownMenu>
                        {r.resourceId && r.resourceName && r.resourceNiceId ? (
                            <Link
                                href={`/${orgId}/settings/resources/public/${r.resourceNiceId}`}
                            >
                                <Button variant="outline" disabled={!isPaid}>
                                    {t("edit")}
                                </Button>
                            </Link>
                        ) : (
                            <Button
                                variant="outline"
                                disabled={!isPaid}
                                onClick={() => {
                                    setSelected(r);
                                    setCredenzaOpen(true);
                                }}
                            >
                                {t("edit")}
                            </Button>
                        )}
                    </div>
                );
            }
        }
    ];

    return (
        <>
            {selected && deleteOpen && (
                <ConfirmDeleteDialog
                    open={deleteOpen}
                    setOpen={(val) => {
                        setDeleteOpen(val);
                        if (!val) setSelected(null);
                    }}
                    dialog={
                        <div className="space-y-2">
                            <p>{t("standaloneHcDeleteQuestion")}</p>
                        </div>
                    }
                    buttonText={t("delete")}
                    onConfirm={handleDelete}
                    string={selected.name}
                    title={t("standaloneHcDeleteTitle")}
                />
            )}

            <HealthCheckCredenza
                mode="submit"
                open={credenzaOpen}
                setOpen={(val) => {
                    setCredenzaOpen(val);
                    if (!val) setSelected(null);
                }}
                orgId={orgId}
                initialValues={selected}
                onSaved={refreshList}
            />

            <PaidFeaturesAlert tiers={tierMatrix.standaloneHealthChecks} />

            <ControlledDataTable
                columns={columns}
                rows={rows}
                tableId="health-checks-table"
                searchPlaceholder={t("standaloneHcSearchPlaceholder")}
                onSearch={handleSearchChange}
                searchQuery={query}
                onAdd={() => {
                    setSelected(null);
                    setCredenzaOpen(true);
                }}
                addButtonDisabled={!isPaid}
                onRefresh={refreshList}
                isRefreshing={isRefreshing || isFiltering}
                addButtonText={t("standaloneHcAddButton")}
                enableColumnVisibility
                stickyLeftColumn="name"
                stickyRightColumn="rowActions"
                pagination={pagination}
                onPaginationChange={handlePaginationChange}
                rowCount={rowCount}
            />
        </>
    );
}
