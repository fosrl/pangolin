"use client";

import ConfirmDeleteDialog from "@app/components/ConfirmDeleteDialog";
import CopyToClipboard from "@app/components/CopyToClipboard";
import CreateResourceGroupDialog from "@app/components/CreateResourceGroupDialog";
import MoveResourceToGroupDialog from "@app/components/MoveResourceToGroupDialog";
import { Button } from "@app/components/ui/button";
import { ExtendedColumnDef } from "@app/components/ui/data-table";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger
} from "@app/components/ui/dropdown-menu";
import { InfoPopup } from "@app/components/ui/info-popup";
import { Switch } from "@app/components/ui/switch";
import { TableCell, TableRow } from "@app/components/ui/table";
import { useEnvContext } from "@app/hooks/useEnvContext";
import { useNavigationContext } from "@app/hooks/useNavigationContext";
import { getNextSortOrder, getSortDirection } from "@app/lib/sortColumn";
import { toast } from "@app/hooks/useToast";
import { createApiClient, formatAxiosError } from "@app/lib/api";
import { UpdateResourceResponse } from "@server/routers/resource";
import type { PaginationState } from "@tanstack/react-table";
import { AxiosResponse } from "axios";
import {
    ArrowDown01Icon,
    ArrowRight,
    ArrowUp10Icon,
    CheckCircle2,
    ChevronDown,
    ChevronRight,
    ChevronsUpDownIcon,
    Clock,
    FolderOpen,
    MoreHorizontal,
    ShieldCheck,
    ShieldOff,
    Trash2,
    XCircle
} from "lucide-react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
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

export type TargetHealth = {
    targetId: number;
    ip: string;
    port: number;
    enabled: boolean;
    healthStatus: "healthy" | "unhealthy" | "unknown" | null;
};

export type ResourceRow = {
    id: number;
    nice: string | null;
    name: string;
    orgId: string;
    domain: string;
    authState: string;
    http: boolean;
    protocol: string;
    proxyPort: number | null;
    enabled: boolean;
    domainId?: string;
    ssl: boolean;
    targetHost?: string;
    targetPort?: number;
    targets?: TargetHealth[];
    groupId: number | null;
};

type Group = { groupId: number; name: string; sortOrder: number };

function getOverallHealthStatus(
    targets?: TargetHealth[]
): "online" | "degraded" | "offline" | "unknown" {
    if (!targets || targets.length === 0) {
        return "unknown";
    }

    const monitoredTargets = targets.filter(
        (t) => t.enabled && t.healthStatus && t.healthStatus !== "unknown"
    );

    if (monitoredTargets.length === 0) {
        return "unknown";
    }

    const healthyCount = monitoredTargets.filter(
        (t) => t.healthStatus === "healthy"
    ).length;
    const unhealthyCount = monitoredTargets.filter(
        (t) => t.healthStatus === "unhealthy"
    ).length;

    if (healthyCount === monitoredTargets.length) {
        return "online";
    } else if (unhealthyCount === monitoredTargets.length) {
        return "offline";
    } else {
        return "degraded";
    }
}

function StatusIcon({
    status,
    className = ""
}: {
    status: "online" | "degraded" | "offline" | "unknown";
    className?: string;
}) {
    const iconClass = `h-4 w-4 ${className}`;

    switch (status) {
        case "online":
            return <CheckCircle2 className={`${iconClass} text-green-500`} />;
        case "degraded":
            return <CheckCircle2 className={`${iconClass} text-yellow-500`} />;
        case "offline":
            return <XCircle className={`${iconClass} text-destructive`} />;
        case "unknown":
            return <Clock className={`${iconClass} text-muted-foreground`} />;
        default:
            return null;
    }
}

type ProxyResourcesTableProps = {
    resources: ResourceRow[];
    orgId: string;
    pagination: PaginationState;
    rowCount: number;
    groups: Group[];
};

export default function ProxyResourcesTable({
    resources,
    orgId,
    pagination,
    rowCount,
    groups
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

    const [isMoveDialogOpen, setIsMoveDialogOpen] = useState(false);
    const [moveTarget, setMoveTarget] = useState<ResourceRow | null>(null);

    const [isCreateGroupDialogOpen, setIsCreateGroupDialogOpen] =
        useState(false);
    const [isDeleteGroupModalOpen, setIsDeleteGroupModalOpen] = useState(false);
    const [selectedGroup, setSelectedGroup] = useState<Group | null>(null);

    const [collapsedGroups, setCollapsedGroups] = useState<Set<number>>(
        new Set()
    );

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

    const deleteResource = (resourceId: number) => {
        api.delete(`/resource/${resourceId}`)
            .catch((e) => {
                console.error(t("resourceErrorDelte"), e);
                toast({
                    variant: "destructive",
                    title: t("resourceErrorDelte"),
                    description: formatAxiosError(e, t("resourceErrorDelte"))
                });
            })
            .then(() => {
                startTransition(() => {
                    router.refresh();
                    setIsDeleteModalOpen(false);
                });
            });
    };

    const deleteGroup = (groupId: number) => {
        api.delete(`/org/${orgId}/resource-group/${groupId}`)
            .catch((e) => {
                toast({
                    variant: "destructive",
                    title: "Error deleting group",
                    description: formatAxiosError(e, "Could not delete group")
                });
            })
            .then(() => {
                startTransition(() => {
                    router.refresh();
                    setIsDeleteGroupModalOpen(false);
                });
            });
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

    function toggleGroupCollapsed(groupId: number) {
        setCollapsedGroups((prev) => {
            const next = new Set(prev);
            if (next.has(groupId)) {
                next.delete(groupId);
            } else {
                next.add(groupId);
            }
            return next;
        });
    }

    function TargetStatusCell({ targets }: { targets?: TargetHealth[] }) {
        const overallStatus = getOverallHealthStatus(targets);

        if (!targets || targets.length === 0) {
            return (
                <div className="flex items-center gap-2">
                    <StatusIcon status="unknown" />
                    <span className="text-sm">
                        {t("resourcesTableNoTargets")}
                    </span>
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
                            {overallStatus === "online" &&
                                t("resourcesTableHealthy")}
                            {overallStatus === "degraded" &&
                                t("resourcesTableDegraded")}
                            {overallStatus === "offline" &&
                                t("resourcesTableOffline")}
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
                                                target.healthStatus ===
                                                "healthy"
                                                    ? "online"
                                                    : "offline"
                                            }
                                            className="h-3 w-3"
                                        />
                                        {`${target.ip}:${target.port}`}
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
                                        {`${target.ip}:${target.port}`}
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

    const proxyColumns: ExtendedColumnDef<ResourceRow>[] = [
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
            accessorKey: "protocol",
            friendlyName: t("protocol"),
            header: () => <span className="p-3">{t("protocol")}</span>,
            cell: ({ row }) => {
                const resourceRow = row.original;
                return (
                    <span>
                        {resourceRow.http
                            ? resourceRow.ssl
                                ? "HTTPS"
                                : "HTTP"
                            : resourceRow.protocol.toUpperCase()}
                    </span>
                );
            }
        },
        {
            id: "status",
            accessorKey: "status",
            friendlyName: t("status"),
            header: () => (
                <ColumnFilterButton
                    options={[
                        { value: "healthy", label: t("resourcesTableHealthy") },
                        {
                            value: "degraded",
                            label: t("resourcesTableDegraded")
                        },
                        { value: "offline", label: t("resourcesTableOffline") },
                        {
                            value: "no_targets",
                            label: t("resourcesTableNoTargets")
                        },
                        { value: "unknown", label: t("resourcesTableUnknown") }
                    ]}
                    selectedValue={
                        searchParams.get("healthStatus") ?? undefined
                    }
                    onValueChange={(value) =>
                        handleFilterChange("healthStatus", value)
                    }
                    searchPlaceholder={t("searchPlaceholder")}
                    emptyMessage={t("emptySearchOptions")}
                    label={t("status")}
                    className="p-3"
                />
            ),
            cell: ({ row }) => {
                const resourceRow = row.original;
                return <TargetStatusCell targets={resourceRow.targets} />;
            },
            sortingFn: (rowA, rowB) => {
                const statusA = getOverallHealthStatus(rowA.original.targets);
                const statusB = getOverallHealthStatus(rowB.original.targets);
                const statusOrder = {
                    online: 3,
                    degraded: 2,
                    offline: 1,
                    unknown: 0
                };
                return statusOrder[statusA] - statusOrder[statusB];
            }
        },
        {
            accessorKey: "domain",
            friendlyName: t("access"),
            header: () => <span className="p-3">{t("access")}</span>,
            cell: ({ row }) => {
                const resourceRow = row.original;
                return (
                    <div className="flex items-center space-x-2">
                        {!resourceRow.http ? (
                            <CopyToClipboard
                                text={resourceRow.proxyPort?.toString() || ""}
                                isLink={false}
                            />
                        ) : !resourceRow.domainId ? (
                            <InfoPopup
                                info={t("domainNotFoundDescription")}
                                text={t("domainNotFound")}
                            />
                        ) : (
                            <CopyToClipboard
                                text={resourceRow.domain}
                                isLink={true}
                            />
                        )}
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
                        { value: "not_protected", label: t("notProtected") },
                        { value: "none", label: t("none") }
                    ]}
                    selectedValue={searchParams.get("authState") ?? undefined}
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
                                <Button variant="ghost" className="h-8 w-8 p-0">
                                    <span className="sr-only">
                                        {t("openMenu")}
                                    </span>
                                    <MoreHorizontal className="h-4 w-4" />
                                </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                                <Link
                                    className="block w-full"
                                    href={`/${resourceRow.orgId}/settings/resources/proxy/${resourceRow.nice}`}
                                >
                                    <DropdownMenuItem>
                                        {t("viewSettings")}
                                    </DropdownMenuItem>
                                </Link>
                                <DropdownMenuItem
                                    onClick={() => {
                                        setMoveTarget(resourceRow);
                                        setIsMoveDialogOpen(true);
                                    }}
                                >
                                    Move to group...
                                </DropdownMenuItem>
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
                            href={`/${resourceRow.orgId}/settings/resources/proxy/${resourceRow.nice}`}
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

    const booleanSearchFilterSchema = z
        .enum(["true", "false"])
        .optional()
        .catch(undefined);

    function handleFilterChange(
        column: string,
        value: string | undefined | null
    ) {
        searchParams.delete(column);
        searchParams.delete("page");

        if (value) {
            searchParams.set(column, value);
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

    // Build ordered flat row list for grouped display
    const sortedGroups = [...groups].sort(
        (a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name)
    );

    // IDs of rows that belong to a collapsed group (should be hidden)
    const collapsedResourceIds = new Set<number>();

    // displayRows: includes sentinel (first) row for each collapsed group,
    // plus all rows for expanded groups, in order
    const displayRows: ResourceRow[] = [];
    if (groups.length > 0) {
        for (const group of sortedGroups) {
            const groupResources = resources
                .filter((r) => r.groupId === group.groupId)
                .sort((a, b) => a.name.localeCompare(b.name));
            if (collapsedGroups.has(group.groupId)) {
                // Add only the first resource as a sentinel to trigger header rendering
                if (groupResources.length > 0) {
                    displayRows.push(groupResources[0]);
                    // Mark the sentinel as collapsed (hidden)
                    collapsedResourceIds.add(groupResources[0].id);
                }
            } else {
                displayRows.push(...groupResources);
            }
        }
        const ungroupedResources = resources
            .filter((r) => r.groupId === null)
            .sort((a, b) => a.name.localeCompare(b.name));
        if (ungroupedResources.length > 0) {
            if (collapsedGroups.has(-1)) {
                displayRows.push(ungroupedResources[0]);
                collapsedResourceIds.add(ungroupedResources[0].id);
            } else {
                displayRows.push(...ungroupedResources);
            }
        }
    }

    function getGroupHeaderBeforeRow(
        row: ResourceRow,
        index: number,
        prevRow: ResourceRow | undefined,
        colSpan: number
    ) {
        if (groups.length === 0) return null;

        const currentGroupId = row.groupId ?? -1;
        const prevGroupId =
            prevRow !== undefined ? (prevRow.groupId ?? -1) : null;

        // Only render a header at group boundaries
        if (currentGroupId === prevGroupId) return null;

        const group: Group | null =
            row.groupId === null
                ? resources.some((r) => r.groupId === null)
                    ? { groupId: -1, name: "Ungrouped", sortOrder: 9999 }
                    : null
                : (groups.find((g) => g.groupId === row.groupId) ?? null);
        if (!group) return null;

        const count = resources.filter((r) =>
            group.groupId === -1
                ? r.groupId === null
                : r.groupId === group.groupId
        ).length;

        const isCollapsed = collapsedGroups.has(group.groupId);

        return (
            <TableRow
                key={`group-header-${group.groupId}`}
                className="bg-muted/40 hover:bg-muted/40"
            >
                <TableCell colSpan={colSpan} className="py-2 px-4">
                    <div className="flex items-center justify-between">
                        <button
                            type="button"
                            className="flex items-center gap-2 text-sm font-medium"
                            onClick={() => toggleGroupCollapsed(group.groupId)}
                        >
                            {isCollapsed ? (
                                <ChevronRight className="h-4 w-4" />
                            ) : (
                                <ChevronDown className="h-4 w-4" />
                            )}
                            <FolderOpen className="h-4 w-4 text-muted-foreground" />
                            <span>{group.name}</span>
                            <span className="text-muted-foreground font-normal">
                                ({count})
                            </span>
                        </button>
                        {group.groupId !== -1 && (
                            <button
                                type="button"
                                className="flex items-center gap-1 text-xs text-muted-foreground hover:text-destructive"
                                onClick={() => {
                                    setSelectedGroup(group);
                                    setIsDeleteGroupModalOpen(true);
                                }}
                            >
                                <Trash2 className="h-3 w-3" />
                                Delete group
                            </button>
                        )}
                    </div>
                </TableCell>
            </TableRow>
        );
    }

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
                    onConfirm={async () => deleteResource(selectedResource!.id)}
                    string={selectedResource.name}
                    title={t("resourceDelete")}
                />
            )}

            {selectedGroup && (
                <ConfirmDeleteDialog
                    open={isDeleteGroupModalOpen}
                    setOpen={(val) => {
                        setIsDeleteGroupModalOpen(val);
                        if (!val) setSelectedGroup(null);
                    }}
                    dialog={
                        <div className="space-y-2">
                            <p>
                                Are you sure you want to delete the group &quot;
                                {selectedGroup.name}&quot;?
                            </p>
                            <p>
                                Resources in this group will become ungrouped.
                                They will not be deleted.
                            </p>
                        </div>
                    }
                    buttonText="Delete Group"
                    onConfirm={async () => deleteGroup(selectedGroup.groupId)}
                    string={selectedGroup.name}
                    title="Delete Group"
                />
            )}

            {moveTarget && (
                <MoveResourceToGroupDialog
                    open={isMoveDialogOpen}
                    setOpen={(val) => {
                        setIsMoveDialogOpen(val);
                        if (!val) setMoveTarget(null);
                    }}
                    resourceId={moveTarget.id}
                    resourceName={moveTarget.name}
                    currentGroupId={moveTarget.groupId}
                    groups={groups}
                />
            )}

            <CreateResourceGroupDialog
                open={isCreateGroupDialogOpen}
                setOpen={setIsCreateGroupDialogOpen}
                orgId={orgId}
            />

            <ControlledDataTable
                columns={proxyColumns}
                rows={groups.length === 0 ? resources : displayRows}
                tableId="proxy-resources"
                searchPlaceholder={t("resourcesSearch")}
                pagination={pagination}
                rowCount={rowCount}
                onSearch={handleSearchChange}
                onPaginationChange={handlePaginationChange}
                onAdd={() =>
                    startNavigation(() =>
                        router.push(`/${orgId}/settings/resources/proxy/create`)
                    )
                }
                addButtonText={t("resourceAdd")}
                onRefresh={refreshData}
                isRefreshing={isRefreshing || isFiltering}
                isNavigatingToAddPage={isNavigatingToAddPage}
                enableColumnVisibility
                columnVisibility={{ niceId: false }}
                stickyLeftColumn="name"
                stickyRightColumn="actions"
                extraToolbarActions={
                    <Button
                        variant="outline"
                        onClick={() => setIsCreateGroupDialogOpen(true)}
                    >
                        <FolderOpen className="mr-2 h-4 w-4" />
                        Create Group
                    </Button>
                }
                getGroupHeaderBeforeRow={
                    groups.length > 0 ? getGroupHeaderBeforeRow : undefined
                }
                getRowClassName={
                    groups.length > 0
                        ? (row) =>
                              collapsedResourceIds.has(row.id) ? "hidden" : ""
                        : undefined
                }
            />
        </>
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
    const enabled = resource.http
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
                    (resource.http && !resource.domainId) ||
                    optimisticEnabled !== enabled
                }
                name="enabled"
                onCheckedChange={() => formRef.current?.requestSubmit()}
            />
        </form>
    );
}
