"use client";

import { useEffect, useState, use } from "react";
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
import { AxiosResponse } from "axios";
import { ListTargetsResponse } from "@server/routers/target/listTargets";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
    Form,
    FormControl,
    FormDescription,
    FormField,
    FormItem,
    FormLabel,
    FormMessage
} from "@app/components/ui/form";
import { CreateTargetResponse } from "@server/routers/target";
import {
    ColumnDef,
    getFilteredRowModel,
    getSortedRowModel,
    getPaginationRowModel,
    getCoreRowModel,
    useReactTable,
    flexRender,
    Row
} from "@tanstack/react-table";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow
} from "@app/components/ui/table";
import { toast } from "@app/hooks/useToast";
import { useResourceContext } from "@app/hooks/useResourceContext";
import { ArrayElement } from "@server/types/ArrayElement";
import { formatAxiosError } from "@app/lib/api/formatAxiosError";
import { useEnvContext } from "@app/hooks/useEnvContext";
import { createApiClient } from "@app/lib/api";
import { GetSiteResponse, ListSitesResponse } from "@server/routers/site";
import {
    SettingsContainer,
    SettingsSection,
    SettingsSectionHeader,
    SettingsSectionTitle,
    SettingsSectionDescription,
    SettingsSectionBody,
    SettingsSectionForm
} from "@app/components/Settings";
import { SwitchInput } from "@app/components/SwitchInput";
import { useRouter } from "next/navigation";
import { isTargetValid } from "@server/lib/validators";
import { tlsNameSchema } from "@server/lib/schemas";
import {
    CheckIcon,
    ChevronsUpDown,
    Settings,
    Heart,
    Check,
    CircleCheck,
    CircleX,
    ArrowRight,
    Plus,
    MoveRight,
    ArrowUp,
    Info,
    ArrowDown,
    AlertTriangle
} from "lucide-react";
import { ContainersSelector } from "@app/components/ContainersSelector";
import { useTranslations } from "next-intl";
import { build } from "@server/build";
import HealthCheckDialog from "@/components/HealthCheckDialog";
import { DockerManager, DockerState } from "@app/lib/docker";
import { Container } from "@server/routers/site";
import {
    Popover,
    PopoverContent,
    PopoverTrigger
} from "@app/components/ui/popover";
import { cn } from "@app/lib/cn";
import { CaretSortIcon } from "@radix-ui/react-icons";
import {
    Command,
    CommandEmpty,
    CommandGroup,
    CommandInput,
    CommandItem,
    CommandList
} from "@app/components/ui/command";
import { parseHostTarget } from "@app/lib/parseHostTarget";
import { HeadersInput } from "@app/components/HeadersInput";
import {
    PathMatchDisplay,
    PathMatchModal,
    PathRewriteDisplay,
    PathRewriteModal
} from "@app/components/PathMatchRenameModal";
import { Badge } from "@app/components/ui/badge";
import {
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger
} from "@app/components/ui/tooltip";
import { Alert, AlertDescription } from "@app/components/ui/alert";

const addTargetSchema = z
    .object({
        ip: z.string().refine(isTargetValid),
        method: z.string().nullable(),
        port: z.coerce.number().int().positive(),
        siteId: z
            .number()
            .int()
            .positive({ message: "You must select a site for a target." }),
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
        priority: z.number().int().min(1).max(1000).optional()
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
            message: "Invalid path configuration"
        }
    )
    .refine(
        (data) => {
            // If rewritePath is provided, rewritePathType must be provided
            if (data.rewritePath && !data.rewritePathType) {
                return false;
            }
            // If rewritePathType is provided, rewritePath must be provided
            if (data.rewritePathType && !data.rewritePath) {
                return false;
            }
            return true;
        },
        {
            message: "Invalid rewrite path configuration"
        }
    );

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

export default function ReverseProxyTargets(props: {
    params: Promise<{ resourceId: number; orgId: string }>;
}) {
    const params = use(props.params);
    const t = useTranslations();
    const { env } = useEnvContext();

    const { resource, updateResource } = useResourceContext();

    const api = createApiClient(useEnvContext());

    const [targets, setTargets] = useState<LocalTarget[]>([]);
    const [targetsToRemove, setTargetsToRemove] = useState<number[]>([]);
    const [sites, setSites] = useState<ListSitesResponse["sites"]>([]);
    const [dockerStates, setDockerStates] = useState<Map<number, DockerState>>(
        new Map()
    );

    const initializeDockerForSite = async (siteId: number) => {
        if (dockerStates.has(siteId)) {
            return; // Already initialized
        }

        const dockerManager = new DockerManager(api, siteId);
        const dockerState = await dockerManager.initializeDocker();

        setDockerStates((prev) => new Map(prev.set(siteId, dockerState)));
    };

    const refreshContainersForSite = async (siteId: number) => {
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
    };

    const getDockerStateForSite = (siteId: number): DockerState => {
        return (
            dockerStates.get(siteId) || {
                isEnabled: false,
                isAvailable: false,
                containers: []
            }
        );
    };

    const [httpsTlsLoading, setHttpsTlsLoading] = useState(false);
    const [targetsLoading, setTargetsLoading] = useState(false);
    const [proxySettingsLoading, setProxySettingsLoading] = useState(false);

    const [pageLoading, setPageLoading] = useState(true);
    const [isAdvancedOpen, setIsAdvancedOpen] = useState(false);
    const [isAdvancedMode, setIsAdvancedMode] = useState(() => {
        if (typeof window !== "undefined") {
            const saved = localStorage.getItem("proxy-advanced-mode");
            return saved === "true";
        }
        return false;
    });
    const [healthCheckDialogOpen, setHealthCheckDialogOpen] = useState(false);
    const [selectedTargetForHealthCheck, setSelectedTargetForHealthCheck] =
        useState<LocalTarget | null>(null);
    const router = useRouter();

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
        proxyProtocolVersion: z.number().int().min(1).max(2).optional()
    });

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

    type ProxySettingsValues = z.infer<typeof proxySettingsSchema>;
    type TlsSettingsValues = z.infer<typeof tlsSettingsSchema>;
    type TargetsSettingsValues = z.infer<typeof targetsSettingsSchema>;

    const tlsSettingsForm = useForm({
        resolver: zodResolver(tlsSettingsSchema),
        defaultValues: {
            ssl: resource.ssl,
            tlsServerName: resource.tlsServerName || ""
        }
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

    const targetsSettingsForm = useForm({
        resolver: zodResolver(targetsSettingsSchema),
        defaultValues: {
            stickySession: resource.stickySession
        }
    });

    useEffect(() => {
        const fetchTargets = async () => {
            try {
                const res = await api.get<AxiosResponse<ListTargetsResponse>>(
                    `/resource/${resource.resourceId}/targets`
                );

                if (res.status === 200) {
                    setTargets(res.data.data.targets);
                }
            } catch (err) {
                console.error(err);
                toast({
                    variant: "destructive",
                    title: t("targetErrorFetch"),
                    description: formatAxiosError(
                        err,
                        t("targetErrorFetchDescription")
                    )
                });
            } finally {
                setPageLoading(false);
            }
        };
        fetchTargets();

        const fetchSites = async () => {
            const res = await api
                .get<
                    AxiosResponse<ListSitesResponse>
                >(`/org/${params.orgId}/sites`)
                .catch((e) => {
                    toast({
                        variant: "destructive",
                        title: t("sitesErrorFetch"),
                        description: formatAxiosError(
                            e,
                            t("sitesErrorFetchDescription")
                        )
                    });
                });

            if (res?.status === 200) {
                setSites(res.data.data.sites);

                // Initialize Docker for newt sites
                const newtSites = res.data.data.sites.filter(
                    (site) => site.type === "newt"
                );
                for (const site of newtSites) {
                    initializeDockerForSite(site.siteId);
                }

                // Sites loaded successfully
            }
        };
        fetchSites();

        // const fetchSite = async () => {
        //     try {
        //         const res = await api.get<AxiosResponse<GetSiteResponse>>(
        //             `/site/${resource.siteId}`
        //         );
        //
        //         if (res.status === 200) {
        //             setSite(res.data.data);
        //         }
        //     } catch (err) {
        //         console.error(err);
        //         toast({
        //             variant: "destructive",
        //             title: t("siteErrorFetch"),
        //             description: formatAxiosError(
        //                 err,
        //                 t("siteErrorFetchDescription")
        //             )
        //         });
        //     }
        // };
        // fetchSite();
    }, []);

    // Save advanced mode preference to localStorage
    useEffect(() => {
        if (typeof window !== "undefined") {
            localStorage.setItem(
                "proxy-advanced-mode",
                isAdvancedMode.toString()
            );
        }
    }, [isAdvancedMode]);

    function addNewTarget() {
        const isHttp = resource.http;

        const newTarget: LocalTarget = {
            targetId: -Date.now(), // Use negative timestamp as temporary ID
            ip: "",
            method: isHttp ? "http" : null,
            port: 0,
            siteId: sites.length > 0 ? sites[0].siteId : 0,
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
            siteType: sites.length > 0 ? sites[0].type : null,
            new: true,
            updated: false
        };

        setTargets((prev) => [...prev, newTarget]);
    }

    async function saveNewTarget(target: LocalTarget) {
        // Validate the target
        if (!isTargetValid(target.ip)) {
            toast({
                variant: "destructive",
                title: t("targetErrorInvalidIp"),
                description: t("targetErrorInvalidIpDescription")
            });
            return;
        }

        if (!target.port || target.port <= 0) {
            toast({
                variant: "destructive",
                title: t("targetErrorInvalidPort"),
                description: t("targetErrorInvalidPortDescription")
            });
            return;
        }

        if (!target.siteId) {
            toast({
                variant: "destructive",
                title: t("targetErrorNoSite"),
                description: t("targetErrorNoSiteDescription")
            });
            return;
        }

        try {
            setTargetsLoading(true);

            const data: any = {
                resourceId: resource.resourceId,
                siteId: target.siteId,
                ip: target.ip,
                method: target.method,
                port: target.port,
                enabled: target.enabled,
                hcEnabled: target.hcEnabled,
                hcPath: target.hcPath,
                hcInterval: target.hcInterval,
                hcTimeout: target.hcTimeout
            };

            // Only include path-related fields for HTTP resources
            if (resource.http) {
                data.path = target.path;
                data.pathMatchType = target.pathMatchType;
                data.rewritePath = target.rewritePath;
                data.rewritePathType = target.rewritePathType;
                data.priority = target.priority;
            }

            const response = await api.post<
                AxiosResponse<CreateTargetResponse>
            >(`/target`, data);

            if (response.status === 200) {
                // Update the target with the new ID and remove the new flag
                setTargets((prev) =>
                    prev.map((t) =>
                        t.targetId === target.targetId
                            ? {
                                ...t,
                                targetId: response.data.data.targetId,
                                new: false,
                                updated: false
                            }
                            : t
                    )
                );

                toast({
                    title: t("targetCreated"),
                    description: t("targetCreatedDescription")
                });
            }
        } catch (err) {
            console.error(err);
            toast({
                variant: "destructive",
                title: t("targetErrorCreate"),
                description: formatAxiosError(
                    err,
                    t("targetErrorCreateDescription")
                )
            });
        } finally {
            setTargetsLoading(false);
        }
    }

    async function addTarget(data: z.infer<typeof addTargetSchema>) {
        // if (site && site.type == "wireguard" && site.subnet) {
        //     // make sure that the target IP is within the site subnet
        //     const targetIp = data.ip;
        //     const subnet = site.subnet;
        //     try {
        //         if (!isIPInSubnet(targetIp, subnet)) {
        //             toast({
        //                 variant: "destructive",
        //                 title: t("targetWireGuardErrorInvalidIp"),
        //                 description: t(
        //                     "targetWireGuardErrorInvalidIpDescription"
        //                 )
        //             });
        //             return;
        //         }
        //     } catch (error) {
        //         console.error(error);
        //         toast({
        //             variant: "destructive",
        //             title: t("targetWireGuardErrorInvalidIp"),
        //             description: t("targetWireGuardErrorInvalidIpDescription")
        //         });
        //         return;
        //     }
        // }

        const site = sites.find((site) => site.siteId === data.siteId);
        const isHttp = resource.http;

        const newTarget: LocalTarget = {
            ...data,
            path: isHttp ? (data.path || null) : null,
            pathMatchType: isHttp ? (data.pathMatchType || null) : null,
            rewritePath: isHttp ? (data.rewritePath || null) : null,
            rewritePathType: isHttp ? (data.rewritePathType || null) : null,
            siteType: site?.type || null,
            enabled: true,
            targetId: new Date().getTime(),
            new: true,
            resourceId: resource.resourceId,
            priority: isHttp ? (data.priority || 100) : 100,
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
            hcUnhealthyInterval: null
        };

        setTargets([...targets, newTarget]);
    }

    const removeTarget = (targetId: number) => {
        setTargets([
            ...targets.filter((target) => target.targetId !== targetId)
        ]);

        if (!targets.find((target) => target.targetId === targetId)?.new) {
            setTargetsToRemove([...targetsToRemove, targetId]);
        }
    };

    async function updateTarget(targetId: number, data: Partial<LocalTarget>) {
        const site = sites.find((site) => site.siteId === data.siteId);
        setTargets(
            targets.map((target) =>
                target.targetId === targetId
                    ? {
                        ...target,
                        ...data,
                        updated: true,
                        siteType: site ? site.type : target.siteType
                    }
                    : target
            )
        );
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

    const openHealthCheckDialog = (target: LocalTarget) => {
        console.log(target);
        setSelectedTargetForHealthCheck(target);
        setHealthCheckDialogOpen(true);
    };

    async function saveAllSettings() {
        // Validate that no targets have blank IPs or invalid ports
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
            setTargetsLoading(true);
            setHttpsTlsLoading(true);
            setProxySettingsLoading(true);

            for (const targetId of targetsToRemove) {
                await api.delete(`/target/${targetId}`);
            }

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
                    hcStatus: target.hcStatus || null
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

            if (resource.http) {
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
            } else {
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
            }

            toast({
                title: t("settingsUpdated"),
                description: t("settingsUpdatedDescription")
            });

            setTargetsToRemove([]);
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
        } finally {
            setTargetsLoading(false);
            setHttpsTlsLoading(false);
            setProxySettingsLoading(false);
        }
    }

    const getColumns = (): ColumnDef<LocalTarget>[] => {
        const baseColumns: ColumnDef<LocalTarget>[] = [];
        const isHttp = resource.http;

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
            header: () => (<span className="p-3">{t("healthCheck")}</span>),
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
                                className="flex items-center justify-between gap-2 p-2 w-full text-left cursor-pointer"
                                onClick={() =>
                                    openHealthCheckDialog(row.original)
                                }
                            >
                                <Badge variant={getStatusColor(status)}>
                                    <div className="flex items-center gap-1">
                                        {getStatusIcon(status)}
                                        {getStatusText(status)}
                                    </div>
                                </Badge>
                                <Settings className="h-4 w-4" />
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
            header: () => (<span className="p-3">{t("matchPath")}</span>),
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
                                    updateTarget(row.original.targetId, config)
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
                                    updateTarget(row.original.targetId, config)
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
            header: () => (<span className="p-3">{t("address")}</span>),
            cell: ({ row }) => {
                const selectedSite = sites.find(
                    (site) => site.siteId === row.original.siteId
                );

                const handleContainerSelectForTarget = (
                    hostname: string,
                    port?: number
                ) => {
                    updateTarget(row.original.targetId, {
                        ...row.original,
                        ip: hostname,
                        ...(port && { port: port })
                    });
                };

                return (
                    <div className="flex items-center w-full">
                        <div className="flex items-center w-full justify-start py-0 space-x-2 px-0 cursor-default border border-input rounded-md">
                            {selectedSite &&
                                selectedSite.type === "newt" &&
                                (() => {
                                    const dockerState = getDockerStateForSite(
                                        selectedSite.siteId
                                    );
                                    return (
                                        <ContainersSelector
                                            site={selectedSite}
                                            containers={dockerState.containers}
                                            isAvailable={
                                                dockerState.isAvailable
                                            }
                                            onContainerSelect={
                                                handleContainerSelectForTarget
                                            }
                                            onRefresh={() =>
                                                refreshContainersForSite(
                                                    selectedSite.siteId
                                                )
                                            }
                                        />
                                    );
                                })()}

                            <Popover>
                                <PopoverTrigger asChild>
                                    <Button
                                        variant="ghost"
                                        role="combobox"
                                        className={cn(
                                            "w-[180px] justify-between text-sm border-r pr-4 rounded-none h-8 hover:bg-transparent",
                                            !row.original.siteId &&
                                            "text-muted-foreground"
                                        )}
                                    >
                                        <span className="truncate max-w-[150px]">
                                            {row.original.siteId
                                                ? selectedSite?.name
                                                : t("siteSelect")}
                                        </span>
                                        <CaretSortIcon className="ml-2h-4 w-4 shrink-0 opacity-50" />
                                    </Button>
                                </PopoverTrigger>
                                <PopoverContent className="p-0 w-[180px]">
                                    <Command>
                                        <CommandInput
                                            placeholder={t("siteSearch")}
                                        />
                                        <CommandList>
                                            <CommandEmpty>
                                                {t("siteNotFound")}
                                            </CommandEmpty>
                                            <CommandGroup>
                                                {sites.map((site) => (
                                                    <CommandItem
                                                        key={site.siteId}
                                                        value={`${site.siteId}:${site.name}`}
                                                        onSelect={() =>
                                                            updateTarget(
                                                                row.original
                                                                    .targetId,
                                                                {
                                                                    siteId: site.siteId
                                                                }
                                                            )
                                                        }
                                                    >
                                                        <CheckIcon
                                                            className={cn(
                                                                "mr-2 h-4 w-4",
                                                                site.siteId ===
                                                                    row.original
                                                                        .siteId
                                                                    ? "opacity-100"
                                                                    : "opacity-0"
                                                            )}
                                                        />
                                                        {site.name}
                                                    </CommandItem>
                                                ))}
                                            </CommandGroup>
                                        </CommandList>
                                    </Command>
                                </PopoverContent>
                            </Popover>

                            {resource.http && (
                                <Select
                                    defaultValue={row.original.method ?? "http"}
                                    onValueChange={(value) =>
                                        updateTarget(row.original.targetId, {
                                            ...row.original,
                                            method: value
                                        })
                                    }
                                >
                                    <SelectTrigger className="h-8 px-2 w-[70px] text-sm font-normal border-none bg-transparent shadow-none focus:ring-0 focus:outline-none focus-visible:ring-0 data-[state=open]:bg-transparent">
                                        {row.original.method || "http"}
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="http">http</SelectItem>
                                        <SelectItem value="https">https</SelectItem>
                                        <SelectItem value="h2c">h2c</SelectItem>
                                    </SelectContent>
                                </Select>
                            )}

                            {resource.http && (
                                <div className="flex items-center justify-center bg-muted px-2 h-9">
                                    {"://"}
                                </div>
                            )}

                            <Input
                                defaultValue={row.original.ip}
                                placeholder="IP / Hostname"
                                className="flex-1 min-w-[120px] pl-0 border-none placeholder-gray-400"
                                onBlur={(e) => {
                                    const input = e.target.value.trim();
                                    const hasProtocol =
                                        /^(https?|h2c):\/\//.test(input);
                                    const hasPort = /:\d+(?:\/|$)/.test(input);

                                    if (hasProtocol || hasPort) {
                                        const parsed = parseHostTarget(input);
                                        if (parsed) {
                                            updateTarget(
                                                row.original.targetId,
                                                {
                                                    ...row.original,
                                                    method: hasProtocol
                                                        ? parsed.protocol
                                                        : row.original.method,
                                                    ip: parsed.host,
                                                    port: hasPort
                                                        ? parsed.port
                                                        : row.original.port
                                                }
                                            );
                                        } else {
                                            updateTarget(
                                                row.original.targetId,
                                                {
                                                    ...row.original,
                                                    ip: input
                                                }
                                            );
                                        }
                                    } else {
                                        updateTarget(row.original.targetId, {
                                            ...row.original,
                                            ip: input
                                        });
                                    }
                                }}
                            />
                            <div className="flex items-center justify-center bg-muted px-2 h-9">
                                {":"}
                            </div>
                            <Input
                                placeholder="Port"
                                defaultValue={
                                    row.original.port === 0
                                        ? ""
                                        : row.original.port
                                }
                                className="w-[75px] pl-0 border-none placeholder-gray-400"
                                onBlur={(e) => {
                                    const value = parseInt(e.target.value, 10);
                                    if (!isNaN(value) && value > 0) {
                                        updateTarget(row.original.targetId, {
                                            ...row.original,
                                            port: value
                                        });
                                    } else {
                                        updateTarget(row.original.targetId, {
                                            ...row.original,
                                            port: 0
                                        });
                                    }
                                }}
                            />
                        </div>
                    </div>
                );
            },
            size: 400,
            minSize: 350,
            maxSize: 500
        };

        const rewritePathColumn: ColumnDef<LocalTarget> = {
            accessorKey: "rewritePath",
            header: () => (<span className="p-3">{t("rewritePath")}</span>),
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
            header: () => (<span className="p-3">{t("enabled")}</span>),
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
            header: () => (<span className="p-3">{t("actions")}</span>),
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
    };

    const columns = getColumns();

    const table = useReactTable({
        data: targets,
        columns,
        getCoreRowModel: getCoreRowModel(),
        getPaginationRowModel: getPaginationRowModel(),
        getSortedRowModel: getSortedRowModel(),
        getFilteredRowModel: getFilteredRowModel(),
        state: {
            pagination: {
                pageIndex: 0,
                pageSize: 1000
            }
        }
    });

    if (pageLoading) {
        return <></>;
    }

    return (
        <SettingsContainer>
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
                                        {table.getRowModel().rows?.length ? (
                                            table
                                                .getRowModel()
                                                .rows.map((row) => (
                                                    <TableRow key={row.id}>
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
            </SettingsSection>

            {resource.http && (
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
                                    onSubmit={tlsSettingsForm.handleSubmit(
                                        saveAllSettings
                                    )}
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
                                                            label={t(
                                                                "proxyEnableSSL"
                                                            )}
                                                            description={t(
                                                                "proxyEnableSSLDescription"
                                                            )}
                                                            defaultChecked={
                                                                field.value
                                                            }
                                                            onCheckedChange={(
                                                                val
                                                            ) => {
                                                                field.onChange(
                                                                    val
                                                                );
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
                                                    {t(
                                                        "targetTlsSniDescription"
                                                    )}
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
                                    onSubmit={targetsSettingsForm.handleSubmit(
                                        saveAllSettings
                                    )}
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
                                                        defaultChecked={
                                                            field.value
                                                        }
                                                        onCheckedChange={(
                                                            val
                                                        ) => {
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
                                    onSubmit={proxySettingsForm.handleSubmit(
                                        saveAllSettings
                                    )}
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
                                                    {t(
                                                        "proxyCustomHeaderDescription"
                                                    )}
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
                                                            field.onChange(
                                                                value
                                                            );
                                                        }}
                                                        rows={4}
                                                    />
                                                </FormControl>
                                                <FormDescription>
                                                    {t(
                                                        "customHeadersDescription"
                                                    )}
                                                </FormDescription>
                                                <FormMessage />
                                            </FormItem>
                                        )}
                                    />
                                </form>
                            </Form>
                        </SettingsSectionForm>
                    </SettingsSectionBody>
                </SettingsSection>
            )}

            {!resource.http && resource.protocol == "tcp" && (
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
                                    onSubmit={proxySettingsForm.handleSubmit(
                                        saveAllSettings
                                    )}
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
                                                        label={t(
                                                            "enableProxyProtocol"
                                                        )}
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
                                                        <FormLabel>{t("proxyProtocolVersion")}</FormLabel>
                                                        <FormControl>
                                                            <Select
                                                                value={String(field.value || 1)}
                                                                onValueChange={(value) =>
                                                                    field.onChange(parseInt(value, 10))
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
                                                    <strong>{t("warning")}:</strong> {t("proxyProtocolWarning")}
                                                </AlertDescription>
                                            </Alert>
                                        </>
                                    )}
                                </form>
                            </Form>
                        </SettingsSectionForm>
                    </SettingsSectionBody>
                </SettingsSection>
            )}

            <div className="flex justify-end mt-6">
                <Button
                    onClick={saveAllSettings}
                    loading={
                        targetsLoading ||
                        httpsTlsLoading ||
                        proxySettingsLoading
                    }
                    disabled={
                        targetsLoading ||
                        httpsTlsLoading ||
                        proxySettingsLoading
                    }
                >
                    {t("saveSettings")}
                </Button>
            </div>

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
                            30
                    }}
                    onChanges={async (config) => {
                        if (selectedTargetForHealthCheck) {
                            console.log(config);
                            updateTargetHealthCheck(
                                selectedTargetForHealthCheck.targetId,
                                config
                            );
                        }
                    }}
                />
            )}
        </SettingsContainer>
    );
}

function isIPInSubnet(subnet: string, ip: string): boolean {
    const [subnetIP, maskBits] = subnet.split("/");
    const mask = parseInt(maskBits);

    if (mask < 0 || mask > 32) {
        throw new Error("subnetMaskErrorInvalid");
    }

    // Convert IP addresses to binary numbers
    const subnetNum = ipToNumber(subnetIP);
    const ipNum = ipToNumber(ip);

    // Calculate subnet mask
    const maskNum = mask === 32 ? -1 : ~((1 << (32 - mask)) - 1);

    // Check if the IP is in the subnet
    return (subnetNum & maskNum) === (ipNum & maskNum);
}

function ipToNumber(ip: string): number {
    // Validate IP address format
    const parts = ip.split(".");

    if (parts.length !== 4) {
        throw new Error("ipAddressErrorInvalidFormat");
    }

    // Convert IP octets to 32-bit number
    return parts.reduce((num, octet) => {
        const oct = parseInt(octet);
        if (isNaN(oct) || oct < 0 || oct > 255) {
            throw new Error("ipAddressErrorInvalidOctet");
        }
        return (num << 8) + oct;
    }, 0);
}
