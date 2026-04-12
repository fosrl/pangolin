"use client";

import CopyTextBox from "@app/components/CopyTextBox";
import DomainPicker from "@app/components/DomainPicker";
import HealthCheckDialog from "@app/components/HealthCheckDialog";
import {
    PathMatchDisplay,
    PathMatchModal,
    PathRewriteDisplay,
    PathRewriteModal
} from "@app/components/PathMatchRenameModal";
import {
    SettingsContainer,
    SettingsSection,
    SettingsSectionBody,
    SettingsSectionDescription,
    SettingsSectionForm,
    SettingsSectionHeader,
    SettingsSectionTitle
} from "@app/components/Settings";
import HeaderTitle from "@app/components/SettingsSectionTitle";
import { StrategySelect } from "@app/components/StrategySelect";
import { ResourceTargetAddressItem } from "@app/components/resource-target-address-item";
import { Button } from "@app/components/ui/button";
import {
    Form,
    FormControl,
    FormDescription,
    FormField,
    FormItem,
    FormLabel,
    FormMessage
} from "@app/components/ui/form";
import { Input } from "@app/components/ui/input";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue
} from "@app/components/ui/select";
import { Switch } from "@app/components/ui/switch";
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
import { Alert, AlertDescription, AlertTitle } from "@app/components/ui/alert";
import { useEnvContext } from "@app/hooks/useEnvContext";
import { toast } from "@app/hooks/useToast";
import { createApiClient, formatAxiosError } from "@app/lib/api";
import { DockerManager, DockerState } from "@app/lib/docker";
import { orgQueries } from "@app/lib/queries";
import { finalizeSubdomainSanitize } from "@app/lib/subdomain-utils";
import { zodResolver } from "@hookform/resolvers/zod";
import { build } from "@server/build";
import { Resource } from "@server/db";
import { isTargetValid } from "@server/lib/validators";
import { ListTargetsResponse } from "@server/routers/target";
import { ListRemoteExitNodesResponse } from "@server/routers/remoteExitNode/types";
import { ArrayElement } from "@server/types/ArrayElement";
import { useQuery } from "@tanstack/react-query";
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
    CircleCheck,
    CircleX,
    Info,
    InfoIcon,
    Plus,
    Settings,
    SquareArrowOutUpRight
} from "lucide-react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { toASCII } from "punycode";
import { useEffect, useMemo, useState, useCallback } from "react";
import { Controller, useForm } from "react-hook-form";
import { z } from "zod";

const baseResourceFormSchema = z.object({
    name: z.string().min(1).max(255),
    http: z.boolean()
});

const httpResourceFormSchema = z.object({
    domainId: z.string().nonempty(),
    subdomain: z.string().optional()
});

const tcpUdpResourceFormSchema = z.object({
    protocol: z.string(),
    proxyPort: z.int().min(1).max(65535)
    // enableProxy: z.boolean().default(false)
});

const addTargetSchema = z
    .object({
        ip: z.string().refine(isTargetValid),
        method: z.string().nullable(),
        port: z.coerce.number<number>().int().positive(),
        siteId: z.int().positive(),
        path: z.string().optional().nullable(),
        pathMatchType: z
            .enum(["exact", "prefix", "regex"])
            .optional()
            .nullable(),
        rewritePath: z.string().optional().nullable(),
        rewritePathType: z
            .enum(["exact", "prefix", "regex", "stripPrefix"])
            .optional()
            .nullable(),
        priority: z.int().min(1).max(1000).optional()
    })
    .refine(
        (data) => {
            // If path is provided, pathMatchType must be provided
            if (data.path && !data.pathMatchType) {
                return false;
            }
            // If pathMatchType is provided, path must be provided
            if (data.pathMatchType && !data.path) {
                return false;
            }
            // Validate path based on pathMatchType
            if (data.path && data.pathMatchType) {
                switch (data.pathMatchType) {
                    case "exact":
                    case "prefix":
                        // Path should start with /
                        return data.path.startsWith("/");
                    case "regex":
                        // Validate regex
                        try {
                            new RegExp(data.path);
                            return true;
                        } catch {
                            return false;
                        }
                }
            }
            return true;
        },
        {
            error: "Invalid path configuration"
        }
    )
    .refine(
        (data) => {
            // If rewritePath is provided, rewritePathType must be provided
            if (data.rewritePath && !data.rewritePathType) {
                return false;
            }
            // If rewritePathType is provided, rewritePath must be provided
            // Exception: stripPrefix can have an empty rewritePath (to just strip the prefix)
            if (data.rewritePathType && !data.rewritePath) {
                // Allow empty rewritePath for stripPrefix type
                if (data.rewritePathType !== "stripPrefix") {
                    return false;
                }
            }
            return true;
        },
        {
            error: "Invalid rewrite path configuration"
        }
    );

type ResourceType = "http" | "raw";

interface ResourceTypeOption {
    id: ResourceType;
    title: string;
    description: string;
    disabled?: boolean;
}

export type LocalTarget = Omit<
    ArrayElement<ListTargetsResponse["targets"]> & {
        new?: boolean;
        updated?: boolean;
        siteType: string | null;
    },
    "protocol"
>;

export default function Page() {
    const { env } = useEnvContext();
    const api = createApiClient({ env });
    const { orgId } = useParams();
    const router = useRouter();
    const t = useTranslations();

    const { data: sites = [], isLoading: loadingPage } = useQuery(
        orgQueries.sites({ orgId: orgId as string })
    );

    const [remoteExitNodes, setRemoteExitNodes] = useState<
        ListRemoteExitNodesResponse["remoteExitNodes"]
    >([]);
    const [loadingExitNodes, setLoadingExitNodes] = useState(build === "saas");

    const [createLoading, setCreateLoading] = useState(false);
    const [showSnippets, setShowSnippets] = useState(false);
    const [niceId, setNiceId] = useState<string>("");

    // Target management state
    const [targets, setTargets] = useState<LocalTarget[]>([]);
    const [dockerStates, setDockerStates] = useState<Map<number, DockerState>>(
        new Map()
    );

    const [selectedTargetForHealthCheck, setSelectedTargetForHealthCheck] =
        useState<LocalTarget | null>(null);
    const [healthCheckDialogOpen, setHealthCheckDialogOpen] = useState(false);

    useEffect(() => {
        if (build !== "saas") return;

        const fetchExitNodes = async () => {
            try {
                const res = await api.get<
                    AxiosResponse<ListRemoteExitNodesResponse>
                >(`/org/${orgId}/remote-exit-nodes`);
                if (res && res.status === 200) {
                    setRemoteExitNodes(res.data.data.remoteExitNodes);
                }
            } catch (e) {
                console.error("Failed to fetch remote exit nodes:", e);
            } finally {
                setLoadingExitNodes(false);
            }
        };

        fetchExitNodes();
    }, [orgId]);

    const [isAdvancedMode, setIsAdvancedMode] = useState(() => {
        if (typeof window !== "undefined") {
            const saved = localStorage.getItem("create-advanced-mode");
            return saved === "true";
        }
        return false;
    });

    // Save advanced mode preference to localStorage
    useEffect(() => {
        if (typeof window !== "undefined") {
            localStorage.setItem(
                "create-advanced-mode",
                isAdvancedMode.toString()
            );
        }
    }, [isAdvancedMode]);

    function addNewTarget() {
        const isHttp = baseForm.watch("http");

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
            resourceId: 0,
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

    const resourceTypes: ReadonlyArray<ResourceTypeOption> = [
        {
            id: "http",
            title: t("resourceHTTP"),
            description: t("resourceHTTPDescription")
        },
        ...(!env.flags.allowRawResources
            ? []
            : build === "saas" && remoteExitNodes.length === 0
              ? []
              : [
                    {
                        id: "raw" as ResourceType,
                        title: t("resourceRaw"),
                        description:
                            build == "saas"
                                ? t("resourceRawDescriptionCloud")
                                : t("resourceRawDescription")
                    }
                ])
    ];

    // In saas mode with no exit nodes, force HTTP
    const showTypeSelector =
        build !== "saas" || (!loadingExitNodes && remoteExitNodes.length > 0);

    const baseForm = useForm({
        resolver: zodResolver(baseResourceFormSchema),
        defaultValues: {
            name: "",
            http: true
        }
    });

    const httpForm = useForm({
        resolver: zodResolver(httpResourceFormSchema),
        defaultValues: {}
    });

    const tcpUdpForm = useForm({
        resolver: zodResolver(tcpUdpResourceFormSchema),
        defaultValues: {
            protocol: "tcp",
            proxyPort: undefined
            // enableProxy: false
        }
    });

    const addTargetForm = useForm({
        resolver: zodResolver(addTargetSchema),
        defaultValues: {
            ip: "",
            method: baseForm.watch("http") ? "http" : null,
            port: "" as any as number,
            path: null,
            pathMatchType: null,
            rewritePath: null,
            rewritePathType: null,
            priority: baseForm.watch("http") ? 100 : undefined
        } as z.infer<typeof addTargetSchema>
    });

    // Helper function to check if all targets have required fields using schema validation
    const areAllTargetsValid = () => {
        if (targets.length === 0) return true; // No targets is valid

        return targets.every((target) => {
            try {
                const isHttp = baseForm.watch("http");
                const targetData: any = {
                    ip: target.ip,
                    method: target.method,
                    port: target.port,
                    siteId: target.siteId,
                    path: target.path,
                    pathMatchType: target.pathMatchType,
                    rewritePath: target.rewritePath,
                    rewritePathType: target.rewritePathType
                };

                // Only include priority for HTTP resources
                if (isHttp) {
                    targetData.priority = target.priority;
                }

                addTargetSchema.parse(targetData);
                return true;
            } catch {
                return false;
            }
        });
    };

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

    const removeTarget = useCallback((targetId: number) => {
        setTargets((prevTargets) => {
            return prevTargets.filter((target) => target.targetId !== targetId);
        });
    }, []);

    const updateTarget = useCallback(
        (targetId: number, data: Partial<LocalTarget>) => {
            setTargets((prevTargets) => {
                const site = sites.find((site) => site.siteId === data.siteId);
                return prevTargets.map((target) =>
                    target.targetId === targetId
                        ? {
                              ...target,
                              ...data,
                              updated: true,
                              siteType: site ? site.type : target.siteType
                          }
                        : target
                );
            });
        },
        [sites]
    );

    async function onSubmit() {
        setCreateLoading(true);

        const baseData = baseForm.getValues();
        const isHttp = baseData.http;

        try {
            const payload = {
                name: baseData.name,
                http: baseData.http
            };

            let sanitizedSubdomain: string | undefined;

            if (isHttp) {
                const httpData = httpForm.getValues();

                sanitizedSubdomain = httpData.subdomain
                    ? finalizeSubdomainSanitize(httpData.subdomain)
                    : undefined;

                Object.assign(payload, {
                    subdomain: sanitizedSubdomain
                        ? toASCII(sanitizedSubdomain)
                        : undefined,
                    domainId: httpData.domainId,
                    protocol: "tcp"
                });
            } else {
                const tcpUdpData = tcpUdpForm.getValues();
                Object.assign(payload, {
                    protocol: tcpUdpData.protocol,
                    proxyPort: tcpUdpData.proxyPort
                    // enableProxy: tcpUdpData.enableProxy
                });
            }

            const res = await api
                .put<
                    AxiosResponse<Resource>
                >(`/org/${orgId}/resource/`, payload)
                .catch((e) => {
                    toast({
                        variant: "destructive",
                        title: t("resourceErrorCreate"),
                        description: formatAxiosError(
                            e,
                            t("resourceErrorCreateDescription")
                        )
                    });
                });

            if (res && res.status === 201) {
                const id = res.data.data.resourceId;
                const niceId = res.data.data.niceId;
                setNiceId(niceId);

                // Create targets if any exist
                if (targets.length > 0) {
                    try {
                        for (const target of targets) {
                            const data: any = {
                                ip: target.ip,
                                port: target.port,
                                method: target.method,
                                enabled: target.enabled,
                                siteId: target.siteId,
                                hcEnabled: target.hcEnabled,
                                hcPath: target.hcPath || null,
                                hcMethod: target.hcMethod || null,
                                hcInterval: target.hcInterval || null,
                                hcTimeout: target.hcTimeout || null,
                                hcHeaders: target.hcHeaders || null,
                                hcScheme: target.hcScheme || null,
                                hcHostname: target.hcHostname || null,
                                hcPort: target.hcPort || null,
                                hcFollowRedirects:
                                    target.hcFollowRedirects || null,
                                hcStatus: target.hcStatus || null,
                                hcUnhealthyInterval:
                                    target.hcUnhealthyInterval || null,
                                hcMode: target.hcMode || null,
                                hcTlsServerName: target.hcTlsServerName
                            };

                            // Only include path-related fields for HTTP resources
                            if (isHttp) {
                                data.path = target.path;
                                data.pathMatchType = target.pathMatchType;
                                data.rewritePath = target.rewritePath;
                                data.rewritePathType = target.rewritePathType;
                                data.priority = target.priority;
                            }

                            await api.put(`/resource/${id}/target`, data);
                        }
                    } catch (targetError) {
                        console.error("Error creating targets:", targetError);
                        toast({
                            variant: "destructive",
                            title: t("targetErrorCreate"),
                            description: formatAxiosError(
                                targetError,
                                t("targetErrorCreateDescription")
                            )
                        });
                    }
                }

                if (isHttp) {
                    router.push(`/${orgId}/settings/resources/proxy/${niceId}`);
                } else {
                    const tcpUdpData = tcpUdpForm.getValues();
                    // Only show config snippets if enableProxy is explicitly true
                    // if (tcpUdpData.enableProxy === true) {
                    setShowSnippets(true);
                    router.refresh();
                    // } else {
                    //     // If enableProxy is false or undefined, go directly to resource page
                    //     router.push(`/${orgId}/settings/resources/proxy/${id}`);
                    // }
                }
            }
        } catch (e) {
            console.error(t("resourceErrorCreateMessage"), e);
            toast({
                variant: "destructive",
                title: t("resourceErrorCreate"),
                description: formatAxiosError(
                    e,
                    t("resourceErrorCreateMessageDescription")
                )
            });
        }

        setCreateLoading(false);
    }

    useEffect(() => {
        // Initialize Docker for newt sites
        for (const site of sites) {
            if (site.type === "newt") {
                initializeDockerForSite(site.siteId);
            }
        }

        // If there's at least one site, set it as the default in the form
        if (sites.length > 0) {
            addTargetForm.setValue("siteId", sites[0].siteId);
        }
    }, [sites]);

    function TargetHealthCheck(targetId: number, config: any) {
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

    const openHealthCheckDialog = useCallback((target: LocalTarget) => {
        console.log(target);
        setSelectedTargetForHealthCheck(target);
        setHealthCheckDialogOpen(true);
    }, []);

    const isHttp = baseForm.watch("http");

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
                    <div className="flex items-center justify-center w-full">
                        <Input
                            type="number"
                            min="1"
                            max="1000"
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
                                <Settings className="h-4 w-4" />
                                <div className="flex items-center gap-1">
                                    {getStatusIcon(status)}
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
                                        className="flex items-center gap-2 p-2 w-full text-left cursor-pointer max-w-50"
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
                                        className="w-full max-w-50"
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
            cell: ({ row }) => (
                <ResourceTargetAddressItem
                    isHttp={isHttp}
                    orgId={orgId!.toString()}
                    // sites={sites}
                    getDockerStateForSite={getDockerStateForSite}
                    proxyTarget={row.original}
                    refreshContainersForSite={refreshContainersForSite}
                    updateTarget={updateTarget}
                />
            ),
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
                                        className="w-full max-w-50"
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

    return (
        <>
            <div className="flex justify-between">
                <HeaderTitle
                    title={t("resourceCreate")}
                    description={t("resourceCreateDescription")}
                />
                <Button
                    variant="outline"
                    onClick={() => {
                        router.push(`/${orgId}/settings/resources`);
                    }}
                >
                    {t("resourceSeeAll")}
                </Button>
            </div>

            {!loadingPage && (
                <div>
                    {!showSnippets ? (
                        <SettingsContainer>
                            <SettingsSection>
                                <SettingsSectionHeader>
                                    <SettingsSectionTitle>
                                        {t("resourceInfo")}
                                    </SettingsSectionTitle>
                                </SettingsSectionHeader>
                                <SettingsSectionBody>
                                    {showTypeSelector &&
                                        resourceTypes.length > 1 && (
                                            <>
                                                <div className="mb-2">
                                                    <span className="text-sm font-medium">
                                                        {t("type")}
                                                    </span>
                                                </div>

                                                <StrategySelect
                                                    options={resourceTypes}
                                                    defaultValue="http"
                                                    onChange={(value) => {
                                                        baseForm.setValue(
                                                            "http",
                                                            value === "http"
                                                        );
                                                        // Update method default when switching resource type
                                                        addTargetForm.setValue(
                                                            "method",
                                                            value === "http"
                                                                ? "http"
                                                                : null
                                                        );
                                                    }}
                                                    cols={2}
                                                />
                                            </>
                                        )}

                                    <SettingsSectionForm>
                                        <Form {...baseForm}>
                                            <form
                                                onKeyDown={(e) => {
                                                    if (e.key === "Enter") {
                                                        e.preventDefault(); // block default enter refresh
                                                    }
                                                }}
                                                className="space-y-4"
                                                id="base-resource-form"
                                            >
                                                <FormField
                                                    control={baseForm.control}
                                                    name="name"
                                                    render={({ field }) => (
                                                        <FormItem>
                                                            <FormLabel>
                                                                {t("name")}
                                                            </FormLabel>
                                                            <FormControl>
                                                                <Input
                                                                    {...field}
                                                                />
                                                            </FormControl>
                                                            <FormMessage />
                                                            <FormDescription>
                                                                {t(
                                                                    "resourceNameDescription"
                                                                )}
                                                            </FormDescription>
                                                        </FormItem>
                                                    )}
                                                />
                                            </form>
                                        </Form>
                                    </SettingsSectionForm>
                                </SettingsSectionBody>
                            </SettingsSection>

                            {baseForm.watch("http") ? (
                                <SettingsSection>
                                    <SettingsSectionHeader>
                                        <SettingsSectionTitle>
                                            {t("resourceHTTPSSettings")}
                                        </SettingsSectionTitle>
                                        <SettingsSectionDescription>
                                            {t(
                                                "resourceHTTPSSettingsDescription"
                                            )}
                                        </SettingsSectionDescription>
                                    </SettingsSectionHeader>
                                    <SettingsSectionBody>
                                        <DomainPicker
                                            orgId={orgId as string}
                                            warnOnProvidedDomain={
                                                remoteExitNodes.length >= 1
                                            }
                                            onDomainChange={(res) => {
                                                if (!res) return;

                                                httpForm.setValue(
                                                    "subdomain",
                                                    res.subdomain
                                                );
                                                httpForm.setValue(
                                                    "domainId",
                                                    res.domainId
                                                );
                                                console.log(
                                                    "Domain changed:",
                                                    res
                                                );
                                            }}
                                        />
                                    </SettingsSectionBody>
                                </SettingsSection>
                            ) : (
                                <SettingsSection>
                                    <SettingsSectionHeader>
                                        <SettingsSectionTitle>
                                            {t("resourceRawSettings")}
                                        </SettingsSectionTitle>
                                        <SettingsSectionDescription>
                                            {t(
                                                "resourceRawSettingsDescription"
                                            )}
                                        </SettingsSectionDescription>
                                    </SettingsSectionHeader>
                                    <SettingsSectionBody>
                                        <Form {...tcpUdpForm}>
                                            <form
                                                onKeyDown={(e) => {
                                                    if (e.key === "Enter") {
                                                        e.preventDefault(); // block default enter refresh
                                                    }
                                                }}
                                                className="space-y-4 grid gap-4 grid-cols-1 md:grid-cols-2 items-start"
                                                id="tcp-udp-settings-form"
                                            >
                                                <Controller
                                                    control={tcpUdpForm.control}
                                                    name="protocol"
                                                    render={({ field }) => (
                                                        <FormItem>
                                                            <FormLabel>
                                                                {t("protocol")}
                                                            </FormLabel>
                                                            <Select
                                                                onValueChange={
                                                                    field.onChange
                                                                }
                                                                {...field}
                                                            >
                                                                <FormControl>
                                                                    <SelectTrigger>
                                                                        <SelectValue
                                                                            placeholder={t(
                                                                                "protocolSelect"
                                                                            )}
                                                                        />
                                                                    </SelectTrigger>
                                                                </FormControl>
                                                                <SelectContent>
                                                                    <SelectItem value="tcp">
                                                                        TCP
                                                                    </SelectItem>
                                                                    <SelectItem value="udp">
                                                                        UDP
                                                                    </SelectItem>
                                                                </SelectContent>
                                                            </Select>
                                                            <FormMessage />
                                                        </FormItem>
                                                    )}
                                                />

                                                <FormField
                                                    control={tcpUdpForm.control}
                                                    name="proxyPort"
                                                    render={({ field }) => (
                                                        <FormItem>
                                                            <FormLabel>
                                                                {t(
                                                                    "resourcePortNumber"
                                                                )}
                                                            </FormLabel>
                                                            <FormControl>
                                                                <Input
                                                                    type="number"
                                                                    value={
                                                                        field.value ??
                                                                        ""
                                                                    }
                                                                    onChange={(
                                                                        e
                                                                    ) =>
                                                                        field.onChange(
                                                                            e
                                                                                .target
                                                                                .value
                                                                                ? parseInt(
                                                                                      e
                                                                                          .target
                                                                                          .value
                                                                                  )
                                                                                : undefined
                                                                        )
                                                                    }
                                                                />
                                                            </FormControl>
                                                            <FormMessage />
                                                            <FormDescription>
                                                                {t(
                                                                    "resourcePortNumberDescription"
                                                                )}
                                                            </FormDescription>
                                                        </FormItem>
                                                    )}
                                                />
                                            </form>
                                        </Form>
                                    </SettingsSectionBody>
                                </SettingsSection>
                            )}

                            <SettingsSection>
                                <SettingsSectionHeader>
                                    <SettingsSectionTitle>
                                        {t("targets")}
                                    </SettingsSectionTitle>
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
                                                            .map(
                                                                (
                                                                    headerGroup
                                                                ) => (
                                                                    <TableRow
                                                                        key={
                                                                            headerGroup.id
                                                                        }
                                                                    >
                                                                        {headerGroup.headers.map(
                                                                            (
                                                                                header
                                                                            ) => {
                                                                                const isActionsColumn =
                                                                                    header
                                                                                        .column
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
                                                                )
                                                            )}
                                                    </TableHeader>
                                                    <TableBody>
                                                        {table.getRowModel()
                                                            .rows?.length ? (
                                                            table
                                                                .getRowModel()
                                                                .rows.map(
                                                                    (row) => (
                                                                        <TableRow
                                                                            key={
                                                                                row.id
                                                                            }
                                                                        >
                                                                            {row
                                                                                .getVisibleCells()
                                                                                .map(
                                                                                    (
                                                                                        cell
                                                                                    ) => {
                                                                                        const isActionsColumn =
                                                                                            cell
                                                                                                .column
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
                                                                                    }
                                                                                )}
                                                                        </TableRow>
                                                                    )
                                                                )
                                                        ) : (
                                                            <TableRow>
                                                                <TableCell
                                                                    colSpan={
                                                                        columns.length
                                                                    }
                                                                    className="h-24 text-center"
                                                                >
                                                                    {t(
                                                                        "targetNoOne"
                                                                    )}
                                                                </TableCell>
                                                            </TableRow>
                                                        )}
                                                    </TableBody>
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
                                                            checked={
                                                                isAdvancedMode
                                                            }
                                                            onCheckedChange={
                                                                setIsAdvancedMode
                                                            }
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
                                            <Button
                                                onClick={addNewTarget}
                                                variant="outline"
                                            >
                                                <Plus className="h-4 w-4 mr-2" />
                                                {t("addTarget")}
                                            </Button>
                                        </div>
                                    )}
                                </SettingsSectionBody>
                            </SettingsSection>

                            <div className="flex justify-end space-x-2 mt-8">
                                <Button
                                    type="button"
                                    variant="outline"
                                    onClick={() =>
                                        router.push(
                                            `/${orgId}/settings/resources`
                                        )
                                    }
                                >
                                    {t("cancel")}
                                </Button>
                                <Button
                                    type="button"
                                    onClick={async () => {
                                        const isHttp = baseForm.watch("http");
                                        const baseValid =
                                            await baseForm.trigger();
                                        const settingsValid = isHttp
                                            ? await httpForm.trigger()
                                            : await tcpUdpForm.trigger();

                                        console.log(httpForm.getValues());

                                        if (baseValid && settingsValid) {
                                            onSubmit();
                                        }
                                    }}
                                    loading={createLoading}
                                    disabled={!areAllTargetsValid()}
                                >
                                    {t("resourceCreate")}
                                </Button>
                            </div>
                            {selectedTargetForHealthCheck && (
                                <HealthCheckDialog
                                    open={healthCheckDialogOpen}
                                    setOpen={setHealthCheckDialogOpen}
                                    targetId={
                                        selectedTargetForHealthCheck.targetId
                                    }
                                    targetAddress={`${selectedTargetForHealthCheck.ip}:${selectedTargetForHealthCheck.port}`}
                                    targetMethod={
                                        selectedTargetForHealthCheck.method ||
                                        undefined
                                    }
                                    initialConfig={{
                                        hcEnabled:
                                            selectedTargetForHealthCheck.hcEnabled ||
                                            false,
                                        hcPath:
                                            selectedTargetForHealthCheck.hcPath ||
                                            "/",
                                        hcMethod:
                                            selectedTargetForHealthCheck.hcMethod ||
                                            "GET",
                                        hcInterval:
                                            selectedTargetForHealthCheck.hcInterval ||
                                            5,
                                        hcTimeout:
                                            selectedTargetForHealthCheck.hcTimeout ||
                                            5,
                                        hcHeaders:
                                            selectedTargetForHealthCheck.hcHeaders ||
                                            undefined,
                                        hcScheme:
                                            selectedTargetForHealthCheck.hcScheme ||
                                            undefined,
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
                                            selectedTargetForHealthCheck.hcStatus ||
                                            undefined,
                                        hcMode:
                                            selectedTargetForHealthCheck.hcMode ||
                                            "http",
                                        hcUnhealthyInterval:
                                            selectedTargetForHealthCheck.hcUnhealthyInterval ||
                                            30,
                                        hcTlsServerName:
                                            selectedTargetForHealthCheck.hcTlsServerName ||
                                            undefined
                                    }}
                                    onChanges={async (config) => {
                                        if (selectedTargetForHealthCheck) {
                                            console.log(config);
                                            TargetHealthCheck(
                                                selectedTargetForHealthCheck.targetId,
                                                config
                                            );
                                        }
                                    }}
                                />
                            )}
                        </SettingsContainer>
                    ) : (
                        <SettingsContainer>
                            <SettingsSection>
                                <SettingsSectionHeader>
                                    <SettingsSectionTitle>
                                        {t("resourceConfig")}
                                    </SettingsSectionTitle>
                                    <SettingsSectionDescription>
                                        {t("resourceConfigDescription")}
                                    </SettingsSectionDescription>
                                </SettingsSectionHeader>
                                <SettingsSectionBody>
                                    <div className="space-y-6">
                                        <div className="space-y-4">
                                            <h3 className="text-lg font-semibold">
                                                {t("resourceAddEntrypoints")}
                                            </h3>
                                            <p className="text-sm text-muted-foreground">
                                                {t(
                                                    "resourceAddEntrypointsEditFile"
                                                )}
                                            </p>
                                            <CopyTextBox
                                                text={`entryPoints:
  ${tcpUdpForm.getValues("protocol")}-${tcpUdpForm.getValues("proxyPort")}:
    address: ":${tcpUdpForm.getValues("proxyPort")}/${tcpUdpForm.getValues("protocol")}"`}
                                                wrapText={false}
                                            />
                                        </div>

                                        <div className="space-y-4">
                                            <h3 className="text-lg font-semibold">
                                                {t("resourceExposePorts")}
                                            </h3>
                                            <p className="text-sm text-muted-foreground">
                                                {t(
                                                    "resourceExposePortsEditFile"
                                                )}
                                            </p>
                                            <CopyTextBox
                                                text={`ports:
  - ${tcpUdpForm.getValues("proxyPort")}:${tcpUdpForm.getValues("proxyPort")}${tcpUdpForm.getValues("protocol") === "tcp" ? "" : "/" + tcpUdpForm.getValues("protocol")}`}
                                                wrapText={false}
                                            />
                                        </div>

                                        <Link
                                            className="text-sm text-primary flex items-center gap-1"
                                            href="https://docs.pangolin.net/manage/resources/public/raw-resources"
                                            target="_blank"
                                            rel="noopener noreferrer"
                                        >
                                            <span>{t("resourceLearnRaw")}</span>
                                            <SquareArrowOutUpRight size={14} />
                                        </Link>
                                    </div>
                                </SettingsSectionBody>
                            </SettingsSection>

                            <div className="flex justify-end space-x-2 mt-8">
                                <Button
                                    type="button"
                                    variant="outline"
                                    onClick={() =>
                                        router.push(
                                            `/${orgId}/settings/resources`
                                        )
                                    }
                                >
                                    {t("resourceBack")}
                                </Button>
                                <Button
                                    type="button"
                                    onClick={() =>
                                        router.push(
                                            `/${orgId}/settings/resources/proxy/${niceId}/proxy`
                                        )
                                    }
                                >
                                    {t("resourceGoTo")}
                                </Button>
                            </div>
                        </SettingsContainer>
                    )}
                </div>
            )}
        </>
    );
}
