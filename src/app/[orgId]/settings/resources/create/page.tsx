"use client";

import {
    SettingsContainer,
    SettingsSection,
    SettingsSectionBody,
    SettingsSectionDescription,
    SettingsSectionForm,
    SettingsSectionHeader,
    SettingsSectionTitle
} from "@app/components/Settings";
import {
    Form,
    FormControl,
    FormDescription,
    FormField,
    FormItem,
    FormLabel,
    FormMessage
} from "@app/components/ui/form";
import HeaderTitle from "@app/components/SettingsSectionTitle";
import { z } from "zod";
import { useEffect, useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Input } from "@app/components/ui/input";
import { Button } from "@app/components/ui/button";
import { useParams, useRouter } from "next/navigation";
import { ListSitesResponse } from "@server/routers/site";
import { formatAxiosError } from "@app/lib/api";
import { createApiClient } from "@app/lib/api";
import { useEnvContext } from "@app/hooks/useEnvContext";
import { toast } from "@app/hooks/useToast";
import { AxiosResponse } from "axios";
import { Resource } from "@server/db";
import { StrategySelect } from "@app/components/StrategySelect";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue
} from "@app/components/ui/select";
import { ListDomainsResponse } from "@server/routers/domain";
import {
    Command,
    CommandEmpty,
    CommandGroup,
    CommandInput,
    CommandItem,
    CommandList
} from "@app/components/ui/command";
import {
    Popover,
    PopoverContent,
    PopoverTrigger
} from "@app/components/ui/popover";
import { CaretSortIcon, CheckIcon } from "@radix-ui/react-icons";
import { cn } from "@app/lib/cn";
import {
    ArrowRight,
    CircleCheck,
    CircleX,
    Info,
    MoveRight,
    Plus,
    Settings,
    SquareArrowOutUpRight
} from "lucide-react";
import CopyTextBox from "@app/components/CopyTextBox";
import Link from "next/link";
import { useTranslations } from "next-intl";
import DomainPicker from "@app/components/DomainPicker";
import { build } from "@server/build";
import { ContainersSelector } from "@app/components/ContainersSelector";
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
import { Switch } from "@app/components/ui/switch";
import { ArrayElement } from "@server/types/ArrayElement";
import { isTargetValid } from "@server/lib/validators";
import { ListTargetsResponse } from "@server/routers/target";
import { DockerManager, DockerState } from "@app/lib/docker";
import { parseHostTarget } from "@app/lib/parseHostTarget";
import { toASCII, toUnicode } from "punycode";
import { DomainRow } from "../../../../../components/DomainsTable";
import { finalizeSubdomainSanitize } from "@app/lib/subdomain-utils";
import {
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger
} from "@app/components/ui/tooltip";
import {
    PathMatchDisplay,
    PathMatchModal,
    PathRewriteDisplay,
    PathRewriteModal
} from "@app/components/PathMatchRenameModal";
import { Badge } from "@app/components/ui/badge";
import HealthCheckDialog from "@app/components/HealthCheckDialog";
import { SwitchInput } from "@app/components/SwitchInput";

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
    proxyPort: z.number().int().min(1).max(65535)
    // enableProxy: z.boolean().default(false)
});

const addTargetSchema = z
    .object({
        ip: z.string().refine(isTargetValid),
        method: z.string().nullable(),
        port: z.coerce.number().int().positive(),
        siteId: z.number().int().positive(),
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

type BaseResourceFormValues = z.infer<typeof baseResourceFormSchema>;
type HttpResourceFormValues = z.infer<typeof httpResourceFormSchema>;
type TcpUdpResourceFormValues = z.infer<typeof tcpUdpResourceFormSchema>;

type ResourceType = "http" | "raw";

interface ResourceTypeOption {
    id: ResourceType;
    title: string;
    description: string;
    disabled?: boolean;
}

type LocalTarget = Omit<
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

    const [loadingPage, setLoadingPage] = useState(true);
    const [sites, setSites] = useState<ListSitesResponse["sites"]>([]);
    const [baseDomains, setBaseDomains] = useState<
        { domainId: string; baseDomain: string }[]
    >([]);
    const [createLoading, setCreateLoading] = useState(false);
    const [showSnippets, setShowSnippets] = useState(false);
    const [niceId, setNiceId] = useState<string>("");

    // Target management state
    const [targets, setTargets] = useState<LocalTarget[]>([]);
    const [targetsToRemove, setTargetsToRemove] = useState<number[]>([]);
    const [dockerStates, setDockerStates] = useState<Map<number, DockerState>>(
        new Map()
    );

    const [selectedTargetForHealthCheck, setSelectedTargetForHealthCheck] =
        useState<LocalTarget | null>(null);
    const [healthCheckDialogOpen, setHealthCheckDialogOpen] = useState(false);

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
            : [
                  {
                      id: "raw" as ResourceType,
                      title: t("resourceRaw"),
                      description: t("resourceRawDescription")
                  }
              ])
    ];

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

    async function addTarget(data: z.infer<typeof addTargetSchema>) {
        const site = sites.find((site) => site.siteId === data.siteId);

        const isHttp = baseForm.watch("http");

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
            resourceId: 0, // Will be set when resource is created
            priority: isHttp ? (data.priority || 100) : 100, // Default priority
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
        addTargetForm.reset({
            ip: "",
            method: baseForm.watch("http") ? "http" : null,
            port: "" as any as number,
            path: null,
            pathMatchType: null,
            rewritePath: null,
            rewritePathType: null,
            priority: isHttp ? 100 : undefined
        });
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

    async function onSubmit() {
        setCreateLoading(true);

        const baseData = baseForm.getValues();
        const isHttp = baseData.http;

        try {
            const payload = {
                name: baseData.name,
                http: baseData.http,
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
                                hcStatus: target.hcStatus || null
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
                    router.push(`/${orgId}/settings/resources/${niceId}`);
                } else {
                    const tcpUdpData = tcpUdpForm.getValues();
                    // Only show config snippets if enableProxy is explicitly true
                    // if (tcpUdpData.enableProxy === true) {
                    setShowSnippets(true);
                    router.refresh();
                    // } else {
                    //     // If enableProxy is false or undefined, go directly to resource page
                    //     router.push(`/${orgId}/settings/resources/${id}`);
                    // }
                }
            }
        } catch (e) {
            console.error(t("resourceErrorCreateMessage"), e);
            toast({
                variant: "destructive",
                title: t("resourceErrorCreate"),
                description: t("resourceErrorCreateMessageDescription")
            });
        }

        setCreateLoading(false);
    }

    useEffect(() => {
        const load = async () => {
            setLoadingPage(true);

            const fetchSites = async () => {
                const res = await api
                    .get<
                        AxiosResponse<ListSitesResponse>
                    >(`/org/${orgId}/sites/`)
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
                    for (const site of res.data.data.sites) {
                        if (site.type === "newt") {
                            initializeDockerForSite(site.siteId);
                        }
                    }

                    // If there's only one site, set it as the default in the form
                    if (res.data.data.sites.length) {
                        addTargetForm.setValue(
                            "siteId",
                            res.data.data.sites[0].siteId
                        );
                    }
                }
            };

            const fetchDomains = async () => {
                const res = await api
                    .get<
                        AxiosResponse<ListDomainsResponse>
                    >(`/org/${orgId}/domains/`)
                    .catch((e) => {
                        toast({
                            variant: "destructive",
                            title: t("domainsErrorFetch"),
                            description: formatAxiosError(
                                e,
                                t("domainsErrorFetchDescription")
                            )
                        });
                    });

                if (res?.status === 200) {
                    const rawDomains = res.data.data.domains as DomainRow[];
                    const domains = rawDomains.map((domain) => ({
                        ...domain,
                        baseDomain: toUnicode(domain.baseDomain)
                    }));
                    setBaseDomains(domains);
                    // if (domains.length) {
                    //     httpForm.setValue("domainId", domains[0].domainId);
                    // }
                }
            };

            await fetchSites();
            await fetchDomains();

            setLoadingPage(false);
        };

        load();
    }, []);

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

    const openHealthCheckDialog = (target: LocalTarget) => {
        console.log(target);
        setSelectedTargetForHealthCheck(target);
        setHealthCheckDialogOpen(true);
    };

    const getColumns = (): ColumnDef<LocalTarget>[] => {
        const baseColumns: ColumnDef<LocalTarget>[] = [];
        const isHttp = baseForm.watch("http");

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
            header: t("healthCheck"),
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
            header: t("matchPath"),
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
            header: t("address"),
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
                        <div className="flex items-center w-full justify-start py-0 space-x-2 px-0 cursor-default border border-input shadow-2xs rounded-md">
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

                            {isHttp && (
                                <Select
                                    defaultValue={row.original.method ?? "http"}
                                    onValueChange={(value) =>
                                        updateTarget(row.original.targetId, {
                                            ...row.original,
                                            method: value
                                        })
                                    }
                                >
                                    <SelectTrigger className="h-8 px-2 w-[70px] border-none bg-transparent shadow-none focus:ring-0 focus:outline-none focus-visible:ring-0 data-[state=open]:bg-transparent">
                                        {row.original.method || "http"}
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="http">http</SelectItem>
                                        <SelectItem value="https">https</SelectItem>
                                        <SelectItem value="h2c">h2c</SelectItem>
                                    </SelectContent>
                                </Select>
                            )}

                            {isHttp && (
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
            header: t("rewritePath"),
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
            header: t("enabled"),
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

                            {resourceTypes.length > 1 && (
                                <SettingsSection>
                                    <SettingsSectionHeader>
                                        <SettingsSectionTitle>
                                            {t("resourceType")}
                                        </SettingsSectionTitle>
                                        <SettingsSectionDescription>
                                            {t("resourceTypeDescription")}
                                        </SettingsSectionDescription>
                                    </SettingsSectionHeader>
                                    <SettingsSectionBody>
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
                                    </SettingsSectionBody>
                                </SettingsSection>
                            )}

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
                                            onDomainChange={(res) => {
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
                                        <SettingsSectionForm>
                                            <Form {...tcpUdpForm}>
                                                <form
                                                    onKeyDown={(e) => {
                                                        if (e.key === "Enter") {
                                                            e.preventDefault(); // block default enter refresh
                                                        }
                                                    }}
                                                    className="space-y-4"
                                                    id="tcp-udp-settings-form"
                                                >
                                                    <Controller
                                                        control={
                                                            tcpUdpForm.control
                                                        }
                                                        name="protocol"
                                                        render={({ field }) => (
                                                            <FormItem>
                                                                <FormLabel>
                                                                    {t(
                                                                        "protocol"
                                                                    )}
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
                                                        control={
                                                            tcpUdpForm.control
                                                        }
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

                                                    {/* {build == "oss" && (
                                                        <FormField
                                                            control={
                                                                tcpUdpForm.control
                                                            }
                                                            name="enableProxy"
                                                            render={({
                                                                field
                                                            }) => (
                                                                <FormItem className="flex flex-row items-start space-x-3 space-y-0">
                                                                    <FormControl>
                                                                        <Checkbox
                                                                            variant={
                                                                                "outlinePrimarySquare"
                                                                            }
                                                                            checked={
                                                                                field.value
                                                                            }
                                                                            onCheckedChange={
                                                                                field.onChange
                                                                            }
                                                                        />
                                                                    </FormControl>
                                                                    <div className="space-y-1 leading-none">
                                                                        <FormLabel>
                                                                            {t(
                                                                                "resourceEnableProxy"
                                                                            )}
                                                                        </FormLabel>
                                                                        <FormDescription>
                                                                            {t(
                                                                                "resourceEnableProxyDescription"
                                                                            )}
                                                                        </FormDescription>
                                                                    </div>
                                                                </FormItem>
                                                            )}
                                                        />
                                                    )} */}
                                                </form>
                                            </Form>
                                        </SettingsSectionForm>
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
                                                                            ) => (
                                                                                <TableHead
                                                                                    key={
                                                                                        header.id
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
                                                                            )
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
                                                                                    ) => (
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
                                                                                    )
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
                                            30
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
                                            href="https://docs.pangolin.net/manage/resources/tcp-udp-resources"
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
                                            `/${orgId}/settings/resources/${niceId}/proxy`
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
