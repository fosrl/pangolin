"use client";

import ConfirmDeleteDialog from "@app/components/ConfirmDeleteDialog";
import CopyToClipboard from "@app/components/CopyToClipboard";
import { ResourceAccessCertIndicator } from "@app/components/ResourceAccessCertIndicator";
import {
    ResourceSitesStatusCell,
    type ResourceSiteRow
} from "@app/components/ResourceSitesStatusCell";
import { Selectedsite, SitesSelector } from "@app/components/site-selector";
import { Badge } from "@app/components/ui/badge";
import { Button } from "@app/components/ui/button";
import { ExtendedColumnDef } from "@app/components/ui/data-table";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger
} from "@app/components/ui/dropdown-menu";
import { InfoPopup } from "@app/components/ui/info-popup";
import {
    Popover,
    PopoverContent,
    PopoverTrigger
} from "@app/components/ui/popover";
import { Switch } from "@app/components/ui/switch";
import { useEnvContext } from "@app/hooks/useEnvContext";
import { useNavigationContext } from "@app/hooks/useNavigationContext";
import { usePaidStatus } from "@app/hooks/usePaidStatus";
import { toast } from "@app/hooks/useToast";
import { createApiClient, formatAxiosError } from "@app/lib/api";
import { cn } from "@app/lib/cn";
import { dataTableFilterPopoverContentClassName } from "@app/lib/dataTableFilterPopover";
import { getNextSortOrder, getSortDirection } from "@app/lib/sortColumn";
import { build } from "@server/build";
import { tierMatrix } from "@server/lib/billing/tierMatrix";
import { UpdateResourceResponse } from "@server/routers/resource";
import type { PaginationState } from "@tanstack/react-table";
import { AxiosResponse } from "axios";
import {
    ArrowDown01Icon,
    ArrowRight,
    ArrowUp10Icon,
    CheckCircle2,
    ChevronDown,
    ChevronsUpDownIcon,
    Clock,
    Funnel,
    MoreHorizontal,
    PlusIcon,
    ShieldCheck,
    ShieldOff,
    XCircle
} from "lucide-react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
    startTransition,
    useEffect,
    useMemo,
    useOptimistic,
    useRef,
    useState,
    useTransition,
    type ComponentRef
} from "react";
import { useDebouncedCallback } from "use-debounce";
import z from "zod";
import { ColumnFilterButton } from "./ColumnFilterButton";
import { ControlledDataTable } from "./ui/controlled-data-table";
import UptimeMiniBar from "./UptimeMiniBar";
import { type SelectedLabel } from "./labels-selector";
import { LabelColumnFilterButton } from "./LabelColumnFilterButton";
import { useLocalLabels } from "@app/hooks/useLocalLabels";
import { LabelsTableCell } from "./LabelsTableCell";
import { useOptimisticLabels } from "@app/hooks/useOptimisticLabels";
import { refresh } from "next/cache";
import { SitesColumnFilterButton } from "./SitesColumnFilterButton";

export type TargetHealth = {
    targetId: number;
    ip: string;
    port: number;
    enabled: boolean;
    healthStatus: "healthy" | "unhealthy" | "unknown" | null;
    siteName: string | null;
};

export type ResourceRow = {
    id: number;
    nice: string | null;
    name: string;
    orgId: string;
    domain: string;
    mode: string | null;
    authState: string;
    proxyPort: number | null;
    enabled: boolean;
    domainId?: string;
    /** Hostname for certificate API (without scheme); distinct from `domain` URL shown in Access column */
    fullDomain?: string | null;
    ssl: boolean;
    targetHost?: string;
    targetPort?: number;
    targets?: TargetHealth[];
    health?: "healthy" | "degraded" | "unhealthy" | "unknown";
    sites: ResourceSiteRow[];
    wildcard?: boolean;
    labels?: Array<{
        labelId: number;
        name: string;
        color: string;
    }>;
};

type ProxyResourcesTableProps = {
    resources: ResourceRow[];
    orgId: string;
    pagination: PaginationState;
    rowCount: number;
    initialFilterSite?: Selectedsite | null;
};

const booleanSearchFilterSchema = z
    .enum(["true", "false"])
    .optional()
    .catch(undefined);

export default function PublicResourcesTable({
    resources,
    orgId,
    pagination,
    rowCount,
    initialFilterSite = null
}: ProxyResourcesTableProps) {
    const router = useRouter();
    const {
        navigate: filter,
        isNavigating: isFiltering,
        searchParams
    } = useNavigationContext();
    const t = useTranslations();

    const { env } = useEnvContext();

    const api = createApiClient({ env });

    const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
    const [selectedResource, setSelectedResource] =
        useState<ResourceRow | null>();

    const { isPaidUser } = usePaidStatus();
    const isLabelFeatureEnabled = isPaidUser(tierMatrix.labels);

    const [isRefreshing, startTransition] = useTransition();
    const [isNavigatingToAddPage, startNavigation] = useTransition();

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

    const deleteResource = async (resourceId: number) => {
        await api.delete(`/resource/${resourceId}`).catch((e) => {
            console.error(t("resourceErrorDelte"), e);
            toast({
                variant: "destructive",
                title: t("resourceErrorDelte"),
                description: formatAxiosError(e, t("resourceErrorDelte"))
            });
        });
        router.refresh();
        setIsDeleteModalOpen(false);
    };

    async function toggleResourceEnabled(val: boolean, resourceId: number) {
        try {
            await api.post<AxiosResponse<UpdateResourceResponse>>(
                `resource/${resourceId}`,
                {
                    enabled: val
                }
            );
            router.refresh();
        } catch (e) {
            toast({
                variant: "destructive",
                title: t("resourcesErrorUpdate"),
                description: formatAxiosError(
                    e,
                    t("resourcesErrorUpdateDescription")
                )
            });
        }
    }

    const proxyColumns = useMemo<ExtendedColumnDef<ResourceRow>[]>(() => {
        const cols: ExtendedColumnDef<ResourceRow>[] = [
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
                header: () => <span className="p-3">{t("identifier")}</span>,
                cell: ({ row }) => {
                    return <span>{row.original.nice || "-"}</span>;
                }
            },
            {
                id: "sites",
                accessorFn: (row) =>
                    row.sites.map((s) => s.siteName).join(", "),
                friendlyName: t("sites"),
                header: () => {
                    const siteIdQ = searchParams.get("siteId");
                    const siteIdNum = siteIdQ ? parseInt(siteIdQ, 10) : NaN;

                    const selectedSiteId =
                        !siteIdQ ||
                        !Number.isInteger(siteIdNum) ||
                        siteIdNum <= 0
                            ? null
                            : siteIdNum;

                    return (
                        <SitesColumnFilterButton
                            selectedSiteId={selectedSiteId}
                            onValueChange={(value) =>
                                handleFilterChange("siteId", value?.toString())
                            }
                            orgId={orgId}
                        />
                    );
                },
                cell: ({ row }) => (
                    <ResourceSitesStatusCell
                        orgId={row.original.orgId}
                        resourceSites={row.original.sites}
                    />
                )
            },
            {
                accessorKey: "protocol",
                friendlyName: t("protocol"),
                enableHiding: true,
                header: () => (
                    <ColumnFilterButton
                        options={[
                            {
                                value: "http",
                                label: t("editInternalResourceDialogModeHttp")
                            },
                            {
                                value: "https",
                                label: t("editInternalResourceDialogModeHttps")
                            },
                            {
                                value: "tcp",
                                label: t("editInternalResourceDialogTcp")
                            },
                            {
                                value: "udp",
                                label: t("editInternalResourceDialogUdp")
                            },
                            {
                                value: "ssh",
                                label: t("editInternalResourceDialogModeSsh")
                            },
                            {
                                value: "rdp",
                                label: t("rdpTitle")
                            },
                            {
                                value: "vnc",
                                label: t("vncTitle")
                            }
                        ]}
                        selectedValue={
                            searchParams.get("protocol") ?? undefined
                        }
                        onValueChange={(value) =>
                            handleFilterChange("protocol", value)
                        }
                        searchPlaceholder={t("searchPlaceholder")}
                        emptyMessage={t("emptySearchOptions")}
                        label={t("protocol")}
                        className="p-3"
                    />
                ),
                cell: ({ row }) => {
                    const resourceRow = row.original;
                    return (
                        <span>
                            {resourceRow.mode == "http"
                                ? resourceRow.ssl
                                    ? "HTTPS"
                                    : "HTTP"
                                : resourceRow.mode?.toUpperCase()}
                        </span>
                    );
                }
            },
            {
                id: "status",
                accessorKey: "status",
                friendlyName: t("health"),
                header: () => (
                    <ColumnFilterButton
                        options={[
                            {
                                value: "healthy",
                                label: t("resourcesTableHealthy")
                            },
                            {
                                value: "degraded",
                                label: t("resourcesTableDegraded")
                            },
                            {
                                value: "unhealthy",
                                label: t("resourcesTableUnhealthy")
                            },
                            {
                                value: "unknown",
                                label: t("resourcesTableUnknown")
                            }
                        ]}
                        selectedValue={
                            searchParams.get("healthStatus") ?? undefined
                        }
                        onValueChange={(value) =>
                            handleFilterChange("healthStatus", value)
                        }
                        searchPlaceholder={t("searchPlaceholder")}
                        emptyMessage={t("emptySearchOptions")}
                        label={t("health")}
                        className="p-3"
                    />
                ),
                cell: ({ row }) => {
                    const resourceRow = row.original;
                    if (resourceRow.mode !== "http") {
                        return <span>-</span>;
                    }
                    return (
                        <TargetStatusCell
                            targets={resourceRow.targets}
                            healthStatus={resourceRow.health}
                        />
                    );
                },
                sortingFn: (rowA, rowB) => {
                    const statusA = rowA.original.health;
                    const statusB = rowB.original.health;
                    if (!statusA && !statusB) return 0;
                    if (!statusA) return 1;
                    if (!statusB) return -1;
                    const statusOrder = {
                        healthy: 3,
                        degraded: 2,
                        unhealthy: 1,
                        unknown: 0
                    };
                    return statusOrder[statusA] - statusOrder[statusB];
                }
            },
            {
                id: "statusHistory",
                friendlyName: t("uptime30d"),
                header: () => <span className="p-3">{t("uptime30d")}</span>,
                cell: ({ row }) => {
                    const resourceRow = row.original;
                    if (resourceRow.mode !== "http") {
                        return <span>-</span>;
                    }
                    return (
                        <UptimeMiniBar resourceId={resourceRow.id} days={30} />
                    );
                }
            },
            {
                accessorKey: "domain",
                friendlyName: t("access"),
                header: () => <span className="p-3">{t("access")}</span>,
                cell: ({ row }) => {
                    const resourceRow = row.original;

                    if (
                        !["http", "ssh", "rdp", "vnc"].includes(
                            resourceRow.mode || ""
                        )
                    ) {
                        return (
                            <div className="flex items-center gap-2 min-w-0">
                                <CopyToClipboard
                                    text={
                                        resourceRow.proxyPort?.toString() || ""
                                    }
                                    isLink={false}
                                />
                            </div>
                        );
                    }

                    if (!resourceRow.domainId) {
                        return (
                            <div className="flex items-center gap-2 min-w-0">
                                <InfoPopup
                                    info={t("domainNotFoundDescription")}
                                    text={t("domainNotFound")}
                                />
                            </div>
                        );
                    }

                    const domainId = resourceRow.domainId;
                    const certHostname = resourceRow.fullDomain;
                    const showHttpsCertIndicator =
                        build !== "oss" &&
                        resourceRow.ssl &&
                        certHostname != null &&
                        certHostname !== "";

                    return (
                        <div className="flex items-center gap-2 min-w-0">
                            {showHttpsCertIndicator ? (
                                <ResourceAccessCertIndicator
                                    orgId={resourceRow.orgId}
                                    domainId={domainId}
                                    fullDomain={certHostname}
                                />
                            ) : null}
                            <div className="">
                                {!resourceRow.wildcard ? (
                                    <CopyToClipboard
                                        text={resourceRow.domain}
                                        isLink={true}
                                    />
                                ) : (
                                    <span>{resourceRow.domain}</span>
                                )}
                            </div>
                        </div>
                    );
                }
            },
            {
                accessorKey: "authState",
                friendlyName: t("authentication"),
                header: () => (
                    <ColumnFilterButton
                        options={[
                            { value: "protected", label: t("protected") },
                            {
                                value: "not_protected",
                                label: t("notProtected")
                            },
                            { value: "none", label: t("none") }
                        ]}
                        selectedValue={
                            searchParams.get("authState") ?? undefined
                        }
                        onValueChange={(value) =>
                            handleFilterChange("authState", value)
                        }
                        searchPlaceholder={t("searchPlaceholder")}
                        emptyMessage={t("emptySearchOptions")}
                        label={t("authentication")}
                        className="p-3"
                    />
                ),
                cell: ({ row }) => {
                    const resourceRow = row.original;
                    return (
                        <div>
                            {resourceRow.authState === "protected" ? (
                                <span className="flex items-center space-x-2">
                                    <ShieldCheck className="w-4 h-4 text-green-500" />
                                    <span>{t("protected")}</span>
                                </span>
                            ) : resourceRow.authState === "not_protected" ? (
                                <span className="flex items-center space-x-2">
                                    <ShieldOff className="w-4 h-4 text-yellow-500" />
                                    <span>{t("notProtected")}</span>
                                </span>
                            ) : (
                                <span>-</span>
                            )}
                        </div>
                    );
                }
            },
            {
                accessorKey: "enabled",
                friendlyName: t("enabled"),
                header: () => (
                    <ColumnFilterButton
                        options={[
                            { value: "true", label: t("enabled") },
                            { value: "false", label: t("disabled") }
                        ]}
                        selectedValue={booleanSearchFilterSchema.parse(
                            searchParams.get("enabled")
                        )}
                        onValueChange={(value) =>
                            handleFilterChange("enabled", value)
                        }
                        searchPlaceholder={t("searchPlaceholder")}
                        emptyMessage={t("emptySearchOptions")}
                        label={t("enabled")}
                        className="p-3"
                    />
                ),
                cell: ({ row }) => (
                    <ResourceEnabledForm
                        resource={row.original}
                        onToggleResourceEnabled={toggleResourceEnabled}
                    />
                )
            },
            {
                id: "actions",
                enableHiding: false,
                header: () => <span className="p-3"></span>,
                cell: ({ row }) => {
                    const resourceRow = row.original;
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
                                        href={`/${resourceRow.orgId}/settings/resources/public/${resourceRow.nice}`}
                                    >
                                        <DropdownMenuItem>
                                            {t("viewSettings")}
                                        </DropdownMenuItem>
                                    </Link>
                                    <DropdownMenuItem
                                        onClick={() => {
                                            setSelectedResource(resourceRow);
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
                                href={`/${resourceRow.orgId}/settings/resources/public/${resourceRow.nice}`}
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
                cell: ({ row }: { row: { original: ResourceRow } }) => (
                    <ResourceLabelCell resource={row.original} orgId={orgId} />
                )
            });
        }

        return cols;
    }, [isLabelFeatureEnabled, orgId, t, searchParams]);

    function handleFilterChange(
        column: string,
        value: string | undefined | null | string[]
    ) {
        searchParams.delete(column);
        searchParams.delete("page");

        if (typeof value === "string") {
            searchParams.set(column, value);
        } else if (value) {
            value.forEach((val) => searchParams.append(column, val));
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
            {selectedResource && (
                <ConfirmDeleteDialog
                    open={isDeleteModalOpen}
                    setOpen={(val) => {
                        setIsDeleteModalOpen(val);
                        setSelectedResource(null);
                    }}
                    dialog={
                        <div className="space-y-2">
                            <p>{t("resourceQuestionRemove")}</p>
                            <p>{t("resourceMessageRemove")}</p>
                        </div>
                    }
                    buttonText={t("resourceDeleteConfirm")}
                    onConfirm={async () =>
                        startTransition(() =>
                            deleteResource(selectedResource!.id)
                        )
                    }
                    string={selectedResource.name}
                    title={t("resourceDelete")}
                />
            )}

            <ControlledDataTable
                columns={proxyColumns}
                rows={resources}
                tableId="proxy-resources"
                searchPlaceholder={t("resourcesSearch")}
                pagination={pagination}
                rowCount={rowCount}
                searchQuery={searchParams.get("query")?.toString()}
                onSearch={handleSearchChange}
                onPaginationChange={handlePaginationChange}
                onAdd={() =>
                    startNavigation(() =>
                        router.push(
                            `/${orgId}/settings/resources/public/create`
                        )
                    )
                }
                addButtonText={t("resourceAdd")}
                onRefresh={refreshData}
                isRefreshing={isRefreshing || isFiltering}
                isNavigatingToAddPage={isNavigatingToAddPage}
                enableColumnVisibility
                columnVisibility={{
                    niceId: false,
                    protocol: false,
                    labels: true
                }}
                stickyLeftColumn="name"
                stickyRightColumn="actions"
            />
        </>
    );
}

type ResourceLabelCellProps = {
    resource: ResourceRow;
    orgId: string;
};

function ResourceLabelCell({ resource, orgId }: ResourceLabelCellProps) {
    const { localLabels, refresh, toggleLabel } = useOptimisticLabels({
        serverLabels: resource.labels,
        orgId,
        entityId: resource.id,
        entityIdField: "resourceId"
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

function TargetStatusCell({
    targets,
    healthStatus
}: {
    targets?: TargetHealth[];
    healthStatus?: string;
}) {
    const overallStatus = healthStatus;
    const t = useTranslations();

    if (!targets || targets.length === 0) {
        return (
            <div className="flex items-center gap-2 px-0">
                <StatusIcon status="unknown" />
                <span className="text-sm">{t("resourcesTableNoTargets")}</span>
            </div>
        );
    }

    const monitoredTargets = targets.filter(
        (t) => t.enabled && t.healthStatus && t.healthStatus !== "unknown"
    );
    const unknownTargets = targets.filter(
        (t) => !t.enabled || !t.healthStatus || t.healthStatus === "unknown"
    );

    return (
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
                <Button
                    variant="ghost"
                    size="sm"
                    className="flex items-center gap-2 h-8 px-0 font-normal"
                >
                    <StatusIcon status={overallStatus} />
                    <span className="text-sm">
                        {overallStatus === "healthy" &&
                            t("resourcesTableHealthy")}
                        {overallStatus === "degraded" &&
                            t("resourcesTableDegraded")}
                        {overallStatus === "unhealthy" &&
                            t("resourcesTableUnhealthy")}
                        {overallStatus === "unknown" &&
                            t("resourcesTableUnknown")}
                    </span>
                    <ChevronDown className="h-3 w-3" />
                </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="min-w-70">
                {monitoredTargets.length > 0 && (
                    <>
                        {monitoredTargets.map((target) => (
                            <DropdownMenuItem
                                key={target.targetId}
                                className="flex items-center justify-between gap-4"
                            >
                                <div className="flex items-center gap-2">
                                    <StatusIcon
                                        status={
                                            target.healthStatus === "healthy"
                                                ? "online"
                                                : "offline"
                                        }
                                        className="h-3 w-3"
                                    />
                                    {target.siteName
                                        ? `${target.siteName} (${target.ip}:${target.port})`
                                        : `${target.ip}:${target.port}`}
                                </div>
                                <span
                                    className={`capitalize ${
                                        target.healthStatus === "healthy"
                                            ? "text-green-500"
                                            : "text-destructive"
                                    }`}
                                >
                                    {target.healthStatus}
                                </span>
                            </DropdownMenuItem>
                        ))}
                    </>
                )}
                {unknownTargets.length > 0 && (
                    <>
                        {unknownTargets.map((target) => (
                            <DropdownMenuItem
                                key={target.targetId}
                                className="flex items-center justify-between gap-4"
                            >
                                <div className="flex items-center gap-2">
                                    <StatusIcon
                                        status="unknown"
                                        className="h-3 w-3"
                                    />
                                    {target.siteName
                                        ? `${target.siteName} (${target.ip}:${target.port})`
                                        : `${target.ip}:${target.port}`}
                                </div>
                                <span className="text-muted-foreground">
                                    {!target.enabled
                                        ? t("disabled")
                                        : t("resourcesTableNotMonitored")}
                                </span>
                            </DropdownMenuItem>
                        ))}
                    </>
                )}
            </DropdownMenuContent>
        </DropdownMenu>
    );
}

type ResourceEnabledFormProps = {
    resource: ResourceRow;
    onToggleResourceEnabled: (
        val: boolean,
        resourceId: number
    ) => Promise<void>;
};

function ResourceEnabledForm({
    resource,
    onToggleResourceEnabled
}: ResourceEnabledFormProps) {
    const enabled = ["http", "ssh", "rdp", "vnc"].includes(resource.mode || "")
        ? !!resource.domainId && resource.enabled
        : resource.enabled;
    const [optimisticEnabled, setOptimisticEnabled] = useOptimistic(enabled);

    const formRef = useRef<ComponentRef<"form">>(null);

    async function submitAction(formData: FormData) {
        const newEnabled = !(formData.get("enabled") === "on");
        setOptimisticEnabled(newEnabled);
        await onToggleResourceEnabled(newEnabled, resource.id);
    }

    return (
        <form action={submitAction} ref={formRef}>
            <Switch
                checked={optimisticEnabled}
                disabled={
                    (["http", "ssh", "rdp", "vnc"].includes(
                        resource.mode || ""
                    ) &&
                        !resource.domainId) ||
                    optimisticEnabled !== enabled
                }
                name="enabled"
                onCheckedChange={() => formRef.current?.requestSubmit()}
            />
        </form>
    );
}

function StatusIcon({
    status,
    className = ""
}: {
    status: string | undefined | null;
    className?: string;
}) {
    const iconClass = `h-4 w-4 ${className}`;

    switch (status) {
        case "healthy":
            return <CheckCircle2 className={`${iconClass} text-green-500`} />;
        case "degraded":
            return <CheckCircle2 className={`${iconClass} text-yellow-500`} />;
        case "unhealthy":
            return <XCircle className={`${iconClass} text-destructive`} />;
        case "unknown":
            return <Clock className={`${iconClass} text-muted-foreground`} />;
        default:
            return null;
    }
}
