"use client";

import {
    ColumnDef,
    flexRender,
    getCoreRowModel,
    useReactTable,
    getPaginationRowModel,
    SortingState,
    getSortedRowModel,
    ColumnFiltersState,
    getFilteredRowModel,
    VisibilityState
} from "@tanstack/react-table";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
    DropdownMenuCheckboxItem,
} from "@app/components/ui/dropdown-menu";
import { Button } from "@app/components/ui/button";
import {
    ArrowRight,
    ArrowUpDown,
    MoreHorizontal,
    ArrowUpRight,
    ShieldOff,
    ShieldCheck,
    RefreshCw,
    Settings2,
    Plus,
    Search,
    ChevronDown,
    Clock,
    Wifi,
    WifiOff,
    CheckCircle2,
    XCircle,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useEffect } from "react";
import ConfirmDeleteDialog from "@app/components/ConfirmDeleteDialog";
import { formatAxiosError } from "@app/lib/api";
import { toast } from "@app/hooks/useToast";
import { createApiClient } from "@app/lib/api";
import { useEnvContext } from "@app/hooks/useEnvContext";
import CopyToClipboard from "@app/components/CopyToClipboard";
import { Switch } from "@app/components/ui/switch";
import { AxiosResponse } from "axios";
import { UpdateResourceResponse } from "@server/routers/resource";
import { ListSitesResponse } from "@server/routers/site";
import { useTranslations } from "next-intl";
import { InfoPopup } from "@app/components/ui/info-popup";
import { Input } from "@app/components/ui/input";
import { DataTablePagination } from "@app/components/DataTablePagination";
import { Card, CardContent, CardHeader } from "@app/components/ui/card";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow
} from "@app/components/ui/table";
import {
    Tabs,
    TabsContent,
    TabsList,
    TabsTrigger
} from "@app/components/ui/tabs";
import { useSearchParams } from "next/navigation";
import EditInternalResourceDialog from "@app/components/EditInternalResourceDialog";
import CreateInternalResourceDialog from "@app/components/CreateInternalResourceDialog";
import { Alert, AlertDescription } from "@app/components/ui/alert";


export type TargetHealth = {
    targetId: number;
    ip: string;
    port: number;
    enabled: boolean;
    healthStatus?: 'healthy' | 'unhealthy' | 'unknown';
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
};


function getOverallHealthStatus(targets?: TargetHealth[]): 'online' | 'degraded' | 'offline' | 'unknown' {
    if (!targets || targets.length === 0) {
        return 'unknown';
    }

    const monitoredTargets = targets.filter(t => t.enabled && t.healthStatus && t.healthStatus !== 'unknown');

    if (monitoredTargets.length === 0) {
        return 'unknown';
    }

    const healthyCount = monitoredTargets.filter(t => t.healthStatus === 'healthy').length;
    const unhealthyCount = monitoredTargets.filter(t => t.healthStatus === 'unhealthy').length;

    if (healthyCount === monitoredTargets.length) {
        return 'online';
    } else if (unhealthyCount === monitoredTargets.length) {
        return 'offline';
    } else {
        return 'degraded';
    }
}

function StatusIcon({ status, className = "" }: {
    status: 'online' | 'degraded' | 'offline' | 'unknown';
    className?: string;
}) {
    const iconClass = `h-4 w-4 ${className}`;

    switch (status) {
        case 'online':
            return <CheckCircle2 className={`${iconClass} text-green-500`} />;
        case 'degraded':
            return <CheckCircle2 className={`${iconClass} text-yellow-500`} />;
        case 'offline':
            return <XCircle className={`${iconClass} text-destructive`} />;
        case 'unknown':
            return <Clock className={`${iconClass} text-gray-400`} />;
        default:
            return null;
    }
}
export type InternalResourceRow = {
    id: number;
    name: string;
    orgId: string;
    siteName: string;
    protocol: string;
    proxyPort: number | null;
    siteId: number;
    siteNiceId: string;
    destinationIp: string;
    destinationPort: number;
};

type Site = ListSitesResponse["sites"][0];

type ResourcesTableProps = {
    resources: ResourceRow[];
    internalResources: InternalResourceRow[];
    orgId: string;
    defaultView?: "proxy" | "internal";
    defaultSort?: {
        id: string;
        desc: boolean;
    };
};


const STORAGE_KEYS = {
    PAGE_SIZE: 'datatable-page-size',
    getTablePageSize: (tableId?: string) =>
        tableId ? `datatable-${tableId}-page-size` : STORAGE_KEYS.PAGE_SIZE
};

const getStoredPageSize = (tableId?: string, defaultSize = 20): number => {
    if (typeof window === 'undefined') return defaultSize;

    try {
        const key = STORAGE_KEYS.getTablePageSize(tableId);
        const stored = localStorage.getItem(key);
        if (stored) {
            const parsed = parseInt(stored, 10);
            if (parsed > 0 && parsed <= 1000) {
                return parsed;
            }
        }
    } catch (error) {
        console.warn('Failed to read page size from localStorage:', error);
    }
    return defaultSize;
};

const setStoredPageSize = (pageSize: number, tableId?: string): void => {
    if (typeof window === 'undefined') return;

    try {
        const key = STORAGE_KEYS.getTablePageSize(tableId);
        localStorage.setItem(key, pageSize.toString());
    } catch (error) {
        console.warn('Failed to save page size to localStorage:', error);
    }
};



export default function ResourcesTable({
    resources,
    internalResources,
    orgId,
    defaultView = "proxy",
    defaultSort
}: ResourcesTableProps) {
    const router = useRouter();
    const searchParams = useSearchParams();
    const t = useTranslations();

    const { env } = useEnvContext();

    const api = createApiClient({ env });


    const [proxyPageSize, setProxyPageSize] = useState<number>(() =>
        getStoredPageSize('proxy-resources', 20)
    );
    const [internalPageSize, setInternalPageSize] = useState<number>(() =>
        getStoredPageSize('internal-resources', 20)
    );

    const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
    const [selectedResource, setSelectedResource] =
        useState<ResourceRow | null>();
    const [selectedInternalResource, setSelectedInternalResource] =
        useState<InternalResourceRow | null>();
    const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
    const [editingResource, setEditingResource] =
        useState<InternalResourceRow | null>();
    const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
    const [sites, setSites] = useState<Site[]>([]);

    const [proxySorting, setProxySorting] = useState<SortingState>(
        defaultSort ? [defaultSort] : []
    );

    const [proxyColumnVisibility, setProxyColumnVisibility] = useState<VisibilityState>({});
    const [internalColumnVisibility, setInternalColumnVisibility] = useState<VisibilityState>({});

    const [proxyColumnFilters, setProxyColumnFilters] =
        useState<ColumnFiltersState>([]);
    const [proxyGlobalFilter, setProxyGlobalFilter] = useState<any>([]);

    const [internalSorting, setInternalSorting] = useState<SortingState>(
        defaultSort ? [defaultSort] : []
    );
    const [internalColumnFilters, setInternalColumnFilters] =
        useState<ColumnFiltersState>([]);
    const [internalGlobalFilter, setInternalGlobalFilter] = useState<any>([]);
    const [isRefreshing, setIsRefreshing] = useState(false);

    const currentView = searchParams.get("view") || defaultView;

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

    useEffect(() => {
        const fetchSites = async () => {
            try {
                const res = await api.get<AxiosResponse<ListSitesResponse>>(
                    `/org/${orgId}/sites`
                );
                setSites(res.data.data.sites);
            } catch (error) {
                console.error("Failed to fetch sites:", error);
            }
        };

        if (orgId) {
            fetchSites();
        }
    }, [orgId]);

    const handleTabChange = (value: string) => {
        const params = new URLSearchParams(searchParams);
        if (value === "internal") {
            params.set("view", "internal");
        } else {
            params.delete("view");
        }

        const newUrl = `${window.location.pathname}${params.toString() ? "?" + params.toString() : ""}`;
        router.replace(newUrl, { scroll: false });
    };

    const getSearchInput = () => {
        if (currentView === "internal") {
            return (
                <div className="relative w-full sm:max-w-sm">
                    <Input
                        placeholder={t("resourcesSearch")}
                        value={internalGlobalFilter ?? ""}
                        onChange={(e) =>
                            internalTable.setGlobalFilter(
                                String(e.target.value)
                            )
                        }
                        className="w-full pl-8"
                    />
                    <Search className="h-4 w-4 absolute left-2 top-1/2 transform -translate-y-1/2 text-muted-foreground" />
                </div>
            );
        }
        return (
            <div className="relative w-full sm:max-w-sm">
                <Input
                    placeholder={t("resourcesSearch")}
                    value={proxyGlobalFilter ?? ""}
                    onChange={(e) =>
                        proxyTable.setGlobalFilter(String(e.target.value))
                    }
                    className="w-full pl-8"
                />
                <Search className="h-4 w-4 absolute left-2 top-1/2 transform -translate-y-1/2 text-muted-foreground" />
            </div>
        );
    };

    const getActionButton = () => {
        if (currentView === "internal") {
            return (
                <Button onClick={() => setIsCreateDialogOpen(true)}>
                    <Plus className="mr-2 h-4 w-4" />
                    {t("resourceAdd")}
                </Button>
            );
        }
        return (
            <Button
                onClick={() =>
                    router.push(`/${orgId}/settings/resources/create`)
                }
            >
                <Plus className="mr-2 h-4 w-4" />
                {t("resourceAdd")}
            </Button>
        );
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
                router.refresh();
                setIsDeleteModalOpen(false);
            });
    };

    const deleteInternalResource = async (
        resourceId: number,
        siteId: number
    ) => {
        try {
            await api.delete(
                `/org/${orgId}/site/${siteId}/resource/${resourceId}`
            );
            router.refresh();
            setIsDeleteModalOpen(false);
        } catch (e) {
            console.error(t("resourceErrorDelete"), e);
            toast({
                variant: "destructive",
                title: t("resourceErrorDelte"),
                description: formatAxiosError(e, t("v"))
            });
        }
    };

    async function toggleResourceEnabled(val: boolean, resourceId: number) {
        const res = await api
            .post<AxiosResponse<UpdateResourceResponse>>(
                `resource/${resourceId}`,
                {
                    enabled: val
                }
            )
            .catch((e) => {
                toast({
                    variant: "destructive",
                    title: t("resourcesErrorUpdate"),
                    description: formatAxiosError(
                        e,
                        t("resourcesErrorUpdateDescription")
                    )
                });
            });
    }

    function TargetStatusCell({ targets }: { targets?: TargetHealth[] }) {
        const overallStatus = getOverallHealthStatus(targets);

        if (!targets || targets.length === 0) {
            return (
                <div className="flex items-center gap-2">
                    <StatusIcon status="unknown" />
                    <span className="text-sm text-muted-foreground">No targets</span>
                </div>
            );
        }

        const monitoredTargets = targets.filter(t => t.enabled && t.healthStatus && t.healthStatus !== 'unknown');
        const unknownTargets = targets.filter(t => !t.enabled || !t.healthStatus || t.healthStatus === 'unknown');

        return (
            <DropdownMenu>
                <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="sm" className="flex items-center gap-2 h-8">
                        <StatusIcon status={overallStatus} />
                        <span className="text-sm">
                            {overallStatus === 'online' && 'Healthy'}
                            {overallStatus === 'degraded' && 'Degraded'}
                            {overallStatus === 'offline' && 'Offline'}
                            {overallStatus === 'unknown' && 'Unknown'}
                        </span>
                        <ChevronDown className="h-3 w-3" />
                    </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="min-w-[280px]">
                    {monitoredTargets.length > 0 && (
                        <>
                            {monitoredTargets.map((target) => (
                                <DropdownMenuItem key={target.targetId} className="flex items-center justify-between gap-4">
                                    <div className="flex items-center gap-2">
                                        <StatusIcon
                                            status={target.healthStatus === 'healthy' ? 'online' : 'offline'}
                                            className="h-3 w-3"
                                        />
                                        {`${target.ip}:${target.port}`}
                                    </div>
                                    <span className={`capitalize ${target.healthStatus === 'healthy' ? 'text-green-500' : 'text-destructive'
                                        }`}>
                                        {target.healthStatus}
                                    </span>
                                </DropdownMenuItem>
                            ))}
                        </>
                    )}
                    {unknownTargets.length > 0 && (
                        <>
                            {unknownTargets.map((target) => (
                                <DropdownMenuItem key={target.targetId} className="flex items-center justify-between gap-4">
                                    <div className="flex items-center gap-2">
                                        <StatusIcon status="unknown" className="h-3 w-3" />
                                        {`${target.ip}:${target.port}`}
                                    </div>
                                    <span className="text-muted-foreground">
                                        {!target.enabled ? 'Disabled' : 'Not monitored'}
                                    </span>
                                </DropdownMenuItem>
                            ))}
                        </>
                    )}
                </DropdownMenuContent>
            </DropdownMenu>
        );
    }

    
    const proxyColumns: ColumnDef<ResourceRow>[] = [
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
            accessorKey: "nice",
            header: ({ column }) => {
                return (
                    <Button
                        variant="ghost"
                        onClick={() =>
                            column.toggleSorting(column.getIsSorted() === "asc")
                        }
                    >
                        {t("resource")}
                        <ArrowUpDown className="ml-2 h-4 w-4" />
                    </Button>
                );
            }
        },
        {
            accessorKey: "protocol",
            header: t("protocol"),
            cell: ({ row }) => {
                const resourceRow = row.original;
                return <span>{resourceRow.http ? (resourceRow.ssl ? "HTTPS" : "HTTP") : resourceRow.protocol.toUpperCase()}</span>;
            }
        },
        {
            id: "status",
            accessorKey: "status",
            header: ({ column }) => {
                return (
                    <Button
                        variant="ghost"
                        onClick={() =>
                            column.toggleSorting(column.getIsSorted() === "asc")
                        }
                    >
                        {t("status")}
                        <ArrowUpDown className="ml-2 h-4 w-4" />
                    </Button>
                );
            },
            cell: ({ row }) => {
                const resourceRow = row.original;
                return <TargetStatusCell targets={resourceRow.targets} />;
            },
            sortingFn: (rowA, rowB) => {
                const statusA = getOverallHealthStatus(rowA.original.targets);
                const statusB = getOverallHealthStatus(rowB.original.targets);
                const statusOrder = { online: 3, degraded: 2, offline: 1, unknown: 0 };
                return statusOrder[statusA] - statusOrder[statusB];
            }
        },
        {
            accessorKey: "domain",
            header: t("access"),
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
            header: ({ column }) => {
                return (
                    <Button
                        variant="ghost"
                        onClick={() =>
                            column.toggleSorting(column.getIsSorted() === "asc")
                        }
                    >
                        {t("authentication")}
                        <ArrowUpDown className="ml-2 h-4 w-4" />
                    </Button>
                );
            },
            cell: ({ row }) => {
                const resourceRow = row.original;
                return (
                    <div>
                        {resourceRow.authState === "protected" ? (
                            <span className="text-green-500 flex items-center space-x-2">
                                <ShieldCheck className="w-4 h-4" />
                                <span>{t("protected")}</span>
                            </span>
                        ) : resourceRow.authState === "not_protected" ? (
                            <span className="text-yellow-500 flex items-center space-x-2">
                                <ShieldOff className="w-4 h-4" />
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
            header: t("enabled"),
            cell: ({ row }) => (
                <Switch
                    defaultChecked={
                        row.original.http
                            ? !!row.original.domainId && row.original.enabled
                            : row.original.enabled
                    }
                    disabled={
                        row.original.http ? !row.original.domainId : false
                    }
                    onCheckedChange={(val) =>
                        toggleResourceEnabled(val, row.original.id)
                    }
                />
            )
        },
        {
            id: "actions",
            cell: ({ row }) => {
                const resourceRow = row.original;
                return (
                    <div className="flex items-center justify-end">
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
                                    href={`/${resourceRow.orgId}/settings/resources/${resourceRow.nice}`}
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
                            href={`/${resourceRow.orgId}/settings/resources/${resourceRow.nice}`}
                        >
                            <Button
                                variant={"secondary"}
                                className="ml-2"
                                size="sm"
                            >
                                {t("edit")}
                                <ArrowRight className="ml-2 w-4 h-4" />
                            </Button>
                        </Link>
                    </div>
                );
            }
        }
    ];

    const internalColumns: ColumnDef<InternalResourceRow>[] = [
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
            accessorKey: "siteName",
            header: t("siteName"),
            cell: ({ row }) => {
                const resourceRow = row.original;
                return (
                    <Link
                        href={`/${resourceRow.orgId}/settings/sites/${resourceRow.siteNiceId}`}
                    >
                        <Button variant="outline" size="sm">
                            {resourceRow.siteName}
                            <ArrowUpRight className="ml-2 h-4 w-4" />
                        </Button>
                    </Link>
                );
            }
        },
        {
            accessorKey: "protocol",
            header: t("protocol"),
            cell: ({ row }) => {
                const resourceRow = row.original;
                return <span>{resourceRow.protocol.toUpperCase()}</span>;
            }
        },
        {
            accessorKey: "proxyPort",
            header: t("proxyPort"),
            cell: ({ row }) => {
                const resourceRow = row.original;
                return (
                    <CopyToClipboard
                        text={resourceRow.proxyPort?.toString() || ""}
                        isLink={false}
                    />
                );
            }
        },
        {
            accessorKey: "destination",
            header: t("resourcesTableDestination"),
            cell: ({ row }) => {
                const resourceRow = row.original;
                const destination = `${resourceRow.destinationIp}:${resourceRow.destinationPort}`;
                return <CopyToClipboard text={destination} isLink={false} />;
            }
        },

        {
            id: "actions",
            cell: ({ row }) => {
                const resourceRow = row.original;
                return (
                    <div className="flex items-center justify-end gap-2">
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
                                    onClick={() => {
                                        setSelectedInternalResource(
                                            resourceRow
                                        );
                                        setIsDeleteModalOpen(true);
                                    }}
                                >
                                    <span className="text-red-500">
                                        {t("delete")}
                                    </span>
                                </DropdownMenuItem>
                            </DropdownMenuContent>
                        </DropdownMenu>
                        <Button
                            variant={"secondary"}
                            size="sm"
                            onClick={() => {
                                setEditingResource(resourceRow);
                                setIsEditDialogOpen(true);
                            }}
                        >
                            {t("edit")}
                        </Button>
                    </div>
                );
            }
        }
    ];

    const proxyTable = useReactTable({
        data: resources,
        columns: proxyColumns,
        getCoreRowModel: getCoreRowModel(),
        getPaginationRowModel: getPaginationRowModel(),
        onSortingChange: setProxySorting,
        getSortedRowModel: getSortedRowModel(),
        onColumnFiltersChange: setProxyColumnFilters,
        getFilteredRowModel: getFilteredRowModel(),
        onGlobalFilterChange: setProxyGlobalFilter,
        onColumnVisibilityChange: setProxyColumnVisibility,
        initialState: {
            pagination: {
                pageSize: proxyPageSize,
                pageIndex: 0
            }
        },
        state: {
            sorting: proxySorting,
            columnFilters: proxyColumnFilters,
            globalFilter: proxyGlobalFilter,
            columnVisibility: proxyColumnVisibility
        }
    });

    const internalTable = useReactTable({
        data: internalResources,
        columns: internalColumns,
        getCoreRowModel: getCoreRowModel(),
        getPaginationRowModel: getPaginationRowModel(),
        onSortingChange: setInternalSorting,
        getSortedRowModel: getSortedRowModel(),
        onColumnFiltersChange: setInternalColumnFilters,
        getFilteredRowModel: getFilteredRowModel(),
        onGlobalFilterChange: setInternalGlobalFilter,
        onColumnVisibilityChange: setInternalColumnVisibility,
        initialState: {
            pagination: {
                pageSize: internalPageSize,
                pageIndex: 0
            }
        },
        state: {
            sorting: internalSorting,
            columnFilters: internalColumnFilters,
            globalFilter: internalGlobalFilter,
            columnVisibility: internalColumnVisibility
        }
    });

    const handleProxyPageSizeChange = (newPageSize: number) => {
        setProxyPageSize(newPageSize);
        setStoredPageSize(newPageSize, 'proxy-resources');
    };

    const handleInternalPageSizeChange = (newPageSize: number) => {
        setInternalPageSize(newPageSize);
        setStoredPageSize(newPageSize, 'internal-resources');
    };

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
                        <div>
                            <p>
                                {t("resourceQuestionRemove")}
                            </p>
                            <p>
                                {t("resourceMessageRemove")}
                            </p>
                        </div>
                    }
                    buttonText={t("resourceDeleteConfirm")}
                    onConfirm={async () => deleteResource(selectedResource!.id)}
                    string={selectedResource.name}
                    title={t("resourceDelete")}
                />
            )}

            {selectedInternalResource && (
                <ConfirmDeleteDialog
                    open={isDeleteModalOpen}
                    setOpen={(val) => {
                        setIsDeleteModalOpen(val);
                        setSelectedInternalResource(null);
                    }}
                    dialog={
                        <div>
                            <p>
                                {t("resourceQuestionRemove")}
                            </p>
                            <p>
                                {t("resourceMessageRemove")}
                            </p>
                        </div>
                    }
                    buttonText={t("resourceDeleteConfirm")}
                    onConfirm={async () =>
                        deleteInternalResource(
                            selectedInternalResource!.id,
                            selectedInternalResource!.siteId
                        )
                    }
                    string={selectedInternalResource.name}
                    title={t("resourceDelete")}
                />
            )}

            <div className="container mx-auto max-w-12xl">
                <Card>
                    <Tabs
                        defaultValue={defaultView}
                        className="w-full"
                        onValueChange={handleTabChange}
                    >
                        <CardHeader className="flex flex-col space-y-4 sm:flex-row sm:items-center sm:justify-between sm:space-y-0 pb-0">
                            <div className="flex flex-row space-y-3 w-full sm:mr-2 gap-2">
                                {getSearchInput()}

                                {env.flags.enableClients && (
                                    <TabsList className="grid grid-cols-2">
                                        <TabsTrigger value="proxy">
                                            {t("resourcesTableProxyResources")}
                                        </TabsTrigger>
                                        <TabsTrigger value="internal">
                                            {t("resourcesTableClientResources")}
                                        </TabsTrigger>
                                    </TabsList>
                                )}
                            </div>
                            <div className="flex items-center gap-2 sm:justify-end">
                                <div>
                                    <Button
                                        variant="outline"
                                        onClick={refreshData}
                                        disabled={isRefreshing}
                                    >
                                        <RefreshCw
                                            className={`mr-2 h-4 w-4 ${isRefreshing ? "animate-spin" : ""}`}
                                        />
                                        {t("refresh")}
                                    </Button>
                                </div>
                                <div>
                                    {getActionButton()}
                                </div>
                            </div>
                        </CardHeader>
                        <CardContent>
                            <TabsContent value="proxy">
                                <Table>
                                    <TableHeader>
                                        {proxyTable
                                            .getHeaderGroups()
                                            .map((headerGroup) => (
                                                <TableRow key={headerGroup.id}>
                                                    {headerGroup.headers.map(
                                                        (header) => (
                                                            <TableHead
                                                                key={header.id}
                                                            >
                                                                {header.isPlaceholder
                                                                    ? null
                                                                    : flexRender(
                                                                        header
                                                                            .column
                                                                            .columnDef
                                                                            .header,
                                                                        header.getContext()
                                                                    )}
                                                            </TableHead>
                                                        )
                                                    )}
                                                </TableRow>
                                            ))}
                                    </TableHeader>
                                    <TableBody>
                                        {proxyTable.getRowModel().rows
                                            ?.length ? (
                                            proxyTable
                                                .getRowModel()
                                                .rows.map((row) => (
                                                    <TableRow
                                                        key={row.id}
                                                        data-state={
                                                            row.getIsSelected() &&
                                                            "selected"
                                                        }
                                                    >
                                                        {row
                                                            .getVisibleCells()
                                                            .map((cell) => (
                                                                <TableCell
                                                                    key={
                                                                        cell.id
                                                                    }
                                                                >
                                                                    {flexRender(
                                                                        cell
                                                                            .column
                                                                            .columnDef
                                                                            .cell,
                                                                        cell.getContext()
                                                                    )}
                                                                </TableCell>
                                                            ))}
                                                    </TableRow>
                                                ))
                                        ) : (
                                            <TableRow>
                                                <TableCell
                                                    colSpan={
                                                        proxyColumns.length
                                                    }
                                                    className="h-24 text-center"
                                                >
                                                    {t(
                                                        "resourcesTableNoProxyResourcesFound"
                                                    )}
                                                </TableCell>
                                            </TableRow>
                                        )}
                                    </TableBody>
                                </Table>
                                <div className="mt-4">
                                    <DataTablePagination
                                        table={proxyTable}
                                        onPageSizeChange={handleProxyPageSizeChange}
                                    />
                                </div>
                            </TabsContent>
                            <TabsContent value="internal">
                                <div className="mb-4">
                                    <Alert variant="neutral">
                                        <AlertDescription>
                                            {t(
                                                "resourcesTableTheseResourcesForUseWith"
                                            )}{" "}
                                            <Link
                                                href={`/${orgId}/settings/clients`}
                                                className="font-medium underline hover:opacity-80 inline-flex items-center"
                                            >
                                                {t("resourcesTableClients")}
                                                <ArrowUpRight className="ml-1 h-3 w-3" />
                                            </Link>{" "}
                                            {t(
                                                "resourcesTableAndOnlyAccessibleInternally"
                                            )}
                                        </AlertDescription>
                                    </Alert>
                                </div>
                                <Table>
                                    <TableHeader>
                                        {internalTable
                                            .getHeaderGroups()
                                            .map((headerGroup) => (
                                                <TableRow key={headerGroup.id}>
                                                    {headerGroup.headers.map(
                                                        (header) => (
                                                            <TableHead
                                                                key={header.id}
                                                            >
                                                                {header.isPlaceholder
                                                                    ? null
                                                                    : flexRender(
                                                                        header
                                                                            .column
                                                                            .columnDef
                                                                            .header,
                                                                        header.getContext()
                                                                    )}
                                                            </TableHead>
                                                        )
                                                    )}
                                                </TableRow>
                                            ))}
                                    </TableHeader>
                                    <TableBody>
                                        {internalTable.getRowModel().rows
                                            ?.length ? (
                                            internalTable
                                                .getRowModel()
                                                .rows.map((row) => (
                                                    <TableRow
                                                        key={row.id}
                                                        data-state={
                                                            row.getIsSelected() &&
                                                            "selected"
                                                        }
                                                    >
                                                        {row
                                                            .getVisibleCells()
                                                            .map((cell) => (
                                                                <TableCell
                                                                    key={
                                                                        cell.id
                                                                    }
                                                                >
                                                                    {flexRender(
                                                                        cell
                                                                            .column
                                                                            .columnDef
                                                                            .cell,
                                                                        cell.getContext()
                                                                    )}
                                                                </TableCell>
                                                            ))}
                                                    </TableRow>
                                                ))
                                        ) : (
                                            <TableRow>
                                                <TableCell
                                                    colSpan={
                                                        internalColumns.length
                                                    }
                                                    className="h-24 text-center"
                                                >
                                                    {t(
                                                        "resourcesTableNoInternalResourcesFound"
                                                    )}
                                                </TableCell>
                                            </TableRow>
                                        )}
                                    </TableBody>
                                </Table>
                                <div className="mt-4">
                                    <DataTablePagination
                                        table={internalTable}
                                        onPageSizeChange={handleInternalPageSizeChange}
                                    />
                                </div>
                            </TabsContent>
                        </CardContent>
                    </Tabs>
                </Card>
            </div>

            {editingResource && (
                <EditInternalResourceDialog
                    open={isEditDialogOpen}
                    setOpen={setIsEditDialogOpen}
                    resource={editingResource}
                    orgId={orgId}
                    onSuccess={() => {
                        router.refresh();
                        setEditingResource(null);
                    }}
                />
            )}

            <CreateInternalResourceDialog
                open={isCreateDialogOpen}
                setOpen={setIsCreateDialogOpen}
                orgId={orgId}
                sites={sites}
                onSuccess={() => {
                    router.refresh();
                }}
            />
        </>
    );
}
