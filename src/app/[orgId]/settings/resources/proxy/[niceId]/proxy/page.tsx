"use client";

import HealthCheckDialog from "@/components/HealthCheckDialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { HeadersInput } from "@app/components/HeadersInput";
import {
    PathMatchDisplay,
    PathMatchModal,
    PathRewriteDisplay,
    PathRewriteModal
} from "@app/components/PathMatchRenameModal";
import { ResourceTargetAddressItem } from "@app/components/resource-target-address-item";
import {
    SettingsContainer,
    SettingsSection,
    SettingsSectionBody,
    SettingsSectionDescription,
    SettingsSectionForm,
    SettingsSectionHeader,
    SettingsSectionTitle
} from "@app/components/Settings";
import { SwitchInput } from "@app/components/SwitchInput";
import { Alert, AlertDescription } from "@app/components/ui/alert";
import {
    Form,
    FormControl,
    FormDescription,
    FormField,
    FormItem,
    FormLabel,
    FormMessage
} from "@app/components/ui/form";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow
} from "@app/components/ui/table";
import {
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger
} from "@app/components/ui/tooltip";
import type { ResourceContextType } from "@app/contexts/resourceContext";
import { useEnvContext } from "@app/hooks/useEnvContext";
import { useResourceContext } from "@app/hooks/useResourceContext";
import { toast } from "@app/hooks/useToast";
import { createApiClient } from "@app/lib/api";
import { formatAxiosError } from "@app/lib/api/formatAxiosError";
import { DockerManager, DockerState } from "@app/lib/docker";
import { orgQueries, resourceQueries } from "@app/lib/queries";
import { zodResolver } from "@hookform/resolvers/zod";
import { tlsNameSchema } from "@server/lib/schemas";
import { type GetResourceResponse } from "@server/routers/resource";
import type { ListSitesResponse } from "@server/routers/site";
import { CreateTargetResponse } from "@server/routers/target";
import { ListTargetsResponse } from "@server/routers/target/listTargets";
import { ArrayElement } from "@server/types/ArrayElement";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
    ColumnDef,
    flexRender,
    getCoreRowModel,
    getFilteredRowModel,
    getPaginationRowModel,
    getSortedRowModel,
    useReactTable
} from "@tanstack/react-table";
import { AxiosResponse } from "axios";
import {
    AlertTriangle,
    CircleCheck,
    CircleX,
    Info,
    Plus,
    Settings
} from "lucide-react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import {
    use,
    useActionState,
    useCallback,
    useEffect,
    useMemo,
    useState
} from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";

const targetsSettingsSchema = z.object({
    stickySession: z.boolean()
});

type LocalTarget = Omit<
    ArrayElement<ListTargetsResponse["targets"]> & {
        new?: boolean;
        updated?: boolean;
        siteType: string | null;
    },
    "protocol"
>;

export default function ReverseProxyTargetsPage(props: {
    params: Promise<{ resourceId: number; orgId: string }>;
}) {
    const params = use(props.params);
    const { resource, updateResource } = useResourceContext();

    const { data: remoteTargets = [], isLoading: isLoadingTargets } = useQuery(
        resourceQueries.resourceTargets({
            resourceId: resource.resourceId
        })
    );

    if (isLoadingTargets) {
        return null;
    }

    return (
        <SettingsContainer>
            <ProxyResourceTargetsForm
                orgId={params.orgId}
                initialTargets={remoteTargets}
                resource={resource}
            />

            {resource.http && (
                <ProxyResourceHttpForm
                    resource={resource}
                    updateResource={updateResource}
                />
            )}

            {!resource.http && resource.protocol == "tcp" && (
                <ProxyResourceProtocolForm
                    resource={resource}
                    updateResource={updateResource}
                />
            )}
        </SettingsContainer>
    );
}

function ProxyResourceTargetsForm({
    orgId,
    initialTargets,
    resource
}: {
    initialTargets: LocalTarget[];
    orgId: string;
    resource: GetResourceResponse;
}) {
    const t = useTranslations();
    const api = createApiClient(useEnvContext());

    const [targets, setTargets] = useState<LocalTarget[]>(initialTargets);
    const [targetsToRemove, setTargetsToRemove] = useState<number[]>([]);
    const [dockerStates, setDockerStates] = useState<Map<number, DockerState>>(
        new Map()
    );
    const [healthCheckDialogOpen, setHealthCheckDialogOpen] = useState(false);
    const [selectedTargetForHealthCheck, setSelectedTargetForHealthCheck] =
        useState<LocalTarget | null>(null);

    const initializeDockerForSite = async (siteId: number) => {
        if (dockerStates.has(siteId)) {
            return; // Already initialized
        }

        const dockerManager = new DockerManager(api, siteId);
        const dockerState = await dockerManager.initializeDocker();

        setDockerStates((prev) => new Map(prev.set(siteId, dockerState)));
    };

    const refreshContainersForSite = useCallback(
        async (siteId: number) => {
            const dockerManager = new DockerManager(api, siteId);
            const containers = await dockerManager.fetchContainers();

            setDockerStates((prev) => {
                const newMap = new Map(prev);
                const existingState = newMap.get(siteId);
                if (existingState) {
                    newMap.set(siteId, { ...existingState, containers });
                }
                return newMap;
            });
        },
        [api]
    );

    const getDockerStateForSite = useCallback(
        (siteId: number): DockerState => {
            return (
                dockerStates.get(siteId) || {
                    isEnabled: false,
                    isAvailable: false,
                    containers: []
                }
            );
        },
        [dockerStates]
    );

    const [isAdvancedMode, setIsAdvancedMode] = useState(() => {
        if (typeof window !== "undefined") {
            const saved = localStorage.getItem("proxy-advanced-mode");
            return saved === "true";
        }
        return false;
    });

    const isHttp = resource.http;

    const removeTarget = useCallback((targetId: number) => {
        setTargets((prevTargets) => {
            const targetToRemove = prevTargets.find(
                (target) => target.targetId === targetId
            );
            if (targetToRemove && !targetToRemove.new) {
                setTargetsToRemove((prev) => [...prev, targetId]);
            }
            return prevTargets.filter((target) => target.targetId !== targetId);
        });
    }, []);

    const { data: sites = [] } = useQuery(
        orgQueries.sites({
            orgId
        })
    );

    const updateTarget = useCallback(
        (targetId: number, data: Partial<LocalTarget>) => {
            setTargets((prevTargets) => {
                return prevTargets.map((target) =>
                    target.targetId === targetId
                        ? {
                              ...target,
                              ...data,
                              updated: true
                          }
                        : target
                );
            });
        },
        [sites]
    );

    const openHealthCheckDialog = useCallback((target: LocalTarget) => {
        setSelectedTargetForHealthCheck(target);
        setHealthCheckDialogOpen(true);
    }, []);

    const columns = useMemo((): ColumnDef<LocalTarget>[] => {
        const priorityColumn: ColumnDef<LocalTarget> = {
            id: "priority",
            header: () => (
                <div className="flex items-center gap-2">
                    {t("priority")}
                    <TooltipProvider>
                        <Tooltip>
                            <TooltipTrigger>
                                <Info className="h-4 w-4 text-muted-foreground" />
                            </TooltipTrigger>
                            <TooltipContent className="max-w-xs">
                                <p>{t("priorityDescription")}</p>
                            </TooltipContent>
                        </Tooltip>
                    </TooltipProvider>
                </div>
            ),
            cell: ({ row }) => {
                return (
                    <div className="flex items-center justify-center w-full">
                        <Input
                            type="number"
                            min="1"
                            max="1000"
                            onClick={(e) => e.currentTarget.focus()}
                            defaultValue={row.original.priority || 100}
                            className="w-full max-w-20"
                            onBlur={(e) => {
                                const value = parseInt(e.target.value, 10);
                                if (value >= 1 && value <= 1000) {
                                    updateTarget(row.original.targetId, {
                                        ...row.original,
                                        priority: value
                                    });
                                }
                            }}
                        />
                    </div>
                );
            },
            size: 120,
            minSize: 100,
            maxSize: 150
        };

        const healthCheckColumn: ColumnDef<LocalTarget> = {
            accessorKey: "healthCheck",
            header: () => <span className="p-3">{t("healthCheck")}</span>,
            cell: ({ row }) => {
                const status = row.original.hcHealth || "unknown";
                const isEnabled = row.original.hcEnabled;

                const getStatusColor = (status: string) => {
                    switch (status) {
                        case "healthy":
                            return "green";
                        case "unhealthy":
                            return "red";
                        case "unknown":
                        default:
                            return "secondary";
                    }
                };

                const getStatusText = (status: string) => {
                    switch (status) {
                        case "healthy":
                            return t("healthCheckHealthy");
                        case "unhealthy":
                            return t("healthCheckUnhealthy");
                        case "unknown":
                        default:
                            return t("healthCheckUnknown");
                    }
                };

                const getStatusIcon = (status: string) => {
                    switch (status) {
                        case "healthy":
                            return <CircleCheck className="w-3 h-3" />;
                        case "unhealthy":
                            return <CircleX className="w-3 h-3" />;
                        case "unknown":
                        default:
                            return null;
                    }
                };

                return (
                    <div className="flex items-center justify-center w-full">
                        {row.original.siteType === "newt" ? (
                            <Button
                                variant="outline"
                                className="flex items-center gap-2 w-full text-left cursor-pointer"
                                onClick={() =>
                                    openHealthCheckDialog(row.original)
                                }
                            >
                                <div
                                    className={`flex items-center gap-2 ${status === "healthy" ? "text-green-500" : status === "unhealthy" ? "text-destructive" : ""}`}
                                >
                                    <Settings className="h-4 w-4 text-foreground" />
                                    {getStatusText(status)}
                                </div>
                            </Button>
                        ) : (
                            <span>-</span>
                        )}
                    </div>
                );
            },
            size: 200,
            minSize: 180,
            maxSize: 250
        };

        const matchPathColumn: ColumnDef<LocalTarget> = {
            accessorKey: "path",
            header: () => <span className="p-3">{t("matchPath")}</span>,
            cell: ({ row }) => {
                const hasPathMatch = !!(
                    row.original.path || row.original.pathMatchType
                );

                return (
                    <div className="flex items-center justify-center w-full">
                        {hasPathMatch ? (
                            <PathMatchModal
                                value={{
                                    path: row.original.path,
                                    pathMatchType: row.original.pathMatchType
                                }}
                                onChange={(config) =>
                                    updateTarget(row.original.targetId,
                                        config.path === null && config.pathMatchType === null
                                            ? { ...config, rewritePath: null, rewritePathType: null }
                                            : config
                                    )
                                }
                                trigger={
                                    <Button
                                        variant="outline"
                                        className="flex items-center gap-2 p-2 w-full text-left cursor-pointer max-w-[200px]"
                                    >
                                        <PathMatchDisplay
                                            value={{
                                                path: row.original.path,
                                                pathMatchType:
                                                    row.original.pathMatchType
                                            }}
                                        />
                                    </Button>
                                }
                            />
                        ) : (
                            <PathMatchModal
                                value={{
                                    path: row.original.path,
                                    pathMatchType: row.original.pathMatchType
                                }}
                                onChange={(config) =>
                                    updateTarget(row.original.targetId,
                                        config.path === null && config.pathMatchType === null
                                            ? { ...config, rewritePath: null, rewritePathType: null }
                                            : config
                                    )
                                }
                                trigger={
                                    <Button
                                        variant="outline"
                                        className="w-full max-w-[200px]"
                                    >
                                        <Plus className="h-4 w-4 mr-2" />
                                        {t("matchPath")}
                                    </Button>
                                }
                            />
                        )}
                    </div>
                );
            },
            size: 200,
            minSize: 180,
            maxSize: 200
        };

        const addressColumn: ColumnDef<LocalTarget> = {
            accessorKey: "address",
            header: () => <span className="p-3">{t("address")}</span>,
            cell: ({ row }) => {
                return (
                    <ResourceTargetAddressItem
                        isHttp={isHttp}
                        orgId={orgId}
                        getDockerStateForSite={getDockerStateForSite}
                        proxyTarget={row.original}
                        refreshContainersForSite={refreshContainersForSite}
                        updateTarget={updateTarget}
                    />
                );
            },
            size: 400,
            minSize: 350,
            maxSize: 500
        };

        const rewritePathColumn: ColumnDef<LocalTarget> = {
            accessorKey: "rewritePath",
            header: () => <span className="p-3">{t("rewritePath")}</span>,
            cell: ({ row }) => {
                const hasRewritePath = !!(
                    row.original.rewritePath || row.original.rewritePathType
                );
                const noPathMatch =
                    !row.original.path && !row.original.pathMatchType;

                return (
                    <div className="flex items-center justify-center w-full">
                        {hasRewritePath && !noPathMatch ? (
                            <PathRewriteModal
                                value={{
                                    rewritePath: row.original.rewritePath,
                                    rewritePathType:
                                        row.original.rewritePathType
                                }}
                                onChange={(config) =>
                                    updateTarget(row.original.targetId, config)
                                }
                                trigger={
                                    <Button
                                        variant="outline"
                                        className="flex items-center gap-2 p-2 w-full text-left cursor-pointer max-w-[200px]"
                                        disabled={noPathMatch}
                                    >
                                        <PathRewriteDisplay
                                            value={{
                                                rewritePath:
                                                    row.original.rewritePath,
                                                rewritePathType:
                                                    row.original.rewritePathType
                                            }}
                                        />
                                    </Button>
                                }
                            />
                        ) : (
                            <PathRewriteModal
                                value={{
                                    rewritePath: row.original.rewritePath,
                                    rewritePathType:
                                        row.original.rewritePathType
                                }}
                                onChange={(config) =>
                                    updateTarget(row.original.targetId, config)
                                }
                                trigger={
                                    <Button
                                        variant="outline"
                                        disabled={noPathMatch}
                                        className="w-full max-w-[200px]"
                                    >
                                        <Plus className="h-4 w-4 mr-2" />
                                        {t("rewritePath")}
                                    </Button>
                                }
                                disabled={noPathMatch}
                            />
                        )}
                    </div>
                );
            },
            size: 200,
            minSize: 180,
            maxSize: 200
        };

        const enabledColumn: ColumnDef<LocalTarget> = {
            accessorKey: "enabled",
            header: () => <span className="p-3">{t("enabled")}</span>,
            cell: ({ row }) => (
                <div className="flex items-center justify-center w-full">
                    <Switch
                        defaultChecked={row.original.enabled}
                        onCheckedChange={(val) =>
                            updateTarget(row.original.targetId, {
                                ...row.original,
                                enabled: val
                            })
                        }
                    />
                </div>
            ),
            size: 100,
            minSize: 80,
            maxSize: 120
        };

        const actionsColumn: ColumnDef<LocalTarget> = {
            id: "actions",
            header: () => <span className="p-3">{t("actions")}</span>,
            cell: ({ row }) => (
                <div className="flex items-center w-full">
                    <Button
                        variant="outline"
                        onClick={() => removeTarget(row.original.targetId)}
                    >
                        {t("delete")}
                    </Button>
                </div>
            ),
            size: 100,
            minSize: 80,
            maxSize: 120
        };

        if (isAdvancedMode) {
            const columns = [
                addressColumn,
                healthCheckColumn,
                enabledColumn,
                actionsColumn
            ];

            // Only include path-related columns for HTTP resources
            if (isHttp) {
                columns.unshift(matchPathColumn);
                columns.splice(3, 0, rewritePathColumn, priorityColumn);
            }

            return columns;
        } else {
            return [
                addressColumn,
                healthCheckColumn,
                enabledColumn,
                actionsColumn
            ];
        }
    }, [
        isAdvancedMode,
        isHttp,
        sites,
        updateTarget,
        getDockerStateForSite,
        refreshContainersForSite,
        openHealthCheckDialog,
        removeTarget,
        t
    ]);

    function addNewTarget() {
        const isHttp = resource.http;

        const newTarget: LocalTarget = {
            targetId: -Date.now(), // Use negative timestamp as temporary ID
            ip: "",
            method: isHttp ? "http" : null,
            port: 0,
            siteId: sites.length > 0 ? sites[0].siteId : 0,
            siteName: sites.length > 0 ? sites[0].name : "",
            path: isHttp ? null : null,
            pathMatchType: isHttp ? null : null,
            rewritePath: isHttp ? null : null,
            rewritePathType: isHttp ? null : null,
            priority: isHttp ? 100 : 100,
            enabled: true,
            resourceId: resource.resourceId,
            hcEnabled: false,
            hcPath: null,
            hcMethod: null,
            hcInterval: null,
            hcTimeout: null,
            hcHeaders: null,
            hcScheme: null,
            hcHostname: null,
            hcPort: null,
            hcFollowRedirects: null,
            hcHealth: "unknown",
            hcStatus: null,
            hcMode: null,
            hcUnhealthyInterval: null,
            hcTlsServerName: null,
            siteType: sites.length > 0 ? sites[0].type : null,
            new: true,
            updated: false
        };

        setTargets((prev) => [...prev, newTarget]);
    }

    function updateTargetHealthCheck(targetId: number, config: any) {
        setTargets(
            targets.map((target) =>
                target.targetId === targetId
                    ? {
                          ...target,
                          ...config,
                          updated: true
                      }
                    : target
            )
        );
    }

    const table = useReactTable({
        data: targets,
        columns,
        getCoreRowModel: getCoreRowModel(),
        getPaginationRowModel: getPaginationRowModel(),
        getSortedRowModel: getSortedRowModel(),
        getFilteredRowModel: getFilteredRowModel(),
        getRowId: (row) => String(row.targetId),
        state: {
            pagination: {
                pageIndex: 0,
                pageSize: 1000
            }
        }
    });

    const router = useRouter();

    const queryClient = useQueryClient();

    useEffect(() => {
        const newtSites = sites.filter((site) => site.type === "newt");
        for (const site of newtSites) {
            initializeDockerForSite(site.siteId);
        }
    }, [sites]);

    // Save advanced mode preference to localStorage
    useEffect(() => {
        if (typeof window !== "undefined") {
            localStorage.setItem(
                "proxy-advanced-mode",
                isAdvancedMode.toString()
            );
        }
    }, [isAdvancedMode]);

    const [, formAction, isSubmitting] = useActionState(saveTargets, null);

    async function saveTargets() {
        // Validate that no targets have blank IPs or invalid ports
        const targetsWithInvalidFields = targets.filter(
            (target) =>
                !target.ip ||
                target.ip.trim() === "" ||
                !target.port ||
                target.port <= 0 ||
                isNaN(target.port)
        );
        console.log(targetsWithInvalidFields);
        if (targetsWithInvalidFields.length > 0) {
            toast({
                variant: "destructive",
                title: t("targetErrorInvalidIp"),
                description: t("targetErrorInvalidIpDescription")
            });
            return;
        }

        try {
            await Promise.all(
                targetsToRemove.map((targetId) =>
                    api.delete(`/target/${targetId}`)
                )
            );

            // Save targets
            for (const target of targets) {
                const data: any = {
                    ip: target.ip,
                    port: target.port,
                    method: target.method,
                    enabled: target.enabled,
                    siteId: target.siteId,
                    hcEnabled: target.hcEnabled,
                    hcPath: target.hcPath || null,
                    hcScheme: target.hcScheme || null,
                    hcHostname: target.hcHostname || null,
                    hcPort: target.hcPort || null,
                    hcInterval: target.hcInterval || null,
                    hcTimeout: target.hcTimeout || null,
                    hcHeaders: target.hcHeaders || null,
                    hcFollowRedirects: target.hcFollowRedirects || null,
                    hcMethod: target.hcMethod || null,
                    hcStatus: target.hcStatus || null,
                    hcUnhealthyInterval: target.hcUnhealthyInterval || null,
                    hcMode: target.hcMode || null,
                    hcTlsServerName: target.hcTlsServerName
                };

                // Only include path-related fields for HTTP resources
                if (resource.http) {
                    data.path = target.path;
                    data.pathMatchType = target.pathMatchType;
                    data.rewritePath = target.rewritePath;
                    data.rewritePathType = target.rewritePathType;
                    data.priority = target.priority;
                }

                if (target.new) {
                    const res = await api.put<
                        AxiosResponse<CreateTargetResponse>
                    >(`/resource/${resource.resourceId}/target`, data);
                    target.targetId = res.data.data.targetId;
                    target.new = false;
                } else if (target.updated) {
                    await api.post(`/target/${target.targetId}`, data);
                    target.updated = false;
                }
            }

            toast({
                title: targets.length === 0
                    ? t("targetTargetsCleared")
                    : t("settingsUpdated"),
                description: targets.length === 0
                    ? t("targetTargetsClearedDescription")
                    : t("settingsUpdatedDescription")
            });

            setTargetsToRemove([]);
            router.refresh();
            await queryClient.invalidateQueries(
                resourceQueries.resourceTargets({
                    resourceId: resource.resourceId
                })
            );
        } catch (err) {
            console.error(err);
            toast({
                variant: "destructive",
                title: t("settingsErrorUpdate"),
                description: formatAxiosError(
                    err,
                    t("settingsErrorUpdateDescription")
                )
            });
        }
    }

    return (
        <>
            <SettingsSection>
                <SettingsSectionHeader>
                    <SettingsSectionTitle>{t("targets")}</SettingsSectionTitle>
                    <SettingsSectionDescription>
                        {t("targetsDescription")}
                    </SettingsSectionDescription>
                </SettingsSectionHeader>
                <SettingsSectionBody>
                    {targets.length > 0 ? (
                        <>
                            <div className="overflow-x-auto">
                                <Table>
                                    <TableHeader>
                                        {table
                                            .getHeaderGroups()
                                            .map((headerGroup) => (
                                                <TableRow key={headerGroup.id}>
                                                    {headerGroup.headers.map(
                                                        (header) => {
                                                            const isActionsColumn =
                                                                header.column
                                                                    .id ===
                                                                "actions";
                                                            return (
                                                                <TableHead
                                                                    key={
                                                                        header.id
                                                                    }
                                                                    className={
                                                                        isActionsColumn
                                                                            ? "sticky right-0 z-10 w-auto min-w-fit bg-card"
                                                                            : ""
                                                                    }
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
                                                            );
                                                        }
                                                    )}
                                                </TableRow>
                                            ))}
                                    </TableHeader>
                                    <TableBody>
                                        {table.getRowModel().rows?.length ? (
                                            table
                                                .getRowModel()
                                                .rows.map((row) => (
                                                    <TableRow key={row.id}>
                                                        {row
                                                            .getVisibleCells()
                                                            .map((cell) => {
                                                                const isActionsColumn =
                                                                    cell.column
                                                                        .id ===
                                                                    "actions";
                                                                return (
                                                                    <TableCell
                                                                        key={
                                                                            cell.id
                                                                        }
                                                                        className={
                                                                            isActionsColumn
                                                                                ? "sticky right-0 z-10 w-auto min-w-fit bg-card"
                                                                                : ""
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
                                                                );
                                                            })}
                                                    </TableRow>
                                                ))
                                        ) : (
                                            <TableRow>
                                                <TableCell
                                                    colSpan={columns.length}
                                                    className="h-24 text-center"
                                                >
                                                    {t("targetNoOne")}
                                                </TableCell>
                                            </TableRow>
                                        )}
                                    </TableBody>
                                    {/* <TableCaption> */}
                                    {/*     {t('targetNoOneDescription')} */}
                                    {/* </TableCaption> */}
                                </Table>
                            </div>
                            <div className="flex items-center justify-between mb-4">
                                <div className="flex items-center justify-between w-full gap-2">
                                    <Button
                                        onClick={addNewTarget}
                                        variant="outline"
                                    >
                                        <Plus className="h-4 w-4 mr-2" />
                                        {t("addTarget")}
                                    </Button>
                                    <div className="flex items-center gap-2">
                                        <Switch
                                            id="advanced-mode-toggle"
                                            checked={isAdvancedMode}
                                            onCheckedChange={setIsAdvancedMode}
                                        />
                                        <label
                                            htmlFor="advanced-mode-toggle"
                                            className="text-sm"
                                        >
                                            {t("advancedMode")}
                                        </label>
                                    </div>
                                </div>
                            </div>
                        </>
                    ) : (
                        <div className="text-center py-8 border-2 border-dashed border-muted rounded-lg p-4">
                            <p className="text-muted-foreground mb-4">
                                {t("targetNoOne")}
                            </p>
                            <Button onClick={addNewTarget} variant="outline">
                                <Plus className="h-4 w-4 mr-2" />
                                {t("addTarget")}
                            </Button>
                        </div>
                    )}
                </SettingsSectionBody>

                <form className="self-end mt-4" action={formAction}>
                    <Button
                        disabled={isSubmitting}
                        loading={isSubmitting}
                        type="submit"
                    >
                        {t("saveResourceTargets")}
                    </Button>
                </form>
            </SettingsSection>

            {selectedTargetForHealthCheck && (
                <HealthCheckDialog
                    open={healthCheckDialogOpen}
                    setOpen={setHealthCheckDialogOpen}
                    targetId={selectedTargetForHealthCheck.targetId}
                    targetAddress={`${selectedTargetForHealthCheck.ip}:${selectedTargetForHealthCheck.port}`}
                    targetMethod={
                        selectedTargetForHealthCheck.method || undefined
                    }
                    initialConfig={{
                        hcEnabled:
                            selectedTargetForHealthCheck.hcEnabled || false,
                        hcPath: selectedTargetForHealthCheck.hcPath || "/",
                        hcMethod:
                            selectedTargetForHealthCheck.hcMethod || "GET",
                        hcInterval:
                            selectedTargetForHealthCheck.hcInterval || 5,
                        hcTimeout: selectedTargetForHealthCheck.hcTimeout || 5,
                        hcHeaders:
                            selectedTargetForHealthCheck.hcHeaders || undefined,
                        hcScheme:
                            selectedTargetForHealthCheck.hcScheme || undefined,
                        hcHostname:
                            selectedTargetForHealthCheck.hcHostname ||
                            selectedTargetForHealthCheck.ip,
                        hcPort:
                            selectedTargetForHealthCheck.hcPort ||
                            selectedTargetForHealthCheck.port,
                        hcFollowRedirects:
                            selectedTargetForHealthCheck.hcFollowRedirects ||
                            true,
                        hcStatus:
                            selectedTargetForHealthCheck.hcStatus || undefined,
                        hcMode: selectedTargetForHealthCheck.hcMode || "http",
                        hcUnhealthyInterval:
                            selectedTargetForHealthCheck.hcUnhealthyInterval ||
                            30,
                        hcTlsServerName:
                            selectedTargetForHealthCheck.hcTlsServerName ||
                            undefined
                    }}
                    onChanges={async (config) => {
                        if (selectedTargetForHealthCheck) {
                            updateTargetHealthCheck(
                                selectedTargetForHealthCheck.targetId,
                                config
                            );
                        }
                    }}
                />
            )}
        </>
    );
}

function ProxyResourceHttpForm({
    resource,
    updateResource
}: Pick<ResourceContextType, "resource" | "updateResource">) {
    const t = useTranslations();

    const tlsSettingsSchema = z.object({
        ssl: z.boolean(),
        tlsServerName: z
            .string()
            .optional()
            .refine(
                (data) => {
                    if (data) {
                        return tlsNameSchema.safeParse(data).success;
                    }
                    return true;
                },
                {
                    message: t("proxyErrorTls")
                }
            )
    });

    const tlsSettingsForm = useForm({
        resolver: zodResolver(tlsSettingsSchema),
        defaultValues: {
            ssl: resource.ssl,
            tlsServerName: resource.tlsServerName || ""
        }
    });

    const proxySettingsSchema = z.object({
        setHostHeader: z
            .string()
            .optional()
            .refine(
                (data) => {
                    if (data) {
                        return tlsNameSchema.safeParse(data).success;
                    }
                    return true;
                },
                {
                    message: t("proxyErrorInvalidHeader")
                }
            ),
        headers: z
            .array(z.object({ name: z.string(), value: z.string() }))
            .nullable(),
        proxyProtocol: z.boolean().optional(),
        proxyProtocolVersion: z.int().min(1).max(2).optional()
    });

    const proxySettingsForm = useForm({
        resolver: zodResolver(proxySettingsSchema),
        defaultValues: {
            setHostHeader: resource.setHostHeader || "",
            headers: resource.headers,
            proxyProtocol: resource.proxyProtocol || false,
            proxyProtocolVersion: resource.proxyProtocolVersion || 1
        }
    });

    const { env } = useEnvContext();
    const api = createApiClient({ env });

    const targetsSettingsForm = useForm({
        resolver: zodResolver(targetsSettingsSchema),
        defaultValues: {
            stickySession: resource.stickySession
        }
    });

    const router = useRouter();
    const [, formAction, isSubmitting] = useActionState(
        saveResourceHttpSettings,
        null
    );

    async function saveResourceHttpSettings() {
        const isValidTLS = await tlsSettingsForm.trigger();
        const isValidProxy = await proxySettingsForm.trigger();
        const targetSettingsForm = await targetsSettingsForm.trigger();
        if (!isValidTLS || !isValidProxy || !targetSettingsForm) return;

        try {
            // Gather all settings
            const stickySessionData = targetsSettingsForm.getValues();
            const tlsData = tlsSettingsForm.getValues();
            const proxyData = proxySettingsForm.getValues();

            // Combine into one payload
            const payload = {
                stickySession: stickySessionData.stickySession,
                ssl: tlsData.ssl,
                tlsServerName: tlsData.tlsServerName || null,
                setHostHeader: proxyData.setHostHeader || null,
                headers: proxyData.headers || null
            };

            // Single API call to update all settings
            await api.post(`/resource/${resource.resourceId}`, payload);

            // Update local resource context
            updateResource({
                ...resource,
                stickySession: stickySessionData.stickySession,
                ssl: tlsData.ssl,
                tlsServerName: tlsData.tlsServerName || null,
                setHostHeader: proxyData.setHostHeader || null,
                headers: proxyData.headers || null
            });

            toast({
                title: t("settingsUpdated"),
                description: t("settingsUpdatedDescription")
            });

            router.refresh();
        } catch (err) {
            console.error(err);
            toast({
                variant: "destructive",
                title: t("settingsErrorUpdate"),
                description: formatAxiosError(
                    err,
                    t("settingsErrorUpdateDescription")
                )
            });
        }
    }

    return (
        <SettingsSection>
            <SettingsSectionHeader>
                <SettingsSectionTitle>
                    {t("proxyAdditional")}
                </SettingsSectionTitle>
                <SettingsSectionDescription>
                    {t("proxyAdditionalDescription")}
                </SettingsSectionDescription>
            </SettingsSectionHeader>
            <SettingsSectionBody>
                <SettingsSectionForm>
                    <Form {...tlsSettingsForm}>
                        <form
                            action={formAction}
                            className="space-y-4"
                            id="tls-settings-form"
                        >
                            {!env.flags.usePangolinDns && (
                                <FormField
                                    control={tlsSettingsForm.control}
                                    name="ssl"
                                    render={({ field }) => (
                                        <FormItem>
                                            <FormControl>
                                                <SwitchInput
                                                    id="ssl-toggle"
                                                    label={t("proxyEnableSSL")}
                                                    description={t(
                                                        "proxyEnableSSLDescription"
                                                    )}
                                                    defaultChecked={field.value}
                                                    onCheckedChange={(val) => {
                                                        field.onChange(val);
                                                    }}
                                                />
                                            </FormControl>
                                        </FormItem>
                                    )}
                                />
                            )}
                            <FormField
                                control={tlsSettingsForm.control}
                                name="tlsServerName"
                                render={({ field }) => (
                                    <FormItem>
                                        <FormLabel>
                                            {t("targetTlsSni")}
                                        </FormLabel>
                                        <FormControl>
                                            <Input {...field} />
                                        </FormControl>
                                        <FormDescription>
                                            {t("targetTlsSniDescription")}
                                        </FormDescription>
                                        <FormMessage />
                                    </FormItem>
                                )}
                            />
                        </form>
                    </Form>
                </SettingsSectionForm>

                <SettingsSectionForm>
                    <Form {...targetsSettingsForm}>
                        <form
                            action={formAction}
                            className="space-y-4"
                            id="targets-settings-form"
                        >
                            <FormField
                                control={targetsSettingsForm.control}
                                name="stickySession"
                                render={({ field }) => (
                                    <FormItem>
                                        <FormControl>
                                            <SwitchInput
                                                id="sticky-toggle"
                                                label={t(
                                                    "targetStickySessions"
                                                )}
                                                description={t(
                                                    "targetStickySessionsDescription"
                                                )}
                                                defaultChecked={field.value}
                                                onCheckedChange={(val) => {
                                                    field.onChange(val);
                                                }}
                                            />
                                        </FormControl>
                                    </FormItem>
                                )}
                            />
                        </form>
                    </Form>
                </SettingsSectionForm>

                <SettingsSectionForm>
                    <Form {...proxySettingsForm}>
                        <form
                            action={formAction}
                            className="space-y-4"
                            id="proxy-settings-form"
                        >
                            <FormField
                                control={proxySettingsForm.control}
                                name="setHostHeader"
                                render={({ field }) => (
                                    <FormItem>
                                        <FormLabel>
                                            {t("proxyCustomHeader")}
                                        </FormLabel>
                                        <FormControl>
                                            <Input {...field} />
                                        </FormControl>
                                        <FormDescription>
                                            {t("proxyCustomHeaderDescription")}
                                        </FormDescription>
                                        <FormMessage />
                                    </FormItem>
                                )}
                            />
                            <FormField
                                control={proxySettingsForm.control}
                                name="headers"
                                render={({ field }) => (
                                    <FormItem>
                                        <FormLabel>
                                            {t("customHeaders")}
                                        </FormLabel>
                                        <FormControl>
                                            <HeadersInput
                                                value={field.value}
                                                onChange={(value) => {
                                                    field.onChange(value);
                                                }}
                                                rows={4}
                                            />
                                        </FormControl>
                                        <FormDescription>
                                            {t("customHeadersDescription")}
                                        </FormDescription>
                                        <FormMessage />
                                    </FormItem>
                                )}
                            />
                        </form>
                    </Form>
                </SettingsSectionForm>
                <form className="flex justify-end" action={formAction}>
                    <Button
                        disabled={isSubmitting}
                        loading={isSubmitting}
                        type="submit"
                    >
                        {t("saveResourceHttp")}
                    </Button>
                </form>
            </SettingsSectionBody>
        </SettingsSection>
    );
}

function ProxyResourceProtocolForm({
    resource,
    updateResource
}: Pick<ResourceContextType, "resource" | "updateResource">) {
    const t = useTranslations();

    const api = createApiClient(useEnvContext());

    const proxySettingsSchema = z.object({
        setHostHeader: z
            .string()
            .optional()
            .refine(
                (data) => {
                    if (data) {
                        return tlsNameSchema.safeParse(data).success;
                    }
                    return true;
                },
                {
                    message: t("proxyErrorInvalidHeader")
                }
            ),
        headers: z
            .array(z.object({ name: z.string(), value: z.string() }))
            .nullable(),
        proxyProtocol: z.boolean().optional(),
        proxyProtocolVersion: z.int().min(1).max(2).optional()
    });

    const proxySettingsForm = useForm({
        resolver: zodResolver(proxySettingsSchema),
        defaultValues: {
            setHostHeader: resource.setHostHeader || "",
            headers: resource.headers,
            proxyProtocol: resource.proxyProtocol || false,
            proxyProtocolVersion: resource.proxyProtocolVersion || 1
        }
    });

    const router = useRouter();

    const [, formAction, isSubmitting] = useActionState(
        saveProtocolSettings,
        null
    );

    async function saveProtocolSettings() {
        const isValid = proxySettingsForm.trigger();
        if (!isValid) return;

        try {
            // For TCP/UDP resources, save proxy protocol settings
            const proxyData = proxySettingsForm.getValues();

            const payload = {
                proxyProtocol: proxyData.proxyProtocol || false,
                proxyProtocolVersion: proxyData.proxyProtocolVersion || 1
            };

            await api.post(`/resource/${resource.resourceId}`, payload);

            updateResource({
                ...resource,
                proxyProtocol: proxyData.proxyProtocol || false,
                proxyProtocolVersion: proxyData.proxyProtocolVersion || 1
            });

            toast({
                title: t("settingsUpdated"),
                description: t("settingsUpdatedDescription")
            });

            router.refresh();
        } catch (err) {
            console.error(err);
            toast({
                variant: "destructive",
                title: t("settingsErrorUpdate"),
                description: formatAxiosError(
                    err,
                    t("settingsErrorUpdateDescription")
                )
            });
        }
    }

    return (
        <SettingsSection>
            <SettingsSectionHeader>
                <SettingsSectionTitle>
                    {t("proxyProtocol")}
                </SettingsSectionTitle>
                <SettingsSectionDescription>
                    {t("proxyProtocolDescription")}
                </SettingsSectionDescription>
            </SettingsSectionHeader>
            <SettingsSectionBody>
                <SettingsSectionForm>
                    <Form {...proxySettingsForm}>
                        <form
                            action={formAction}
                            className="space-y-4"
                            id="proxy-protocol-settings-form"
                        >
                            <FormField
                                control={proxySettingsForm.control}
                                name="proxyProtocol"
                                render={({ field }) => (
                                    <FormItem>
                                        <FormControl>
                                            <SwitchInput
                                                id="proxy-protocol-toggle"
                                                label={t("enableProxyProtocol")}
                                                description={t(
                                                    "proxyProtocolInfo"
                                                )}
                                                defaultChecked={
                                                    field.value || false
                                                }
                                                onCheckedChange={(val) => {
                                                    field.onChange(val);
                                                }}
                                            />
                                        </FormControl>
                                    </FormItem>
                                )}
                            />

                            {proxySettingsForm.watch("proxyProtocol") && (
                                <>
                                    <FormField
                                        control={proxySettingsForm.control}
                                        name="proxyProtocolVersion"
                                        render={({ field }) => (
                                            <FormItem>
                                                <FormLabel>
                                                    {t("proxyProtocolVersion")}
                                                </FormLabel>
                                                <FormControl>
                                                    <Select
                                                        value={String(
                                                            field.value || 1
                                                        )}
                                                        onValueChange={(
                                                            value
                                                        ) =>
                                                            field.onChange(
                                                                parseInt(
                                                                    value,
                                                                    10
                                                                )
                                                            )
                                                        }
                                                    >
                                                        <SelectTrigger>
                                                            <SelectValue placeholder="Select version" />
                                                        </SelectTrigger>
                                                        <SelectContent>
                                                            <SelectItem value="1">
                                                                {t("version1")}
                                                            </SelectItem>
                                                            <SelectItem value="2">
                                                                {t("version2")}
                                                            </SelectItem>
                                                        </SelectContent>
                                                    </Select>
                                                </FormControl>
                                                <FormDescription>
                                                    {t("versionDescription")}
                                                </FormDescription>
                                            </FormItem>
                                        )}
                                    />

                                    <Alert>
                                        <AlertTriangle className="h-4 w-4" />
                                        <AlertDescription>
                                            <strong>{t("warning")}:</strong>{" "}
                                            {t("proxyProtocolWarning")}
                                        </AlertDescription>
                                    </Alert>
                                </>
                            )}
                        </form>
                    </Form>
                </SettingsSectionForm>
                <form action={formAction} className="flex justify-end">
                    <Button
                        disabled={isSubmitting}
                        loading={isSubmitting}
                        type="submit"
                    >
                        {t("saveProxyProtocol")}
                    </Button>
                </form>
            </SettingsSectionBody>
        </SettingsSection>
    );
}
