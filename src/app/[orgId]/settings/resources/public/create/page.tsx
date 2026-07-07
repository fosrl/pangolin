"use client";

import CopyTextBox from "@app/components/CopyTextBox";
import DomainPicker from "@app/components/DomainPicker";
import {
    SettingsContainer,
    SettingsFormCell,
    SettingsFormGrid,
    SettingsSection,
    SettingsSectionBody,
    SettingsSectionDescription,
    SettingsSectionForm,
    SettingsSectionHeader,
    SettingsSectionTitle,
    SettingsSubsectionDescription,
    SettingsSubsectionHeader,
    SettingsSubsectionTitle
} from "@app/components/Settings";
import HeaderTitle from "@app/components/SettingsSectionTitle";
import {
    OptionSelect,
    type OptionSelectOption
} from "@app/components/OptionSelect";
import {
    StrategySelect,
    type StrategyOption
} from "@app/components/StrategySelect";
import { BrowserGatewayTargetForm } from "@app/components/BrowserGatewayTargetForm";
import {
    SitesSelector,
    type Selectedsite
} from "@app/components/site-selector";
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
import { Label } from "@app/components/ui/label";
import {
    Popover,
    PopoverContent,
    PopoverTrigger
} from "@app/components/ui/popover";
import { useEnvContext } from "@app/hooks/useEnvContext";
import { usePaidStatus } from "@app/hooks/usePaidStatus";
import { toast } from "@app/hooks/useToast";
import { PaidFeaturesAlert } from "@app/components/PaidFeaturesAlert";
import { tierMatrix, TierFeature } from "@server/lib/billing/tierMatrix";
import { createApiClient, formatAxiosError } from "@app/lib/api";
import {
    createBrowserGatewayTargetFormSchema,
    createSshSettingsFormSchema,
    selectedSiteSchema,
    type SshSettingsFormValues
} from "@app/lib/browserGatewayTargetFormSchema";
import { DockerManager, DockerState } from "@app/lib/docker";
import { orgQueries } from "@app/lib/queries";
import { finalizeSubdomainSanitize } from "@app/lib/subdomain-utils";
import { zodResolver } from "@hookform/resolvers/zod";
import { build } from "@server/build";
import { Resource } from "@server/db";
import { isTargetValid } from "@server/lib/validators";
import { ListRemoteExitNodesResponse } from "@server/routers/remoteExitNode/types";
import { useQuery } from "@tanstack/react-query";
import {
    LocalTarget,
    ProxyResourceTargetsForm
} from "@app/app/[orgId]/settings/resources/public/ProxyResourceTargetsForm";
import { AxiosResponse } from "axios";
import { ChevronsUpDown, ExternalLink } from "lucide-react";
import { useTranslations } from "next-intl";
import { useParams, useRouter } from "next/navigation";
import { toASCII } from "punycode";
import {
    useMemo,
    useState,
    useEffect
} from "react";
import { useForm, type Resolver } from "react-hook-form";
import { z } from "zod";

type TranslateFn = (key: string) => string;

function createBaseResourceFormSchema(t: TranslateFn) {
    return z.object({
        name: z
            .string()
            .min(1, { message: t("nameRequired") })
            .max(255, {
                message: t("createInternalResourceDialogNameMaxLength")
            }),
        http: z.boolean()
    });
}

function createHttpResourceFormSchema(t: TranslateFn) {
    return z.object({
        domainId: z.string().min(1, { message: t("domainRequired") }),
        subdomain: z.string().optional()
    });
}

function createTcpUdpResourceFormSchema(t: TranslateFn) {
    return z.object({
        protocol: z.string(),
        proxyPort: z
            .number({ error: t("proxyPortRequired") })
            .int({ error: t("healthCheckPortInvalid") })
            .min(1, { message: t("healthCheckPortInvalid") })
            .max(65535, { message: t("healthCheckPortInvalid") })
    });
}

function createSshDaemonPortSchema(t: TranslateFn) {
    return z.object({
        authDaemonPort: z.string().refine(
            (val) => {
                if (!val) return true;
                const n = Number(val);
                return Number.isInteger(n) && n >= 1 && n <= 65535;
            },
            { message: t("healthCheckPortInvalid") }
        )
    });
}

function createAddTargetSchema(t: TranslateFn) {
    return z
        .object({
            ip: z.string().refine(isTargetValid, {
                message: t("targetErrorInvalidIpDescription")
            }),
            method: z.string().nullable(),
            port: z.coerce
                .number<number>({ error: t("targetErrorInvalidPortDescription") })
                .int({ error: t("targetErrorInvalidPortDescription") })
                .positive({ error: t("targetErrorInvalidPortDescription") }),
            siteId: z
                .int({ error: t("siteRequired") })
                .positive({ error: t("siteRequired") }),
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
            priority: z
                .int()
                .min(1, { message: t("healthCheckPortInvalid") })
                .max(1000, { message: t("healthCheckPortInvalid") })
                .optional()
        })
        .refine(
            (data) => {
                if (data.path && !data.pathMatchType) {
                    return false;
                }
                if (data.pathMatchType && !data.path) {
                    return false;
                }
                if (data.path && data.pathMatchType) {
                    switch (data.pathMatchType) {
                        case "exact":
                        case "prefix":
                            return data.path.startsWith("/");
                        case "regex":
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
                message: t("invalidPathConfiguration")
            }
        )
        .refine(
            (data) => {
                if (data.rewritePath && !data.rewritePathType) {
                    return false;
                }
                if (data.rewritePathType && !data.rewritePath) {
                    if (data.rewritePathType !== "stripPrefix") {
                        return false;
                    }
                }
                return true;
            },
            {
                message: t("invalidRewritePathConfiguration")
            }
        );
}

type NewResourceType = "http" | "ssh" | "rdp" | "vnc" | "tcp" | "udp";

type CreateBgTargetFormValues = SshSettingsFormValues;

export default function Page() {
    const { env } = useEnvContext();
    const api = createApiClient({ env });
    const { orgId } = useParams();
    const router = useRouter();
    const t = useTranslations();

    const { data: sites = [], isLoading: loadingPage } = useQuery(
        orgQueries.sites({ orgId: orgId as string })
    );

    const { isPaidUser } = usePaidStatus();

    const [remoteExitNodes, setRemoteExitNodes] = useState<
        ListRemoteExitNodesResponse["remoteExitNodes"]
    >([]);
    const [loadingExitNodes, setLoadingExitNodes] = useState(build === "saas");

    const [createLoading, setCreateLoading] = useState(false);
    const [showSnippets, setShowSnippets] = useState(false);
    const [niceId, setNiceId] = useState<string>("");

    // Resource type state
    const [resourceType, setResourceType] = useState<NewResourceType>("http");

    const isBrowserGatewayType =
        resourceType === "ssh" ||
        resourceType === "rdp" ||
        resourceType === "vnc";
    const browserGatewayDisabled =
        isBrowserGatewayType &&
        !isPaidUser(tierMatrix[TierFeature.AdvancedPublicResources]);

    // Target management state (managed by ProxyResourceTargetsForm; mirrored here for onSubmit)
    const [targets, setTargets] = useState<LocalTarget[]>([]);

    // SSH-specific state
    const [sshServerMode, setSshServerMode] = useState<"standard" | "native">(
        "native"
    );
    const [pamMode, setPamMode] = useState<"passthrough" | "push">(
        "passthrough"
    );
    const [standardDaemonLocation, setStandardDaemonLocation] = useState<
        "site" | "remote"
    >("site");
    const [nativeSelectedSite, setNativeSelectedSite] =
        useState<Selectedsite | null>(null);
    const [nativeSiteOpen, setNativeSiteOpen] = useState(false);

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

    // Derived flags
    const isHttpResource = resourceType !== "tcp" && resourceType !== "udp";
    const isNative = sshServerMode === "native";
    const showDaemonLocation =
        resourceType === "ssh" && !isNative && pamMode === "push";
    const showDaemonPort =
        resourceType === "ssh" &&
        !isNative &&
        pamMode === "push" &&
        standardDaemonLocation === "remote";

    const bgTargetFormSchema = useMemo(() => {
        if (resourceType === "ssh" && !isNative) {
            return createSshSettingsFormSchema(t, { isNative: false });
        }
        if (resourceType === "rdp" || resourceType === "vnc") {
            return createBrowserGatewayTargetFormSchema(t);
        }
        return z.object({
            selectedSites: z.array(selectedSiteSchema),
            selectedSite: selectedSiteSchema.nullable(),
            destination: z.string(),
            destinationPort: z.string(),
            pamMode: z.enum(["passthrough", "push"]),
            standardDaemonLocation: z.enum(["site", "remote"])
        });
    }, [resourceType, isNative, t]);

    const bgTargetForm = useForm<CreateBgTargetFormValues>({
        resolver: zodResolver(
            bgTargetFormSchema
        ) as unknown as Resolver<CreateBgTargetFormValues>,
        defaultValues: {
            selectedSites: [],
            selectedSite: null,
            selectedNativeSite: null,
            destination: "",
            destinationPort: "22",
            pamMode: "passthrough",
            standardDaemonLocation: "site",
            authDaemonPort: "22123"
        }
    });

    // Whether raw (TCP/UDP) resources are available
    const rawResourcesAllowed =
        env.flags.allowRawResources &&
        (build !== "saas" || remoteExitNodes.length > 0);
    const enterpriseModesAllowed =
        !env.flags.disableEnterpriseFeatures;

    const availableTypes = useMemo((): NewResourceType[] => {
        const base: NewResourceType[] = ["http"];
        if (enterpriseModesAllowed) {
            base.push("ssh", "rdp", "vnc");
        }
        if (rawResourcesAllowed) {
            base.push("tcp", "udp");
        }
        return base;
    }, [enterpriseModesAllowed, rawResourcesAllowed]);

    useEffect(() => {
        if (!availableTypes.includes(resourceType)) {
            setResourceType("http");
        }
    }, [availableTypes, resourceType]);

    const baseResourceFormSchema = useMemo(
        () => createBaseResourceFormSchema(t),
        [t]
    );
    const httpResourceFormSchema = useMemo(
        () => createHttpResourceFormSchema(t),
        [t]
    );
    const tcpUdpResourceFormSchema = useMemo(
        () => createTcpUdpResourceFormSchema(t),
        [t]
    );
    const sshDaemonPortSchema = useMemo(
        () => createSshDaemonPortSchema(t),
        [t]
    );
    const addTargetSchema = useMemo(() => createAddTargetSchema(t), [t]);

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
        }
    });

    const sshDaemonPortForm = useForm({
        resolver: zodResolver(sshDaemonPortSchema),
        defaultValues: {
            authDaemonPort: "22123"
        }
    });

    useEffect(() => {
        const defaultPort =
            resourceType === "rdp"
                ? "3389"
                : resourceType === "vnc"
                  ? "5900"
                  : "22";
        bgTargetForm.reset({
            selectedSites: [],
            selectedSite: null,
            selectedNativeSite: null,
            destination: "",
            destinationPort: defaultPort,
            pamMode,
            standardDaemonLocation,
            authDaemonPort: sshDaemonPortForm.getValues().authDaemonPort
        });
        setNativeSelectedSite(null);
    }, [resourceType]);

    useEffect(() => {
        bgTargetForm.setValue("pamMode", pamMode);
        bgTargetForm.setValue("standardDaemonLocation", standardDaemonLocation);
    }, [pamMode, standardDaemonLocation]);

    // Sync form http field with resourceType
    useEffect(() => {
        baseForm.setValue("http", isHttpResource);
        if (resourceType === "tcp") {
            tcpUdpForm.setValue("protocol", "tcp");
        } else if (resourceType === "udp") {
            tcpUdpForm.setValue("protocol", "udp");
        }
    }, [resourceType, isHttpResource]);

    const areAllTargetsValid = () => {
        if (targets.length === 0) return true;

        return targets.every((target) => {
            try {
                const isHttp = resourceType === "http";
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

    async function onSubmit() {
        setCreateLoading(true);
        const baseData = baseForm.getValues();

        try {
            const payload: any = {
                name: baseData.name,
                http: isHttpResource
            };

            let sanitizedSubdomain: string | undefined;

            if (isHttpResource) {
                const httpData = httpForm.getValues();

                sanitizedSubdomain = httpData.subdomain
                    ? finalizeSubdomainSanitize(httpData.subdomain, true)
                    : undefined;

                const effectiveMode = isNative
                    ? "native"
                    : standardDaemonLocation;
                const portVal = sshDaemonPortForm.getValues().authDaemonPort;
                const effectivePort =
                    !isNative &&
                    standardDaemonLocation === "remote" &&
                    pamMode === "push" &&
                    portVal
                        ? Number(portVal)
                        : undefined;

                Object.assign(payload, {
                    subdomain: sanitizedSubdomain
                        ? toASCII(sanitizedSubdomain)
                        : undefined,
                    domainId: httpData.domainId,
                    protocol: "tcp",
                    mode: resourceType,
                    pamMode,
                    authDaemonMode: effectiveMode,
                    authDaemonPort: effectivePort || undefined
                });
            } else {
                const tcpUdpData = tcpUdpForm.getValues();
                Object.assign(payload, {
                    protocol: tcpUdpData.protocol,
                    proxyPort: tcpUdpData.proxyPort
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
                const newNiceId = res.data.data.niceId;
                setNiceId(newNiceId);

                if (resourceType === "http") {
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
                                    hcTlsServerName: target.hcTlsServerName,
                                    hcHealthyThreshold:
                                        target.hcHealthyThreshold || null,
                                    hcUnhealthyThreshold:
                                        target.hcUnhealthyThreshold || null,
                                    path: target.path,
                                    pathMatchType: target.pathMatchType,
                                    rewritePath: target.rewritePath,
                                    rewritePathType: target.rewritePathType,
                                    priority: target.priority
                                };
                                await api.put(`/resource/${id}/target`, data);
                            }
                        } catch (targetError) {
                            console.error(
                                "Error creating targets:",
                                targetError
                            );
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
                    router.push(
                        `/${orgId}/settings/resources/public/${newNiceId}`
                    );
                } else if (resourceType === "ssh") {
                    if (isNative) {
                        if (nativeSelectedSite) {
                            await api.put(
                                `/resource/${id}/target`,
                                {
                                    siteId: nativeSelectedSite.siteId,
                                    mode: "ssh",
                                    ip: "localhost",
                                    port: 22,
                                    hcEnabled: false
                                }
                            );
                        }
                    } else {
                        const bgValues = bgTargetForm.getValues();
                        const useMultiSite =
                            standardDaemonLocation !== "site" ||
                            pamMode === "passthrough";
                        const sitesToCreate = useMultiSite
                            ? bgValues.selectedSites
                            : bgValues.selectedSite
                              ? [bgValues.selectedSite]
                              : [];
                        for (const site of sitesToCreate) {
                            await api.put(
                                `/resource/${id}/target`,
                                {
                                    siteId: site.siteId,
                                    mode: "ssh",
                                    ip: bgValues.destination,
                                    port: Number(bgValues.destinationPort),
                                    hcEnabled: false
                                }
                            );
                        }
                    }

                    router.push(
                        `/${orgId}/settings/resources/public/${newNiceId}`
                    );
                } else if (resourceType === "rdp" || resourceType === "vnc") {
                    const bgValues = bgTargetForm.getValues();
                    for (const site of bgValues.selectedSites) {
                        await api.put(
                            `/resource/${id}/target`,
                            {
                                siteId: site.siteId,
                                mode: resourceType,
                                ip: bgValues.destination,
                                port: Number(bgValues.destinationPort),
                                hcEnabled: false
                            }
                         );
                    }

                    router.push(
                        `/${orgId}/settings/resources/public/${newNiceId}`
                    );
                } else {
                    // TCP / UDP — create targets then show snippets
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
                                    hcTlsServerName: target.hcTlsServerName,
                                    hcHealthyThreshold:
                                        target.hcHealthyThreshold || null,
                                    hcUnhealthyThreshold:
                                        target.hcUnhealthyThreshold || null
                                };
                                await api.put(`/resource/${id}/target`, data);
                            }
                        } catch (targetError) {
                            console.error(
                                "Error creating targets:",
                                targetError
                            );
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
                    setShowSnippets(true);
                    router.refresh();
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
        } finally {
            setCreateLoading(false);
        }
    }

    // SSH strategy options
    const sshModeOptions: StrategyOption<"standard" | "native">[] = [
        {
            id: "native",
            title: t("sshServerModePangolin"),
            description: t("sshServerModeNativeDescription")
        },
        {
            id: "standard",
            title: t("sshServerModeStandard"),
            description: t("sshServerModeStandardDescription")
        }
    ];

    const authMethodOptions: StrategyOption<"passthrough" | "push">[] = [
        {
            id: "passthrough",
            title: t("sshAuthMethodManual"),
            description: t("sshAuthMethodManualDescription")
        },
        {
            id: "push",
            title: t("sshAuthMethodAutomated"),
            description: t("sshAuthMethodAutomatedDescription")
        }
    ];

    const daemonLocationOptions: StrategyOption<"site" | "remote">[] = [
        {
            id: "site",
            title: t("internalResourceAuthDaemonSite"),
            description: t("sshDaemonLocationSiteDescription")
        },
        {
            id: "remote",
            title: t("sshDaemonLocationRemote"),
            description: t("sshDaemonLocationRemoteDescription")
        }
    ];

    let typeLabels: Partial<Record<NewResourceType, string>> = {
        http: "HTTP",
        tcp: "TCP",
        udp: "UDP"
    };

    if (enterpriseModesAllowed) {
        typeLabels = {  
            ...typeLabels,
            ssh: "SSH",
            rdp: "RDP",
            vnc: "VNC",
        };
    }

    const typeOptions: OptionSelectOption<NewResourceType>[] =
        availableTypes.map((type) => ({
            value: type,
            label: typeLabels[type] ?? type.toUpperCase()
        }));

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
                            {/* General Section */}
                            <SettingsSection>
                                <SettingsSectionHeader>
                                    <SettingsSectionTitle>
                                        {t("resourceCreateGeneral")}
                                    </SettingsSectionTitle>
                                    <SettingsSectionDescription>
                                        {t("resourceCreateGeneralDescription")}
                                    </SettingsSectionDescription>
                                </SettingsSectionHeader>
                                <SettingsSectionBody>
                                    <SettingsSectionForm variant="half">
                                        <SettingsFormGrid>
                                            <SettingsFormCell span="half">
                                                <Form {...baseForm}>
                                                    <form
                                                        onKeyDown={(e) => {
                                                            if (
                                                                e.key ===
                                                                "Enter"
                                                            ) {
                                                                e.preventDefault();
                                                            }
                                                        }}
                                                        id="base-resource-form"
                                                    >
                                                        <FormField
                                                            control={
                                                                baseForm.control
                                                            }
                                                            name="name"
                                                            render={({
                                                                field
                                                            }) => (
                                                                <FormItem>
                                                                    <FormLabel>
                                                                        {t(
                                                                            "name"
                                                                        )}
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
                                            </SettingsFormCell>

                                            <SettingsFormCell span="full">
                                                <div className="space-y-2">
                                                    <p className="text-sm font-medium">
                                                        {t("type")}
                                                    </p>
                                                    <OptionSelect<NewResourceType>
                                                        options={typeOptions}
                                                        value={resourceType}
                                                        onChange={
                                                            setResourceType
                                                        }
                                                        cols={6}
                                                    />
                                                    <p className="text-sm text-muted-foreground">
                                                        {t(
                                                            "resourceTypeDescription"
                                                        )}
                                                    </p>
                                                </div>
                                            </SettingsFormCell>

                                            {isHttpResource && (
                                                <SettingsFormCell span="full">
                                                    <Form {...httpForm}>
                                                        <FormField
                                                            control={
                                                                httpForm.control
                                                            }
                                                            name="domainId"
                                                            render={() => (
                                                                <FormItem>
                                                                    <DomainPicker
                                                                        allowWildcard={
                                                                            true
                                                                        }
                                                                        orgId={
                                                                            orgId as string
                                                                        }
                                                                        warnOnProvidedDomain={
                                                                            remoteExitNodes.length >=
                                                                            1
                                                                        }
                                                                        onDomainChange={(
                                                                            res
                                                                        ) => {
                                                                            if (
                                                                                !res
                                                                            )
                                                                                return;
                                                                            httpForm.setValue(
                                                                                "subdomain",
                                                                                res.subdomain,
                                                                                {
                                                                                    shouldValidate:
                                                                                        true
                                                                                }
                                                                            );
                                                                            httpForm.setValue(
                                                                                "domainId",
                                                                                res.domainId,
                                                                                {
                                                                                    shouldValidate:
                                                                                        true
                                                                                }
                                                                            );
                                                                        }}
                                                                    />
                                                                    <FormMessage />
                                                                    <FormDescription>
                                                                        {t(
                                                                            "resourceDomainDescription"
                                                                        )}
                                                                    </FormDescription>
                                                                </FormItem>
                                                            )}
                                                        />
                                                    </Form>
                                                </SettingsFormCell>
                                            )}

                                            {!isHttpResource && (
                                                <SettingsFormCell span="half">
                                                    <Form {...tcpUdpForm}>
                                                        <form
                                                            onKeyDown={(e) => {
                                                                if (
                                                                    e.key ===
                                                                    "Enter"
                                                                ) {
                                                                    e.preventDefault();
                                                                }
                                                            }}
                                                            id="tcp-udp-settings-form"
                                                        >
                                                            <FormField
                                                                control={
                                                                    tcpUdpForm.control
                                                                }
                                                                name="proxyPort"
                                                                render={({
                                                                    field
                                                                }) => (
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
                                                                                "resourcePortDescription"
                                                                            )}
                                                                        </FormDescription>
                                                                    </FormItem>
                                                                )}
                                                            />
                                                        </form>
                                                    </Form>
                                                </SettingsFormCell>
                                            )}
                                        </SettingsFormGrid>
                                    </SettingsSectionForm>
                                </SettingsSectionBody>
                            </SettingsSection>

                            {/* SSH Server Section */}
                            {resourceType === "ssh" && (
                                <SettingsSection>
                                    <PaidFeaturesAlert
                                        tiers={
                                            tierMatrix[
                                                TierFeature
                                                    .AdvancedPublicResources
                                            ]
                                        }
                                    />
                                    <SettingsSectionHeader>
                                        <SettingsSectionTitle>
                                            {t("sshServer")}
                                        </SettingsSectionTitle>
                                        <SettingsSectionDescription>
                                            {t("sshServerDescription")}
                                        </SettingsSectionDescription>
                                    </SettingsSectionHeader>
                                    <fieldset
                                        disabled={browserGatewayDisabled}
                                        className={
                                            browserGatewayDisabled
                                                ? "opacity-50 pointer-events-none"
                                                : ""
                                        }
                                    >
                                    <SettingsSectionBody>
                                        <SettingsSectionForm variant="half">
                                            <SettingsFormGrid>
                                                <SettingsFormCell span="full">
                                                    <div className="space-y-2">
                                                        <p className="font-semibold text-sm">
                                                            {t("sshServerMode")}
                                                        </p>
                                                        <StrategySelect<
                                                            "standard" | "native"
                                                        >
                                                            value={sshServerMode}
                                                            options={
                                                                sshModeOptions
                                                            }
                                                            onChange={
                                                                setSshServerMode
                                                            }
                                                            cols={2}
                                                        />
                                                    </div>
                                                </SettingsFormCell>

                                                <SettingsFormCell span="full">
                                                    <div className="space-y-2">
                                                        <p className="font-semibold text-sm">
                                                            {t(
                                                                "sshAuthenticationMethod"
                                                            )}
                                                        </p>
                                                        <StrategySelect<
                                                            "passthrough" | "push"
                                                        >
                                                            value={pamMode}
                                                            options={
                                                                authMethodOptions
                                                            }
                                                            onChange={setPamMode}
                                                            cols={2}
                                                        />
                                                    </div>
                                                </SettingsFormCell>

                                                {showDaemonLocation && (
                                                    <SettingsFormCell span="full">
                                                        <div className="space-y-2">
                                                            <p className="font-semibold text-sm">
                                                                {t(
                                                                    "sshAuthDaemonLocation"
                                                                )}
                                                            </p>
                                                            <StrategySelect<
                                                                "site" | "remote"
                                                            >
                                                                value={
                                                                    standardDaemonLocation
                                                                }
                                                                options={
                                                                    daemonLocationOptions
                                                                }
                                                                onChange={
                                                                    setStandardDaemonLocation
                                                                }
                                                                cols={2}
                                                            />
                                                            <p className="text-sm text-muted-foreground">
                                                                {t(
                                                                    "sshDaemonDisclaimer"
                                                                )}{" "}
                                                                <a
                                                                    href="https://docs.pangolin.net/manage/ssh"
                                                                    target="_blank"
                                                                    rel="noopener noreferrer"
                                                                    className="text-primary hover:underline inline-flex items-center gap-1"
                                                                >
                                                                    {t(
                                                                        "learnMore"
                                                                    )}
                                                                    <ExternalLink className="size-3.5 shrink-0" />
                                                                </a>
                                                            </p>
                                                        </div>
                                                    </SettingsFormCell>
                                                )}

                                                {showDaemonPort && (
                                                    <SettingsFormCell span="half">
                                                        <Form
                                                            {...sshDaemonPortForm}
                                                        >
                                                            <FormField
                                                                control={
                                                                    sshDaemonPortForm.control
                                                                }
                                                                name="authDaemonPort"
                                                                render={({
                                                                    field
                                                                }) => (
                                                                    <FormItem>
                                                                        <FormLabel>
                                                                            {t(
                                                                                "sshDaemonPort"
                                                                            )}
                                                                        </FormLabel>
                                                                        <FormControl>
                                                                            <Input
                                                                                type="number"
                                                                                min={
                                                                                    1
                                                                                }
                                                                                max={
                                                                                    65535
                                                                                }
                                                                                {...field}
                                                                            />
                                                                        </FormControl>
                                                                        <FormMessage />
                                                                    </FormItem>
                                                                )}
                                                            />
                                                        </Form>
                                                    </SettingsFormCell>
                                                )}

                                                <SettingsFormCell span="full">
                                                    <SettingsSubsectionHeader>
                                                        <SettingsSubsectionTitle>
                                                            {t(
                                                                "sshServerDestination"
                                                            )}
                                                        </SettingsSubsectionTitle>
                                                        <SettingsSubsectionDescription>
                                                            {t(
                                                                "sshServerDestinationDescription"
                                                            )}
                                                        </SettingsSubsectionDescription>
                                                    </SettingsSubsectionHeader>
                                                </SettingsFormCell>

                                                {isNative ? (
                                                    <SettingsFormCell span="half">
                                                        <div className="grid gap-2">
                                                            <Label>{t("sites")}</Label>
                                                            <Popover
                                                                open={
                                                                    nativeSiteOpen
                                                                }
                                                                onOpenChange={
                                                                    setNativeSiteOpen
                                                                }
                                                            >
                                                                <PopoverTrigger
                                                                    asChild
                                                                >
                                                                    <Button
                                                                        variant="outline"
                                                                        role="combobox"
                                                                        className="w-full justify-between font-normal"
                                                                    >
                                                                        <span className="truncate">
                                                                            {nativeSelectedSite?.name ??
                                                                                t(
                                                                                    "siteSelect"
                                                                                )}
                                                                        </span>
                                                                        <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                                                                    </Button>
                                                                </PopoverTrigger>
                                                                <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0">
                                                                    <SitesSelector
                                                                        orgId={
                                                                            orgId as string
                                                                        }
                                                                        selectedSite={
                                                                            nativeSelectedSite
                                                                        }
                                                                        onSelectSite={(
                                                                            site
                                                                        ) => {
                                                                            setNativeSelectedSite(
                                                                                site
                                                                            );
                                                                            setNativeSiteOpen(
                                                                                false
                                                                            );
                                                                        }}
                                                                    />
                                                                </PopoverContent>
                                                            </Popover>
                                                        </div>
                                                    </SettingsFormCell>
                                                ) : standardDaemonLocation !==
                                                      "site" ||
                                                  pamMode ===
                                                      "passthrough" ? (
                                                    <SettingsFormCell span="full">
                                                        <Form {...bgTargetForm}>
                                                            <BrowserGatewayTargetForm
                                                                control={
                                                                    bgTargetForm.control
                                                                }
                                                                orgId={
                                                                    orgId as string
                                                                }
                                                                multiSite={true}
                                                                sitesField="selectedSites"
                                                                destinationField="destination"
                                                                destinationPortField="destinationPort"
                                                                learnMoreHref="https://docs.pangolin.net/manage/resources/public/ssh#site-and-host-configuration"
                                                                defaultPort={22}
                                                            />
                                                        </Form>
                                                    </SettingsFormCell>
                                                ) : (
                                                    <SettingsFormCell span="full">
                                                        <Form {...bgTargetForm}>
                                                            <BrowserGatewayTargetForm
                                                                control={
                                                                    bgTargetForm.control
                                                                }
                                                                orgId={
                                                                    orgId as string
                                                                }
                                                                multiSite={
                                                                    false
                                                                }
                                                                siteField="selectedSite"
                                                                destinationField="destination"
                                                                destinationPortField="destinationPort"
                                                                learnMoreHref="https://docs.pangolin.net/manage/resources/public/ssh#site-and-host-configuration"
                                                                defaultPort={22}
                                                            />
                                                        </Form>
                                                    </SettingsFormCell>
                                                )}
                                            </SettingsFormGrid>
                                        </SettingsSectionForm>
                                    </SettingsSectionBody>
                                    </fieldset>
                                </SettingsSection>
                            )}

                            {/* RDP Server Section */}
                            {resourceType === "rdp" && (
                                <SettingsSection>
                                    <PaidFeaturesAlert
                                        tiers={
                                            tierMatrix[
                                                TierFeature
                                                    .AdvancedPublicResources
                                            ]
                                        }
                                    />
                                    <SettingsSectionHeader>
                                        <SettingsSectionTitle>
                                            {t("rdpServer")}
                                        </SettingsSectionTitle>
                                        <SettingsSectionDescription>
                                            {t("rdpServerDescription")}
                                        </SettingsSectionDescription>
                                    </SettingsSectionHeader>
                                    <fieldset
                                        disabled={browserGatewayDisabled}
                                        className={
                                            browserGatewayDisabled
                                                ? "opacity-50 pointer-events-none"
                                                : ""
                                        }
                                    >
                                    <SettingsSectionBody>
                                        <SettingsSectionForm variant="half">
                                            <Form {...bgTargetForm}>
                                                <BrowserGatewayTargetForm
                                                    control={bgTargetForm.control}
                                                    orgId={orgId as string}
                                                    multiSite={true}
                                                    sitesField="selectedSites"
                                                    destinationField="destination"
                                                    destinationPortField="destinationPort"
                                                    learnMoreHref="https://docs.pangolin.net/manage/resources/public/rdp#site-and-host-configuration"
                                                    defaultPort={3389}
                                                />
                                            </Form>
                                        </SettingsSectionForm>
                                    </SettingsSectionBody>
                                    </fieldset>
                                </SettingsSection>
                            )}

                            {/* VNC Server Section */}
                            {resourceType === "vnc" && (
                                <SettingsSection>
                                    <PaidFeaturesAlert
                                        tiers={
                                            tierMatrix[
                                                TierFeature
                                                    .AdvancedPublicResources
                                            ]
                                        }
                                    />
                                    <SettingsSectionHeader>
                                        <SettingsSectionTitle>
                                            {t("vncServer")}
                                        </SettingsSectionTitle>
                                        <SettingsSectionDescription>
                                            {t("vncServerDescription")}
                                        </SettingsSectionDescription>
                                    </SettingsSectionHeader>
                                    <fieldset
                                        disabled={browserGatewayDisabled}
                                        className={
                                            browserGatewayDisabled
                                                ? "opacity-50 pointer-events-none"
                                                : ""
                                        }
                                    >
                                    <SettingsSectionBody>
                                        <SettingsSectionForm variant="half">
                                            <Form {...bgTargetForm}>
                                                <BrowserGatewayTargetForm
                                                    control={bgTargetForm.control}
                                                    orgId={orgId as string}
                                                    multiSite={true}
                                                    sitesField="selectedSites"
                                                    destinationField="destination"
                                                    destinationPortField="destinationPort"
                                                    learnMoreHref="https://docs.pangolin.net/manage/resources/public/vnc#site-and-host-configuration"
                                                    defaultPort={5900}
                                                />
                                            </Form>
                                        </SettingsSectionForm>
                                    </SettingsSectionBody>
                                    </fieldset>
                                </SettingsSection>
                            )}

                            {/* Targets Section (HTTP / TCP / UDP) */}
                            {(resourceType === "http" ||
                                resourceType === "tcp" ||
                                resourceType === "udp") && (
                                <ProxyResourceTargetsForm
                                    orgId={orgId!.toString()}
                                    isHttp={resourceType === "http"}
                                    onChange={setTargets}
                                />
                            )}

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
                                        const baseValid =
                                            await baseForm.trigger();
                                        const domainValid = isHttpResource
                                            ? await httpForm.trigger()
                                            : true;
                                        const tcpValid = !isHttpResource
                                            ? await tcpUdpForm.trigger()
                                            : true;

                                        if (
                                            resourceType === "ssh" &&
                                            !isNative
                                        ) {
                                            bgTargetForm.setValue(
                                                "authDaemonPort",
                                                sshDaemonPortForm.getValues()
                                                    .authDaemonPort
                                            );
                                        }

                                        const bgValid =
                                            resourceType === "rdp" ||
                                            resourceType === "vnc" ||
                                            (resourceType === "ssh" &&
                                                !isNative)
                                                ? await bgTargetForm.trigger()
                                                : true;

                                        if (
                                            baseValid &&
                                            domainValid &&
                                            tcpValid &&
                                            bgValid
                                        ) {
                                            onSubmit();
                                        }
                                    }}
                                    loading={createLoading}
                                    disabled={!areAllTargetsValid() || browserGatewayDisabled || createLoading}
                                >
                                    {t("resourceCreate")}
                                </Button>
                            </div>
                        </SettingsContainer>
                    ) : (
                        <SettingsContainer>
                            <SettingsSection>
                                <SettingsSectionHeader>
                                    <SettingsSectionTitle>
                                        {t("resourceConfig")}
                                    </SettingsSectionTitle>
                                    <SettingsSectionDescription>
                                        {t("resourceConfigDescription")}{" "}
                                        <a
                                            href="https://docs.pangolin.net/manage/resources/public/raw-resources"
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="text-primary hover:underline inline-flex items-center gap-1"
                                        >
                                            {t("learnMore")}
                                            <ExternalLink className="size-3.5 shrink-0" />
                                        </a>
                                    </SettingsSectionDescription>
                                </SettingsSectionHeader>
                                <SettingsSectionBody>
                                    <SettingsSectionForm variant="half">
                                        <SettingsFormGrid>
                                        <SettingsFormCell span="full">
                                            <SettingsSubsectionHeader>
                                                <SettingsSubsectionTitle>
                                                    {t("resourceAddEntrypoints")}
                                                </SettingsSubsectionTitle>
                                                <SettingsSubsectionDescription>
                                                    {t(
                                                        "resourceAddEntrypointsEditFile"
                                                    )}
                                                </SettingsSubsectionDescription>
                                            </SettingsSubsectionHeader>
                                        </SettingsFormCell>
                                        <SettingsFormCell span="full">
                                            <CopyTextBox
                                                text={`entryPoints:
  ${tcpUdpForm.getValues("protocol")}-${tcpUdpForm.getValues("proxyPort")}:
    address: ":${tcpUdpForm.getValues("proxyPort")}/${tcpUdpForm.getValues("protocol")}"`}
                                                wrapText={false}
                                            />
                                        </SettingsFormCell>

                                        <SettingsFormCell span="full">
                                            <SettingsSubsectionHeader>
                                                <SettingsSubsectionTitle>
                                                    {t("resourceExposePorts")}
                                                </SettingsSubsectionTitle>
                                                <SettingsSubsectionDescription>
                                                    {t(
                                                        "resourceExposePortsEditFile"
                                                    )}
                                                </SettingsSubsectionDescription>
                                            </SettingsSubsectionHeader>
                                        </SettingsFormCell>
                                        <SettingsFormCell span="full">
                                            <CopyTextBox
                                                text={`ports:
  - ${tcpUdpForm.getValues("proxyPort")}:${tcpUdpForm.getValues("proxyPort")}${tcpUdpForm.getValues("protocol") === "tcp" ? "" : "/" + tcpUdpForm.getValues("protocol")}`}
                                                wrapText={false}
                                            />
                                        </SettingsFormCell>
                                    </SettingsFormGrid>
                                    </SettingsSectionForm>
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
                                            `/${orgId}/settings/resources/public/${niceId}`
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
