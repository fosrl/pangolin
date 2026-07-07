"use client";

import HealthCheckCredenza from "@/components/HealthCheckCredenza";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
    PathMatchDisplay,
    PathMatchModal,
    PathRewriteDisplay,
    PathRewriteModal
} from "@app/components/PathMatchRenameModal";
import {
    ResourceTargetAddressItem,
    ResourceTargetSiteItem
} from "@app/components/resource-target-address-item";
import {
    SettingsSection,
    SettingsSectionBody,
    SettingsSectionDescription,
    SettingsSectionHeader,
    SettingsSectionTitle
} from "@app/components/Settings";
import { DataTableEmptyState } from "@app/components/ui/data-table-empty-state";
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
import { toast } from "@app/hooks/useToast";
import { createApiClient } from "@app/lib/api";
import { formatAxiosError } from "@app/lib/api/formatAxiosError";
import { DockerManager, DockerState } from "@app/lib/docker";
import { orgQueries, resourceQueries } from "@app/lib/queries";
import { build } from "@server/build";
import { type GetResourceResponse } from "@server/routers/resource";
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
import { ExternalLink, Info, Plus } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import {
    useActionState,
    useCallback,
    useEffect,
    useMemo,
    useState
} from "react";
import { maxSize } from "zod";

export type LocalTarget = Omit<
    ArrayElement<ListTargetsResponse["targets"]> & {
        new?: boolean;
        updated?: boolean;
        siteType: string | null;
    },
    "protocol"
>;

interface ProxyResourceTargetsFormProps {
    orgId: string;
    isHttp: boolean;
    initialTargets?: LocalTarget[];
    /** Edit mode: when provided, shows a save button and polls for health status */
    resource?: GetResourceResponse;
    updateResource?: ResourceContextType["updateResource"];
    /** Create mode: called whenever the targets list changes */
    onChange?: (targets: LocalTarget[]) => void;
}

export function ProxyResourceTargetsForm({
    orgId,
    isHttp,
    initialTargets = [],
    resource,
    updateResource,
    onChange
}: ProxyResourceTargetsFormProps) {
    const t = useTranslations();
    const api = createApiClient(useEnvContext());

    const [targets, setTargets] = useState<LocalTarget[]>(initialTargets);
    const [targetsToRemove, setTargetsToRemove] = useState<number[]>([]);

    // Notify parent of changes (create mode)
    useEffect(() => {
        onChange?.(targets);
    }, [targets]);

    // Poll health status only in edit mode
    const { data: polledTargets } = useQuery({
        ...resourceQueries.resourceTargets({
            resourceId: resource?.resourceId ?? 0
        }),
        refetchInterval: 10_000,
        enabled: !!resource
    });

    useEffect(() => {
        if (!polledTargets) return;
        setTargets((prev) =>
            prev.map((t) => {
                const fresh = polledTargets.find(
                    (p) => p.targetId === t.targetId
                );
                if (!fresh) return t;
                return {
                    ...t,
                    hcHealth: fresh.hcHealth,
                    hcEnabled: t.updated ? t.hcEnabled : fresh.hcEnabled
                };
            })
        );
    }, [polledTargets]);

    const [dockerStates, setDockerStates] = useState<Map<number, DockerState>>(
        new Map()
    );
    const [healthCheckDialogOpen, setHealthCheckDialogOpen] = useState(false);
    const [selectedTargetForHealthCheck, setSelectedTargetForHealthCheck] =
        useState<LocalTarget | null>(null);

    const initializeDockerForSite = async (siteId: number) => {
        if (dockerStates.has(siteId)) {
            return;
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
                <div className="flex items-center gap-2 p-3">
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

                return (
                    <div className="flex items-center justify-center w-full">
                        {row.original.siteType === "newt" ? (
                            <Button
                                variant="outline"
                                className="flex items-center space-x-2 w-full text-left cursor-pointer"
                                onClick={() =>
                                    openHealthCheckDialog(row.original)
                                }
                            >
                                <div
                                    className={`w-2 h-2 rounded-full ${status === "healthy" ? "bg-green-500" : status === "unhealthy" ? "bg-destructive" : "bg-neutral-500"}`}
                                ></div>
                                <span>{getStatusText(status)}</span>
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
                                    updateTarget(
                                        row.original.targetId,
                                        config.path === null &&
                                            config.pathMatchType === null
                                            ? {
                                                  ...config,
                                                  rewritePath: null,
                                                  rewritePathType: null
                                              }
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
                                    updateTarget(
                                        row.original.targetId,
                                        config.path === null &&
                                            config.pathMatchType === null
                                            ? {
                                                  ...config,
                                                  rewritePath: null,
                                                  rewritePathType: null
                                              }
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

        const siteColumn: ColumnDef<LocalTarget> = {
            accessorKey: "site",
            header: () => <span className="p-3">{t("site")}</span>,
            cell: ({ row }) => {
                return (
                    <ResourceTargetSiteItem
                        orgId={orgId}
                        getDockerStateForSite={getDockerStateForSite}
                        proxyTarget={row.original}
                        refreshContainersForSite={refreshContainersForSite}
                        updateTarget={updateTarget}
                    />
                );
            },
            size: 220,
            minSize: 180,
            maxSize: 280
        };

        const addressColumn: ColumnDef<LocalTarget> = {
            accessorKey: "address",
            header: () => <span className="p-3">{t("address")}</span>,
            cell: ({ row }) => {
                return (
                    <ResourceTargetAddressItem
                        isHttp={isHttp}
                        proxyTarget={row.original}
                        updateTarget={updateTarget}
                    />
                );
            },
            size: 350,
            minSize: 300,
            maxSize: 450
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
                <div className="flex items-center w-full">
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
            cell: ({ row }) => (
                <div className="flex items-center justify-end w-full">
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
            const cols = [
                siteColumn,
                addressColumn,
                healthCheckColumn,
                enabledColumn,
                actionsColumn
            ];

            if (isHttp) {
                cols.unshift(matchPathColumn);
                cols.splice(4, 0, rewritePathColumn, priorityColumn);
            }

            return cols;
        } else {
            return [
                siteColumn,
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
        const newTarget: LocalTarget = {
            targetId: -Date.now(),
            ip: "",
            mode: ((resource?.mode as LocalTarget["mode"]) ??
                (isHttp ? "http" : "tcp")) as LocalTarget["mode"],
            method: isHttp ? "http" : null,
            port: 0,
            siteId: sites.length > 0 ? sites[0].siteId : 0,
            siteName: sites.length > 0 ? sites[0].name : "",
            path: null,
            pathMatchType: null,
            rewritePath: null,
            rewritePathType: null,
            priority: 100,
            enabled: true,
            resourceId: resource?.resourceId ?? 0,
            hcEnabled: false,
            hcPath: null,
            hcMethod: null,
            hcInterval: null,
            hcTimeout: null,
            hcHeaders: null,
            hcFollowRedirects: null,
            hcScheme: null,
            hcHostname: null,
            hcPort: null,
            hcHealth: "unknown",
            hcStatus: null,
            hcMode: null,
            hcUnhealthyInterval: null,
            hcTlsServerName: null,
            hcHealthyThreshold: null,
            hcUnhealthyThreshold: null,
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

    useEffect(() => {
        if (typeof window !== "undefined") {
            localStorage.setItem(
                "proxy-advanced-mode",
                isAdvancedMode.toString()
            );
        }
    }, [isAdvancedMode]);

    const [, formAction, isSubmitting] = useActionState(saveTargets, null);

    const addTargetButton = (
        <Button onClick={addNewTarget} variant="outline">
            <Plus className="h-4 w-4 mr-2" />
            {t("addTarget")}
        </Button>
    );

    const hasTargets = targets.length > 0;

    async function saveTargets() {
        if (!resource) return;

        const targetsWithInvalidFields = targets.filter(
            (target) =>
                !target.ip ||
                target.ip.trim() === "" ||
                !target.port ||
                target.port <= 0 ||
                isNaN(target.port)
        );
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
                    hcTlsServerName: target.hcTlsServerName,
                    hcHealthyThreshold: target.hcHealthyThreshold || null,
                    hcUnhealthyThreshold: target.hcUnhealthyThreshold || null
                };

                if (isHttp) {
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
                title:
                    targets.length === 0
                        ? t("targetTargetsCleared")
                        : t("settingsUpdated"),
                description:
                    targets.length === 0
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
                    <div className="overflow-x-auto">
                        <Table>
                            <TableHeader>
                                {table.getHeaderGroups().map((headerGroup) => (
                                    <TableRow key={headerGroup.id}>
                                        {headerGroup.headers.map((header) => {
                                            const isActionsColumn =
                                                header.column.id === "actions";
                                            const isSiteColumn =
                                                header.column.id === "site";
                                            return (
                                                <TableHead
                                                    key={header.id}
                                                    className={
                                                        isActionsColumn
                                                            ? "sticky right-0 z-10 w-auto min-w-fit bg-card"
                                                            : isSiteColumn
                                                              ? "w-45"
                                                              : ""
                                                    }
                                                >
                                                    {header.isPlaceholder
                                                        ? null
                                                        : flexRender(
                                                              header.column
                                                                  .columnDef
                                                                  .header,
                                                              header.getContext()
                                                          )}
                                                </TableHead>
                                            );
                                        })}
                                    </TableRow>
                                ))}
                            </TableHeader>
                            <TableBody>
                                {table.getRowModel().rows?.length ? (
                                    table.getRowModel().rows.map((row) => (
                                        <TableRow key={row.id}>
                                            {row
                                                .getVisibleCells()
                                                .map((cell) => {
                                                    const isActionsColumn =
                                                        cell.column.id ===
                                                        "actions";
                                                    const isSiteColumn =
                                                        cell.column.id ===
                                                        "site";
                                                    return (
                                                        <TableCell
                                                            key={cell.id}
                                                            className={
                                                                isActionsColumn
                                                                    ? "sticky right-0 z-10 w-auto min-w-fit bg-card"
                                                                    : isSiteColumn
                                                                      ? "w-45"
                                                                      : ""
                                                            }
                                                        >
                                                            {flexRender(
                                                                cell.column
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
                                    <DataTableEmptyState
                                        colSpan={columns.length}
                                        message={t("targetNoOne")}
                                        action={addTargetButton}
                                    />
                                )}
                            </TableBody>
                        </Table>
                    </div>
                    {hasTargets && (
                        <div className="flex items-center justify-between mb-4">
                            <div className="flex items-center justify-between w-full gap-2">
                                {addTargetButton}
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
                    )}
                    {build === "saas" &&
                        targets.length > 1 &&
                        new Set(targets.map((t) => t.siteId)).size > 1 && (
                            <p className="text-sm text-muted-foreground mt-3">
                                {t("proxyMultiSiteRoundRobinNodeHelp")}{" "}
                                <a
                                    href="https://docs.pangolin.net/manage/resources/public/targets#distributing-sites-load-across-servers"
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="text-primary hover:underline inline-flex items-center gap-1"
                                >
                                    {t("learnMore")}
                                    <ExternalLink className="size-3.5 shrink-0" />
                                </a>
                                .
                            </p>
                        )}
                </SettingsSectionBody>

                {/* Save button — only shown in edit mode */}
                {resource && (
                    <form className="self-end mt-4" action={formAction}>
                        <Button
                            disabled={isSubmitting}
                            loading={isSubmitting}
                            type="submit"
                        >
                            {t("saveResourceTargets")}
                        </Button>
                    </form>
                )}
            </SettingsSection>

            {selectedTargetForHealthCheck && (
                <HealthCheckCredenza
                    mode="autoSave"
                    open={healthCheckDialogOpen}
                    setOpen={setHealthCheckDialogOpen}
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
                            selectedTargetForHealthCheck.hcFollowRedirects ??
                            true,
                        hcStatus:
                            selectedTargetForHealthCheck.hcStatus || undefined,
                        hcMode: selectedTargetForHealthCheck.hcMode || "http",
                        hcUnhealthyInterval:
                            selectedTargetForHealthCheck.hcUnhealthyInterval ||
                            30,
                        hcTlsServerName:
                            selectedTargetForHealthCheck.hcTlsServerName ||
                            undefined,
                        hcHealthyThreshold:
                            selectedTargetForHealthCheck.hcHealthyThreshold ||
                            1,
                        hcUnhealthyThreshold:
                            selectedTargetForHealthCheck.hcUnhealthyThreshold ||
                            1
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
