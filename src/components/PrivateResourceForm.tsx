"use client";

import {
    SettingsSubsectionDescription,
    SettingsSubsectionHeader,
    SettingsSubsectionTitle
} from "@app/components/Settings";
import { HorizontalTabs } from "@app/components/HorizontalTabs";
import {
    OptionSelect,
    type OptionSelectOption
} from "@app/components/OptionSelect";
import { PaidFeaturesAlert } from "@app/components/PaidFeaturesAlert";
import { StrategySelect } from "@app/components/StrategySelect";
import { Tag, TagInput } from "@app/components/tags/tag-input";
import { Button } from "@app/components/ui/button";
import {
    Form,
    FormControl,
    FormField,
    FormItem,
    FormLabel,
    FormMessage
} from "@app/components/ui/form";
import { Input } from "@app/components/ui/input";
import {
    Popover,
    PopoverContent,
    PopoverTrigger
} from "@app/components/ui/popover";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue
} from "@app/components/ui/select";
import { Switch } from "@app/components/ui/switch";
import { useEnvContext } from "@app/hooks/useEnvContext";
import { usePaidStatus } from "@app/hooks/usePaidStatus";
import { cn } from "@app/lib/cn";
import { getUserDisplayName } from "@app/lib/getUserDisplayName";
import { orgQueries, resourceQueries } from "@app/lib/queries";
import { zodResolver } from "@hookform/resolvers/zod";
import { tierMatrix } from "@server/lib/billing/tierMatrix";
import { UserType } from "@server/types/UserTypes";
import { useQuery } from "@tanstack/react-query";
import {
    ArrowDownIcon,
    ChevronDownIcon,
    ChevronsUpDown,
    ExternalLink
} from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import {
    MultiSitesSelector,
    formatMultiSitesSelectorLabel
} from "./multi-site-selector";
import { SitesSelector } from "./site-selector";
import type { Selectedsite } from "./site-selector";

import { MachinesSelector } from "./machines-selector";
import DomainPicker from "@app/components/DomainPicker";
import { SwitchInput } from "@app/components/SwitchInput";
import CertificateStatus from "@app/components/CertificateStatus";
import { UsersSelector } from "./users-selector";
import { RolesSelector } from "./roles-selector";
import { build } from "@server/build";

// --- Helpers (shared) ---

const isValidPortRangeString = (val: string | undefined | null): boolean => {
    if (!val || val.trim() === "" || val.trim() === "*") return true;
    const parts = val.split(",").map((p) => p.trim());
    for (const part of parts) {
        if (part === "") return false;
        if (part.includes("-")) {
            const [start, end] = part.split("-").map((p) => p.trim());
            if (!start || !end) return false;
            const startPort = parseInt(start, 10);
            const endPort = parseInt(end, 10);
            if (isNaN(startPort) || isNaN(endPort)) return false;
            if (
                startPort < 1 ||
                startPort > 65535 ||
                endPort < 1 ||
                endPort > 65535
            )
                return false;
            if (startPort > endPort) return false;
        } else {
            const port = parseInt(part, 10);
            if (isNaN(port) || port < 1 || port > 65535) return false;
        }
    }
    return true;
};

const getPortRangeValidationMessage = (t: (key: string) => string) =>
    t("editInternalResourceDialogPortRangeValidationError");

const createPortRangeStringSchema = (t: (key: string) => string) =>
    z
        .string()
        .optional()
        .nullable()
        .refine((val) => isValidPortRangeString(val), {
            message: getPortRangeValidationMessage(t)
        });

export type PortMode = "all" | "blocked" | "custom";
export const getPortModeFromString = (
    val: string | undefined | null
): PortMode => {
    if (val === "*") return "all";
    if (!val || val.trim() === "") return "blocked";
    return "custom";
};

export const getPortStringFromMode = (
    mode: PortMode,
    customValue: string
): string | undefined => {
    if (mode === "all") return "*";
    if (mode === "blocked") return "";
    return customValue;
};

export const isHostname = (destination: string | null): boolean =>
    !!destination && /[a-zA-Z]/.test(destination);

export const cleanForFQDN = (name: string): string =>
    name
        .toLowerCase()
        .replace(/[^a-z0-9.-]/g, "-")
        .replace(/[-]+/g, "-")
        .replace(/^-|-$/g, "")
        .replace(/^\.|\.$/g, "");

// --- Types ---

export type InternalResourceMode = "host" | "cidr" | "http" | "ssh";

export type InternalResourceData = {
    id: number;
    name: string;
    orgId: string;
    siteNames: string[];
    mode: InternalResourceMode;
    siteIds: number[];
    niceId: string;
    destination: string | null;
    alias?: string | null;
    tcpPortRangeString?: string | null;
    udpPortRangeString?: string | null;
    disableIcmp?: boolean;
    authDaemonMode?: "site" | "remote" | "native" | null;
    authDaemonPort?: number | null;
    pamMode?: "passthrough" | "push" | null;
    destinationPort?: number | null;
    scheme?: "http" | "https" | null;
    ssl?: boolean;
    subdomain?: string | null;
    domainId?: string | null;
    fullDomain?: string | null;
};

const tagSchema = z.object({ id: z.string(), text: z.string() });

function buildSelectedSitesForResource(
    resource: InternalResourceData
): Selectedsite[] {
    return resource.siteIds.map((siteId, idx) => ({
        name: resource.siteNames[idx] ?? "",
        siteId,
        type: "newt" as const
    }));
}

export type InternalResourceFormValues = {
    name: string;
    siteIds: number[];
    mode: InternalResourceMode;
    destination: string | null;
    alias?: string | null;
    niceId?: string;
    tcpPortRangeString?: string | null;
    udpPortRangeString?: string | null;
    disableIcmp?: boolean;
    authDaemonMode?: "site" | "remote" | "native" | null;
    authDaemonPort?: number | null;
    pamMode?: "passthrough" | "push" | null;
    destinationPort?: number | null;
    scheme?: "http" | "https";
    ssl?: boolean;
    httpConfigSubdomain?: string | null;
    httpConfigDomainId?: string | null;
    httpConfigFullDomain?: string | null;
    roles?: z.infer<typeof tagSchema>[];
    users?: z.infer<typeof tagSchema>[];
    clients?: z.infer<typeof tagSchema>[];
};

type InternalResourceFormProps = {
    variant: "create" | "edit";
    resource?: InternalResourceData;
    open?: boolean;
    orgId: string;
    siteResourceId?: number;
    formId: string;
    onSubmit: (values: InternalResourceFormValues) => void | Promise<void>;
    onSubmitDisabledChange?: (disabled: boolean) => void;
    initialSites?: Selectedsite[];
};

export function PrivateResourceForm({
    variant,
    resource,
    open,
    orgId,
    siteResourceId,
    formId,
    onSubmit,
    onSubmitDisabledChange,
    initialSites = []
}: InternalResourceFormProps) {
    const t = useTranslations();
    const { env } = useEnvContext();
    const { isPaidUser } = usePaidStatus();
    const disableEnterpriseFeatures = env.flags.disableEnterpriseFeatures;
    const sshSectionDisabled = !isPaidUser(tierMatrix.advancedPrivateResources);
    const httpSectionDisabled = !isPaidUser(
        tierMatrix.advancedPrivateResources
    );

    const nameRequiredKey =
        variant === "create"
            ? "createInternalResourceDialogNameRequired"
            : "editInternalResourceDialogNameRequired";
    const nameMaxKey =
        variant === "create"
            ? "createInternalResourceDialogNameMaxLength"
            : "editInternalResourceDialogNameMaxLength";
    const siteRequiredKey =
        variant === "create"
            ? "createInternalResourceDialogPleaseSelectSite"
            : undefined;
    const nameLabelKey =
        variant === "create"
            ? "createInternalResourceDialogName"
            : "editInternalResourceDialogName";
    const modeLabelKey =
        variant === "create"
            ? "createInternalResourceDialogMode"
            : "editInternalResourceDialogMode";
    const modeHostKey =
        variant === "create"
            ? "createInternalResourceDialogModeHost"
            : "editInternalResourceDialogModeHost";
    const modeCidrKey =
        variant === "create"
            ? "createInternalResourceDialogModeCidr"
            : "editInternalResourceDialogModeCidr";
    const modeHttpKey =
        variant === "create"
            ? "createInternalResourceDialogModeHttp"
            : "editInternalResourceDialogModeHttp";
    const modeSshKey =
        variant === "create"
            ? "createInternalResourceDialogModeSsh"
            : "editInternalResourceDialogModeSsh";
    const schemeLabelKey =
        variant === "create"
            ? "createInternalResourceDialogScheme"
            : "editInternalResourceDialogScheme";
    const enableSslLabelKey =
        variant === "create"
            ? "createInternalResourceDialogEnableSsl"
            : "editInternalResourceDialogEnableSsl";
    const enableSslDescriptionKey =
        variant === "create"
            ? "createInternalResourceDialogEnableSslDescription"
            : "editInternalResourceDialogEnableSslDescription";
    const destinationLabelKey =
        variant === "create"
            ? "createInternalResourceDialogDestination"
            : "editInternalResourceDialogDestination";
    const destinationRequiredKey =
        variant === "create"
            ? "createInternalResourceDialogDestinationRequired"
            : undefined;
    const aliasLabelKey =
        variant === "create"
            ? "createInternalResourceDialogAlias"
            : "editInternalResourceDialogAlias";
    const destinationPortLabelKey =
        variant === "create"
            ? "createInternalResourceDialogModePort"
            : "editInternalResourceDialogModePort";
    const httpConfigurationTitleKey =
        variant === "create"
            ? "createInternalResourceDialogHttpConfiguration"
            : "editInternalResourceDialogHttpConfiguration";
    const httpConfigurationDescriptionKey =
        variant === "create"
            ? "createInternalResourceDialogHttpConfigurationDescription"
            : "editInternalResourceDialogHttpConfigurationDescription";

    const siteIdsSchema = siteRequiredKey
        ? z.array(z.number().int().positive()).min(1, t(siteRequiredKey))
        : z.array(z.number().int().positive()).min(1);

    const formSchema = z
        .object({
            name: z.string().min(1, t(nameRequiredKey)).max(255, t(nameMaxKey)),
            siteIds: siteIdsSchema,
            mode: z.enum(["host", "cidr", "http", "ssh"]),
            destination: z.string().nullish(),
            alias: z.string().nullish(),
            destinationPort: z
                .number()
                .int()
                .min(1)
                .max(65535)
                .optional()
                .nullable(),
            scheme: z.enum(["http", "https"]).optional(),
            ssl: z.boolean().optional(),
            httpConfigSubdomain: z.string().nullish(),
            httpConfigDomainId: z.string().nullish(),
            httpConfigFullDomain: z.string().nullish(),
            niceId: z
                .string()
                .min(1)
                .max(255)
                .regex(/^[a-zA-Z0-9-]+$/)
                .optional(),
            tcpPortRangeString: createPortRangeStringSchema(t),
            udpPortRangeString: createPortRangeStringSchema(t),
            disableIcmp: z.boolean().optional(),
            authDaemonMode: z
                .enum(["site", "remote", "native"])
                .optional()
                .nullable(),
            authDaemonPort: z.number().int().positive().optional().nullable(),
            pamMode: z.enum(["passthrough", "push"]).optional().nullable(),
            roles: z.array(tagSchema).optional(),
            users: z.array(tagSchema).optional(),
            clients: z
                .array(
                    z.object({
                        clientId: z.number(),
                        name: z.string()
                    })
                )
                .optional()
        })
        .superRefine((data, ctx) => {
            const isNativeSsh =
                data.mode === "ssh" && data.authDaemonMode === "native";
            const trimmedDestination = data.destination?.trim();
            if (
                !isNativeSsh &&
                (!trimmedDestination || trimmedDestination.length < 1)
            ) {
                ctx.addIssue({
                    code: z.ZodIssueCode.custom,
                    message: destinationRequiredKey
                        ? t(destinationRequiredKey)
                        : "Destination is required",
                    path: ["destination"]
                });
            }
            if (data.mode === "ssh" && !isNativeSsh) {
                if (
                    data.destinationPort == null ||
                    !Number.isFinite(data.destinationPort) ||
                    data.destinationPort < 1
                ) {
                    ctx.addIssue({
                        code: z.ZodIssueCode.custom,
                        message: t("internalResourceHttpPortRequired"),
                        path: ["destinationPort"]
                    });
                }
            }
            if (data.mode !== "http") return;
            if (!data.scheme) {
                ctx.addIssue({
                    code: z.ZodIssueCode.custom,
                    message: t("internalResourceDownstreamSchemeRequired"),
                    path: ["scheme"]
                });
            }
            if (
                !isNativeSsh &&
                (data.destinationPort == null ||
                    !Number.isFinite(data.destinationPort) ||
                    data.destinationPort < 1)
            ) {
                ctx.addIssue({
                    code: z.ZodIssueCode.custom,
                    message: t("internalResourceHttpPortRequired"),
                    path: ["destinationPort"]
                });
            }
        });

    type FormData = z.infer<typeof formSchema>;

    const clientsQuery = useQuery(
        orgQueries.machineClients({ orgId, perPage: 1 })
    );
    const resourceRolesQuery = useQuery({
        ...resourceQueries.siteResourceRoles({
            siteResourceId: siteResourceId ?? 0
        }),
        enabled: siteResourceId != null
    });
    const resourceUsersQuery = useQuery({
        ...resourceQueries.siteResourceUsers({
            siteResourceId: siteResourceId ?? 0
        }),
        enabled: siteResourceId != null
    });
    const resourceClientsQuery = useQuery({
        ...resourceQueries.siteResourceClients({
            siteResourceId: siteResourceId ?? 0
        }),
        enabled: siteResourceId != null
    });

    const allClients = (clientsQuery.data ?? [])
        .filter((c) => !c.userId)
        .map((c) => ({ id: c.clientId.toString(), text: c.name }));

    let formRoles: FormData["roles"] = [];
    let formUsers: FormData["users"] = [];
    let existingClients: FormData["clients"] = [];
    if (siteResourceId != null) {
        const rolesData = resourceRolesQuery.data;
        const usersData = resourceUsersQuery.data;
        const clientsData = resourceClientsQuery.data;
        if (rolesData) {
            formRoles = (rolesData as { roleId: number; name: string }[])
                .map((i) => ({ id: i.roleId.toString(), text: i.name }))
                .filter((r) => r.text !== "Admin");
        }
        if (usersData) {
            formUsers = (
                usersData as {
                    userId: string;
                    email?: string;
                    username?: string;
                    type?: string;
                    idpName?: string;
                }[]
            ).map((i) => ({
                id: i.userId.toString(),
                text: `${getUserDisplayName({ email: i.email, username: i.username })}${i.type !== UserType.Internal ? ` (${i.idpName})` : ""}`
            }));
        }
        if (clientsData) {
            existingClients = [
                ...(clientsData as { clientId: number; name: string }[])
            ];
        }
    }

    const loadingRolesUsers =
        clientsQuery.isLoading ||
        (siteResourceId != null &&
            (resourceRolesQuery.isLoading ||
                resourceUsersQuery.isLoading ||
                resourceClientsQuery.isLoading));

    const hasMachineClients = allClients.length > 0;

    const [sshServerMode, setSshServerMode] = useState<"standard" | "native">(
        () => {
            if (variant === "edit" && resource) {
                return resource.authDaemonMode === "native"
                    ? "native"
                    : "standard";
            }
            return "native";
        }
    );

    const [tcpPortMode, setTcpPortMode] = useState<PortMode>(() =>
        variant === "edit" && resource
            ? getPortModeFromString(resource.tcpPortRangeString)
            : "all"
    );
    const [udpPortMode, setUdpPortMode] = useState<PortMode>(() =>
        variant === "edit" && resource
            ? getPortModeFromString(resource.udpPortRangeString)
            : "all"
    );
    const [tcpCustomPorts, setTcpCustomPorts] = useState<string>(() =>
        variant === "edit" &&
        resource &&
        resource.tcpPortRangeString &&
        resource.tcpPortRangeString !== "*"
            ? resource.tcpPortRangeString
            : ""
    );
    const [udpCustomPorts, setUdpCustomPorts] = useState<string>(() =>
        variant === "edit" &&
        resource &&
        resource.udpPortRangeString &&
        resource.udpPortRangeString !== "*"
            ? resource.udpPortRangeString
            : ""
    );

    const defaultValues: FormData =
        variant === "edit" && resource
            ? {
                  name: resource.name,
                  siteIds: resource.siteIds,
                  mode: resource.mode ?? "host",
                  destination: resource.destination ?? "",
                  alias: resource.alias ?? null,
                  tcpPortRangeString: resource.tcpPortRangeString ?? "*",
                  udpPortRangeString: resource.udpPortRangeString ?? "*",
                  disableIcmp: resource.disableIcmp ?? false,
                  authDaemonMode:
                      resource.authDaemonMode === "native"
                          ? "native"
                          : (resource.authDaemonMode ?? "site"),
                  authDaemonPort: resource.authDaemonPort ?? null,
                  pamMode: resource.pamMode ?? "passthrough",
                  destinationPort: resource.destinationPort ?? null,
                  scheme: resource.scheme ?? "http",
                  ssl: resource.ssl ?? false,
                  httpConfigSubdomain: resource.subdomain ?? null,
                  httpConfigDomainId: resource.domainId ?? null,
                  httpConfigFullDomain: resource.fullDomain ?? null,
                  niceId: resource.niceId,
                  roles: [],
                  users: [],
                  clients: []
              }
            : {
                  name: "",
                  siteIds: [],
                  mode: "host",
                  destination: "",
                  alias: null,
                  destinationPort: null,
                  scheme: "http",
                  ssl: true,
                  httpConfigSubdomain: null,
                  httpConfigDomainId: null,
                  httpConfigFullDomain: null,
                  tcpPortRangeString: "*",
                  udpPortRangeString: "*",
                  disableIcmp: false,
                  authDaemonMode: "native",
                  authDaemonPort: null,
                  pamMode: "passthrough",
                  roles: [],
                  users: [],
                  clients: []
              };

    const [selectedSites, setSelectedSites] = useState<Selectedsite[]>(() =>
        variant === "edit" && resource
            ? buildSelectedSitesForResource(resource)
            : []
    );

    const form = useForm<FormData>({
        resolver: zodResolver(formSchema),
        defaultValues
    });

    const mode = form.watch("mode");
    const aliasValue = form.watch("alias");
    const httpConfigSubdomain = form.watch("httpConfigSubdomain");
    const httpConfigDomainId = form.watch("httpConfigDomainId");
    const httpConfigFullDomain = form.watch("httpConfigFullDomain");
    const isHttpMode = mode === "http";
    const isSshMode = mode === "ssh";
    const authDaemonMode = form.watch("authDaemonMode") ?? "site";
    const pamMode = form.watch("pamMode") ?? "passthrough";
    const isNative = sshServerMode === "native";
    const showDaemonLocation =
        mode === "ssh" && !isNative && pamMode === "push";
    const showDaemonPort =
        mode === "ssh" &&
        !isNative &&
        pamMode === "push" &&
        authDaemonMode === "remote";
    const aliasEndsWithLocal =
        typeof aliasValue === "string" &&
        aliasValue.trim().toLowerCase().endsWith(".local");
    const hasInitialized = useRef(false);
    const previousResourceId = useRef<number | null>(null);
    const initialSitesRef = useRef(initialSites);
    initialSitesRef.current = initialSites;

    useEffect(() => {
        const tcpValue = getPortStringFromMode(tcpPortMode, tcpCustomPorts);
        form.setValue("tcpPortRangeString", tcpValue);
    }, [tcpPortMode, tcpCustomPorts, form]);

    useEffect(() => {
        const udpValue = getPortStringFromMode(udpPortMode, udpCustomPorts);
        form.setValue("udpPortRangeString", udpValue);
    }, [udpPortMode, udpCustomPorts, form]);

    // Reset when create dialog opens
    useEffect(() => {
        if (variant === "create" && open) {
            const prefillSites =
                initialSitesRef.current.length > 0
                    ? initialSitesRef.current
                    : [];
            form.reset({
                name: "",
                siteIds: prefillSites.map((s) => s.siteId),
                mode: "host",
                destination: "",
                alias: null,
                destinationPort: null,
                scheme: "http",
                ssl: true,
                httpConfigSubdomain: null,
                httpConfigDomainId: null,
                httpConfigFullDomain: null,
                tcpPortRangeString: "*",
                udpPortRangeString: "*",
                disableIcmp: false,
                authDaemonMode: "native",
                authDaemonPort: null,
                pamMode: "passthrough",
                roles: [],
                users: [],
                clients: []
            });
            setSelectedSites(prefillSites);
            setSshServerMode("native");
            setTcpPortMode("all");
            setUdpPortMode("all");
            setTcpCustomPorts("");
            setUdpCustomPorts("");
        }
    }, [variant, open, form]);

    // Reset when edit dialog opens / resource changes
    useEffect(() => {
        if (variant === "edit" && resource) {
            const resourceChanged = previousResourceId.current !== resource.id;
            if (resourceChanged) {
                form.reset({
                    name: resource.name,
                    siteIds: resource.siteIds,
                    mode: resource.mode ?? "host",
                    destination: resource.destination ?? "",
                    alias: resource.alias ?? null,
                    destinationPort: resource.destinationPort ?? null,
                    scheme: resource.scheme ?? "http",
                    ssl: resource.ssl ?? false,
                    httpConfigSubdomain: resource.subdomain ?? null,
                    httpConfigDomainId: resource.domainId ?? null,
                    httpConfigFullDomain: resource.fullDomain ?? null,
                    tcpPortRangeString: resource.tcpPortRangeString ?? "*",
                    udpPortRangeString: resource.udpPortRangeString ?? "*",
                    disableIcmp: resource.disableIcmp ?? false,
                    authDaemonMode:
                        resource.authDaemonMode === "native"
                            ? "native"
                            : (resource.authDaemonMode ?? "site"),
                    authDaemonPort: resource.authDaemonPort ?? null,
                    pamMode: resource.pamMode ?? "passthrough",
                    roles: [],
                    users: [],
                    clients: []
                });
                setSshServerMode(
                    resource.authDaemonMode === "native" ? "native" : "standard"
                );
                setSelectedSites(buildSelectedSitesForResource(resource));
                setTcpPortMode(
                    getPortModeFromString(resource.tcpPortRangeString)
                );
                setUdpPortMode(
                    getPortModeFromString(resource.udpPortRangeString)
                );
                setTcpCustomPorts(
                    resource.tcpPortRangeString &&
                        resource.tcpPortRangeString !== "*"
                        ? resource.tcpPortRangeString
                        : ""
                );
                setUdpCustomPorts(
                    resource.udpPortRangeString &&
                        resource.udpPortRangeString !== "*"
                        ? resource.udpPortRangeString
                        : ""
                );
                previousResourceId.current = resource.id;
            }
        }
    }, [variant, resource, form]);

    // When edit dialog closes, clear previousResourceId so next open (for any resource) resets from fresh data
    useEffect(() => {
        if (variant === "edit" && open === false) {
            previousResourceId.current = null;
        }
    }, [variant, open]);

    // Populate roles/users/clients when edit data is loaded
    useEffect(() => {
        if (
            variant === "edit" &&
            siteResourceId != null &&
            !loadingRolesUsers &&
            !hasInitialized.current
        ) {
            hasInitialized.current = true;
            form.setValue("roles", formRoles);
            form.setValue("users", formUsers);
            form.setValue("clients", existingClients);
        }
    }, [
        variant,
        siteResourceId,
        loadingRolesUsers,
        formRoles,
        formUsers,
        existingClients,
        form
    ]);

    useEffect(() => {
        onSubmitDisabledChange?.(
            (isHttpMode && httpSectionDisabled) ||
                (isSshMode && sshSectionDisabled)
        );
    }, [
        isHttpMode,
        httpSectionDisabled,
        isSshMode,
        sshSectionDisabled,
        onSubmitDisabledChange
    ]);

    return (
        <Form {...form}>
            <form
                onSubmit={form.handleSubmit((values) => {
                    const siteIds = values.siteIds;
                    const trimmedDestination = values.destination?.trim();
                    const isSshMode = values.mode === "ssh";
                    onSubmit({
                        ...values,
                        siteIds,
                        destination:
                            trimmedDestination && trimmedDestination.length > 0
                                ? trimmedDestination
                                : null,
                        tcpPortRangeString: isSshMode
                            ? undefined
                            : values.tcpPortRangeString,
                        udpPortRangeString: isSshMode
                            ? undefined
                            : values.udpPortRangeString,
                        clients: (values.clients ?? []).map((c) => ({
                            id: c.clientId.toString(),
                            text: c.name
                        }))
                    });
                })}
                className="space-y-6"
                id={formId}
            >
                <div className="grid grid-cols-2 gap-4">
                    <FormField
                        control={form.control}
                        name="name"
                        render={({ field }) => (
                            <FormItem>
                                <FormLabel>{t(nameLabelKey)}</FormLabel>
                                <FormControl>
                                    <Input {...field} />
                                </FormControl>
                                <FormMessage />
                            </FormItem>
                        )}
                    />
                    {variant === "edit" && (
                        <FormField
                            control={form.control}
                            name="niceId"
                            render={({ field }) => (
                                <FormItem>
                                    <FormLabel>{t("identifier")}</FormLabel>
                                    <FormControl>
                                        <Input {...field} />
                                    </FormControl>
                                    <FormMessage />
                                </FormItem>
                            )}
                        />
                    )}
                </div>

                <HorizontalTabs
                    clientSide
                    items={[
                        {
                            title: t(
                                "editInternalResourceDialogNetworkSettings"
                            ),
                            href: "#"
                        },
                        {
                            title: t("editInternalResourceDialogAccessPolicy"),
                            href: "#"
                        },
                        ...(disableEnterpriseFeatures || mode !== "ssh"
                            ? []
                            : [{ title: t("sshSettings"), href: "#" }])
                    ]}
                >
                    <div className="space-y-4 mt-4 p-1">
                        <div>
                            <div className="mb-8">
                                <label className="font-medium block">
                                    {t(
                                        "editInternalResourceDialogDestinationLabel"
                                    )}
                                </label>
                                <div className="text-sm text-muted-foreground">
                                    {t(
                                        "editInternalResourceDialogDestinationDescription"
                                    )}
                                </div>
                            </div>
                            <div className="space-y-2 mb-4">
                                <div className="grid grid-cols-3 gap-4 items-start">
                                    <div className="min-w-0 col-span-1">
                                        <FormField
                                            control={form.control}
                                            name="siteIds"
                                            render={({ field }) => (
                                                <FormItem className="flex flex-col">
                                                    <FormLabel>
                                                        {t("sites")}
                                                    </FormLabel>
                                                    {mode === "ssh" &&
                                                    (sshServerMode ===
                                                        "native" ||
                                                        (pamMode === "push" &&
                                                            authDaemonMode ===
                                                                "site")) ? (
                                                        <Popover>
                                                            <PopoverTrigger
                                                                asChild
                                                            >
                                                                <FormControl>
                                                                    <Button
                                                                        variant="outline"
                                                                        role="combobox"
                                                                        className={cn(
                                                                            "w-full justify-between",
                                                                            selectedSites.length ===
                                                                                0 &&
                                                                                "text-muted-foreground"
                                                                        )}
                                                                    >
                                                                        <span className="truncate text-left">
                                                                            {selectedSites[0]
                                                                                ?.name ??
                                                                                t(
                                                                                    "selectSite"
                                                                                )}
                                                                        </span>
                                                                        <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                                                                    </Button>
                                                                </FormControl>
                                                            </PopoverTrigger>
                                                            <PopoverContent className="w-full p-0">
                                                                <SitesSelector
                                                                    orgId={
                                                                        orgId
                                                                    }
                                                                    selectedSite={
                                                                        selectedSites[0] ??
                                                                        null
                                                                    }
                                                                    filterTypes={[
                                                                        "newt"
                                                                    ]}
                                                                    onSelectSite={(
                                                                        site
                                                                    ) => {
                                                                        setSelectedSites(
                                                                            [
                                                                                site
                                                                            ]
                                                                        );
                                                                        field.onChange(
                                                                            [
                                                                                site.siteId
                                                                            ]
                                                                        );
                                                                    }}
                                                                />
                                                            </PopoverContent>
                                                        </Popover>
                                                    ) : (
                                                        <Popover>
                                                            <PopoverTrigger
                                                                asChild
                                                            >
                                                                <FormControl>
                                                                    <Button
                                                                        variant="outline"
                                                                        role="combobox"
                                                                        className={cn(
                                                                            "w-full justify-between",
                                                                            selectedSites.length ===
                                                                                0 &&
                                                                                "text-muted-foreground"
                                                                        )}
                                                                    >
                                                                        <span className="truncate text-left">
                                                                            {formatMultiSitesSelectorLabel(
                                                                                selectedSites,
                                                                                t
                                                                            )}
                                                                        </span>
                                                                        <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                                                                    </Button>
                                                                </FormControl>
                                                            </PopoverTrigger>
                                                            <PopoverContent className="w-full p-0">
                                                                <MultiSitesSelector
                                                                    orgId={
                                                                        orgId
                                                                    }
                                                                    selectedSites={
                                                                        selectedSites
                                                                    }
                                                                    filterTypes={[
                                                                        "newt"
                                                                    ]}
                                                                    onSelectionChange={(
                                                                        sites
                                                                    ) => {
                                                                        setSelectedSites(
                                                                            sites
                                                                        );
                                                                        field.onChange(
                                                                            sites.map(
                                                                                (
                                                                                    s
                                                                                ) =>
                                                                                    s.siteId
                                                                            )
                                                                        );
                                                                    }}
                                                                />
                                                            </PopoverContent>
                                                        </Popover>
                                                    )}
                                                    <FormMessage />
                                                </FormItem>
                                            )}
                                        />
                                    </div>
                                    <div className="min-w-0 col-span-2">
                                        <FormField
                                            control={form.control}
                                            name="mode"
                                            render={({ field }) => {
                                                const modeOptions: OptionSelectOption<InternalResourceMode>[] =
                                                    [
                                                        {
                                                            value: "host",
                                                            label: t(
                                                                modeHostKey
                                                            )
                                                        },
                                                        {
                                                            value: "cidr",
                                                            label: t(
                                                                modeCidrKey
                                                            )
                                                        },
                                                        ...(!disableEnterpriseFeatures
                                                            ? [
                                                                  {
                                                                      value: "http" as const,
                                                                      label: t(
                                                                          modeHttpKey
                                                                      )
                                                                  },
                                                                  {
                                                                      value: "ssh" as const,
                                                                      label: t(
                                                                          modeSshKey
                                                                      )
                                                                  }
                                                              ]
                                                            : [])
                                                    ];
                                                return (
                                                    <FormItem>
                                                        <FormLabel>
                                                            {t(modeLabelKey)}
                                                        </FormLabel>
                                                        <OptionSelect<InternalResourceMode>
                                                            options={
                                                                modeOptions
                                                            }
                                                            value={field.value}
                                                            onChange={(
                                                                newMode
                                                            ) => {
                                                                field.onChange(
                                                                    newMode
                                                                );
                                                                if (
                                                                    newMode ===
                                                                    "ssh"
                                                                ) {
                                                                    form.setValue(
                                                                        "destinationPort",
                                                                        22
                                                                    );
                                                                } else if (
                                                                    newMode ===
                                                                    "http"
                                                                ) {
                                                                    form.setValue(
                                                                        "destinationPort",
                                                                        443
                                                                    );
                                                                } else {
                                                                    form.setValue(
                                                                        "destinationPort",
                                                                        null
                                                                    );
                                                                }
                                                            }}
                                                            cols={2}
                                                        />
                                                        <FormMessage />
                                                    </FormItem>
                                                );
                                            }}
                                        />
                                    </div>
                                </div>
                                {selectedSites.length > 1 && (
                                    <p className="text-sm text-muted-foreground">
                                        {t(
                                            "internalResourceFormMultiSiteRoutingHelp"
                                        )}{" "}
                                        <a
                                            href="https://docs.pangolin.net/manage/resources/private/multi-site-routing"
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="text-primary hover:underline inline-flex items-center gap-1"
                                        >
                                            {t(
                                                "internalResourceFormMultiSiteRoutingHelpLearnMore"
                                            )}
                                            <ExternalLink className="size-3.5 shrink-0" />
                                        </a>
                                        .
                                    </p>
                                )}
                            </div>
                            <div
                                className={cn(
                                    "grid gap-4 items-start",
                                    mode === "cidr" && "grid-cols-1",
                                    mode === "http" && "grid-cols-3",
                                    mode === "host" && "grid-cols-2",
                                    mode === "ssh" &&
                                        sshServerMode !== "native" &&
                                        "grid-cols-3"
                                )}
                            >
                                {mode === "http" && (
                                    <div className="min-w-0">
                                        <FormField
                                            control={form.control}
                                            name="scheme"
                                            render={({ field }) => (
                                                <FormItem>
                                                    <FormLabel>
                                                        {t(schemeLabelKey)}
                                                    </FormLabel>
                                                    <Select
                                                        onValueChange={
                                                            field.onChange
                                                        }
                                                        value={
                                                            field.value ??
                                                            "http"
                                                        }
                                                        disabled={
                                                            httpSectionDisabled
                                                        }
                                                    >
                                                        <FormControl>
                                                            <SelectTrigger className="w-full">
                                                                <SelectValue />
                                                            </SelectTrigger>
                                                        </FormControl>
                                                        <SelectContent>
                                                            <SelectItem value="http">
                                                                http
                                                            </SelectItem>
                                                            <SelectItem value="https">
                                                                https
                                                            </SelectItem>
                                                        </SelectContent>
                                                    </Select>
                                                    <FormMessage />
                                                </FormItem>
                                            )}
                                        />
                                    </div>
                                )}
                                {((mode === "ssh" &&
                                    sshServerMode !== "native") ||
                                    mode === "http" ||
                                    mode === "host" ||
                                    mode === "cidr") && (
                                    <div
                                        className={cn(
                                            mode === "cidr" && "col-span-1",
                                            (mode === "http" ||
                                                mode === "host" ||
                                                mode === "ssh") &&
                                                "min-w-0"
                                        )}
                                    >
                                        <FormField
                                            control={form.control}
                                            name="destination"
                                            render={({ field }) => (
                                                <FormItem>
                                                    <FormLabel>
                                                        {t(destinationLabelKey)}
                                                    </FormLabel>
                                                    <FormControl>
                                                        <Input
                                                            {...field}
                                                            className="w-full"
                                                            value={
                                                                field.value ??
                                                                ""
                                                            }
                                                            disabled={
                                                                (isHttpMode &&
                                                                    httpSectionDisabled) ||
                                                                (isSshMode &&
                                                                    sshSectionDisabled)
                                                            }
                                                            onChange={(e) =>
                                                                field.onChange(
                                                                    e.target
                                                                        .value ===
                                                                        ""
                                                                        ? null
                                                                        : e
                                                                              .target
                                                                              .value
                                                                )
                                                            }
                                                        />
                                                    </FormControl>
                                                    <FormMessage />
                                                </FormItem>
                                            )}
                                        />
                                    </div>
                                )}
                                {(mode === "host" || mode === "ssh") && (
                                    <div className="min-w-0">
                                        <FormField
                                            control={form.control}
                                            name="alias"
                                            render={({ field }) => (
                                                <FormItem>
                                                    <FormLabel>
                                                        {t(aliasLabelKey)}
                                                    </FormLabel>
                                                    <FormControl>
                                                        <Input
                                                            {...field}
                                                            className="w-full"
                                                            value={
                                                                field.value ??
                                                                ""
                                                            }
                                                            disabled={
                                                                isSshMode &&
                                                                sshSectionDisabled
                                                            }
                                                        />
                                                    </FormControl>
                                                    {aliasEndsWithLocal && (
                                                        <p className="text-xs text-amber-700/80 mt-1">
                                                            {t(
                                                                "internalResourceAliasLocalWarning"
                                                            )}
                                                        </p>
                                                    )}
                                                    <FormMessage />
                                                </FormItem>
                                            )}
                                        />
                                    </div>
                                )}
                                {(mode === "http" ||
                                    (mode === "ssh" &&
                                        sshServerMode !== "native")) && (
                                    <div className="min-w-0">
                                        <FormField
                                            control={form.control}
                                            name="destinationPort"
                                            render={({ field }) => (
                                                <FormItem>
                                                    <FormLabel>
                                                        {t(
                                                            destinationPortLabelKey
                                                        )}
                                                    </FormLabel>
                                                    <FormControl>
                                                        <Input
                                                            className="w-full"
                                                            type="number"
                                                            min={1}
                                                            max={65535}
                                                            value={
                                                                field.value ??
                                                                ""
                                                            }
                                                            disabled={
                                                                (isHttpMode &&
                                                                    httpSectionDisabled) ||
                                                                (isSshMode &&
                                                                    sshSectionDisabled)
                                                            }
                                                            onChange={(e) => {
                                                                const raw =
                                                                    e.target
                                                                        .value;
                                                                if (
                                                                    raw === ""
                                                                ) {
                                                                    field.onChange(
                                                                        null
                                                                    );
                                                                    return;
                                                                }
                                                                const n =
                                                                    Number(raw);
                                                                field.onChange(
                                                                    Number.isFinite(
                                                                        n
                                                                    )
                                                                        ? n
                                                                        : null
                                                                );
                                                            }}
                                                        />
                                                    </FormControl>
                                                    <FormMessage />
                                                </FormItem>
                                            )}
                                        />
                                    </div>
                                )}
                            </div>
                        </div>

                        {(isHttpMode || isSshMode) && (
                            <PaidFeaturesAlert
                                tiers={tierMatrix.advancedPrivateResources}
                            />
                        )}

                        {isHttpMode ? (
                            <div className="space-y-4">
                                <div className="my-8">
                                    <label className="font-medium block">
                                        {t(httpConfigurationTitleKey)}
                                    </label>
                                    <div className="text-sm text-muted-foreground">
                                        {t(httpConfigurationDescriptionKey)}
                                    </div>
                                </div>
                                <div
                                    className={
                                        httpSectionDisabled
                                            ? "pointer-events-none opacity-50"
                                            : undefined
                                    }
                                >
                                    <DomainPicker
                                        key={
                                            variant === "edit" && siteResourceId
                                                ? `http-domain-${siteResourceId}`
                                                : "http-domain-create"
                                        }
                                        orgId={orgId}
                                        cols={2}
                                        hideFreeDomain
                                        defaultSubdomain={
                                            httpConfigSubdomain ?? undefined
                                        }
                                        defaultDomainId={
                                            httpConfigDomainId ?? undefined
                                        }
                                        defaultFullDomain={
                                            httpConfigFullDomain ?? undefined
                                        }
                                        onDomainChange={(res) => {
                                            if (res === null) {
                                                form.setValue(
                                                    "httpConfigSubdomain",
                                                    null
                                                );
                                                form.setValue(
                                                    "httpConfigDomainId",
                                                    null
                                                );
                                                form.setValue(
                                                    "httpConfigFullDomain",
                                                    null
                                                );
                                                return;
                                            }
                                            form.setValue(
                                                "httpConfigSubdomain",
                                                res.subdomain ?? null
                                            );
                                            form.setValue(
                                                "httpConfigDomainId",
                                                res.domainId
                                            );
                                            form.setValue(
                                                "httpConfigFullDomain",
                                                res.fullDomain
                                            );
                                        }}
                                    />
                                </div>
                                <div className="flex items-start justify-between gap-4">
                                    <FormField
                                        control={form.control}
                                        name="ssl"
                                        render={({ field }) => (
                                            <FormItem className="flex-1">
                                                <FormControl>
                                                    <SwitchInput
                                                        id="internal-resource-ssl"
                                                        label={t(
                                                            enableSslLabelKey
                                                        )}
                                                        description={t(
                                                            enableSslDescriptionKey
                                                        )}
                                                        checked={!!field.value}
                                                        onCheckedChange={
                                                            field.onChange
                                                        }
                                                        disabled={
                                                            httpSectionDisabled
                                                        }
                                                    />
                                                </FormControl>
                                            </FormItem>
                                        )}
                                    />
                                    {variant === "edit" &&
                                        resource?.domainId &&
                                        httpConfigFullDomain &&
                                        httpConfigDomainId ===
                                            resource.domainId &&
                                        httpConfigFullDomain ===
                                            resource.fullDomain &&
                                        build != "oss" &&
                                        form.watch("ssl") && (
                                            <div className="flex items-center gap-2 pt-1">
                                                <span className="text-sm font-medium">
                                                    {t("certificateStatus")}:
                                                </span>
                                                <CertificateStatus
                                                    orgId={resource.orgId}
                                                    domainId={resource.domainId}
                                                    fullDomain={
                                                        httpConfigFullDomain
                                                    }
                                                    autoFetch={true}
                                                    showLabel={false}
                                                    polling={true}
                                                />
                                            </div>
                                        )}
                                </div>
                            </div>
                        ) : (
                            <div className="space-y-4">
                                {mode !== "ssh" && (
                                    <>
                                        <div className="my-8">
                                            <label className="font-medium block">
                                                {t("portRestrictions")}
                                            </label>
                                            <div className="text-sm text-muted-foreground">
                                                {t(
                                                    "editInternalResourceDialogPortRestrictionsDescription"
                                                )}
                                            </div>
                                        </div>
                                        <div
                                            className={cn(
                                                "grid gap-4 items-start",
                                                mode === "cidr"
                                                    ? "grid-cols-4"
                                                    : "grid-cols-12"
                                            )}
                                        >
                                            <div
                                                className={
                                                    mode === "cidr"
                                                        ? "col-span-1"
                                                        : "col-span-3"
                                                }
                                            >
                                                <FormLabel className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70">
                                                    {t(
                                                        "editInternalResourceDialogTcp"
                                                    )}
                                                </FormLabel>
                                            </div>
                                            <div
                                                className={
                                                    mode === "cidr"
                                                        ? "col-span-3"
                                                        : "col-span-9"
                                                }
                                            >
                                                <FormField
                                                    control={form.control}
                                                    name="tcpPortRangeString"
                                                    render={() => (
                                                        <FormItem>
                                                            <div className="flex items-center gap-2">
                                                                <Select
                                                                    value={
                                                                        tcpPortMode
                                                                    }
                                                                    onValueChange={(
                                                                        v: PortMode
                                                                    ) =>
                                                                        setTcpPortMode(
                                                                            v
                                                                        )
                                                                    }
                                                                >
                                                                    <FormControl>
                                                                        <SelectTrigger className="w-[110px]">
                                                                            <SelectValue />
                                                                        </SelectTrigger>
                                                                    </FormControl>
                                                                    <SelectContent>
                                                                        <SelectItem value="all">
                                                                            {t(
                                                                                "allPorts"
                                                                            )}
                                                                        </SelectItem>
                                                                        <SelectItem value="blocked">
                                                                            {t(
                                                                                "blocked"
                                                                            )}
                                                                        </SelectItem>
                                                                        <SelectItem value="custom">
                                                                            {t(
                                                                                "custom"
                                                                            )}
                                                                        </SelectItem>
                                                                    </SelectContent>
                                                                </Select>
                                                                {tcpPortMode ===
                                                                "custom" ? (
                                                                    <FormControl>
                                                                        <Input
                                                                            placeholder="80,443,8000-9000"
                                                                            value={
                                                                                tcpCustomPorts
                                                                            }
                                                                            onChange={(
                                                                                e
                                                                            ) =>
                                                                                setTcpCustomPorts(
                                                                                    e
                                                                                        .target
                                                                                        .value
                                                                                )
                                                                            }
                                                                        />
                                                                    </FormControl>
                                                                ) : (
                                                                    <Input
                                                                        disabled
                                                                        placeholder={
                                                                            tcpPortMode ===
                                                                            "all"
                                                                                ? t(
                                                                                      "allPortsAllowed"
                                                                                  )
                                                                                : t(
                                                                                      "allPortsBlocked"
                                                                                  )
                                                                        }
                                                                    />
                                                                )}
                                                            </div>
                                                            <FormMessage />
                                                        </FormItem>
                                                    )}
                                                />
                                            </div>
                                        </div>
                                        <div
                                            className={cn(
                                                "grid gap-4 items-start",
                                                mode === "cidr"
                                                    ? "grid-cols-4"
                                                    : "grid-cols-12"
                                            )}
                                        >
                                            <div
                                                className={
                                                    mode === "cidr"
                                                        ? "col-span-1"
                                                        : "col-span-3"
                                                }
                                            >
                                                <FormLabel className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70">
                                                    {t(
                                                        "editInternalResourceDialogUdp"
                                                    )}
                                                </FormLabel>
                                            </div>
                                            <div
                                                className={
                                                    mode === "cidr"
                                                        ? "col-span-3"
                                                        : "col-span-9"
                                                }
                                            >
                                                <FormField
                                                    control={form.control}
                                                    name="udpPortRangeString"
                                                    render={() => (
                                                        <FormItem>
                                                            <div className="flex items-center gap-2">
                                                                <Select
                                                                    value={
                                                                        udpPortMode
                                                                    }
                                                                    onValueChange={(
                                                                        v: PortMode
                                                                    ) =>
                                                                        setUdpPortMode(
                                                                            v
                                                                        )
                                                                    }
                                                                >
                                                                    <FormControl>
                                                                        <SelectTrigger className="w-[110px]">
                                                                            <SelectValue />
                                                                        </SelectTrigger>
                                                                    </FormControl>
                                                                    <SelectContent>
                                                                        <SelectItem value="all">
                                                                            {t(
                                                                                "allPorts"
                                                                            )}
                                                                        </SelectItem>
                                                                        <SelectItem value="blocked">
                                                                            {t(
                                                                                "blocked"
                                                                            )}
                                                                        </SelectItem>
                                                                        <SelectItem value="custom">
                                                                            {t(
                                                                                "custom"
                                                                            )}
                                                                        </SelectItem>
                                                                    </SelectContent>
                                                                </Select>
                                                                {udpPortMode ===
                                                                "custom" ? (
                                                                    <FormControl>
                                                                        <Input
                                                                            placeholder="53,123,500-600"
                                                                            value={
                                                                                udpCustomPorts
                                                                            }
                                                                            onChange={(
                                                                                e
                                                                            ) =>
                                                                                setUdpCustomPorts(
                                                                                    e
                                                                                        .target
                                                                                        .value
                                                                                )
                                                                            }
                                                                        />
                                                                    </FormControl>
                                                                ) : (
                                                                    <Input
                                                                        disabled
                                                                        placeholder={
                                                                            udpPortMode ===
                                                                            "all"
                                                                                ? t(
                                                                                      "allPortsAllowed"
                                                                                  )
                                                                                : t(
                                                                                      "allPortsBlocked"
                                                                                  )
                                                                        }
                                                                    />
                                                                )}
                                                            </div>
                                                            <FormMessage />
                                                        </FormItem>
                                                    )}
                                                />
                                            </div>
                                        </div>
                                        <div
                                            className={cn(
                                                "grid gap-4 items-start",
                                                mode === "cidr"
                                                    ? "grid-cols-4"
                                                    : "grid-cols-12"
                                            )}
                                        >
                                            <div
                                                className={
                                                    mode === "cidr"
                                                        ? "col-span-1"
                                                        : "col-span-3"
                                                }
                                            >
                                                <FormLabel className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70">
                                                    {t(
                                                        "editInternalResourceDialogIcmp"
                                                    )}
                                                </FormLabel>
                                            </div>
                                            <div
                                                className={
                                                    mode === "cidr"
                                                        ? "col-span-3"
                                                        : "col-span-9"
                                                }
                                            >
                                                <FormField
                                                    control={form.control}
                                                    name="disableIcmp"
                                                    render={({ field }) => (
                                                        <FormItem>
                                                            <div className="flex items-center gap-2">
                                                                <FormControl>
                                                                    <Switch
                                                                        checked={
                                                                            !field.value
                                                                        }
                                                                        onCheckedChange={(
                                                                            checked
                                                                        ) =>
                                                                            field.onChange(
                                                                                !checked
                                                                            )
                                                                        }
                                                                    />
                                                                </FormControl>
                                                                <span className="text-sm text-muted-foreground">
                                                                    {field.value
                                                                        ? t(
                                                                              "blocked"
                                                                          )
                                                                        : t(
                                                                              "allowed"
                                                                          )}
                                                                </span>
                                                            </div>
                                                            <FormMessage />
                                                        </FormItem>
                                                    )}
                                                />
                                            </div>
                                        </div>
                                    </>
                                )}
                            </div>
                        )}
                    </div>

                    <div className="space-y-4 mt-4 p-1">
                        <div className="mb-8">
                            <label className="font-medium block">
                                {t("editInternalResourceDialogAccessControl")}
                            </label>
                            <div className="text-sm text-muted-foreground">
                                {t(
                                    "editInternalResourceDialogAccessControlDescription"
                                )}
                            </div>
                        </div>
                        {loadingRolesUsers ? (
                            <div className="text-sm text-muted-foreground">
                                {t("loading")}
                            </div>
                        ) : (
                            <div className="space-y-4">
                                <FormField
                                    control={form.control}
                                    name="roles"
                                    render={({ field }) => (
                                        <FormItem className="flex flex-col items-start">
                                            <FormLabel>{t("roles")}</FormLabel>
                                            <FormControl>
                                                <RolesSelector
                                                    selectedRoles={
                                                        field.value ?? []
                                                    }
                                                    orgId={orgId}
                                                    restrictAdminRole
                                                    onSelectRoles={(
                                                        newUsers
                                                    ) => {
                                                        form.setValue(
                                                            "roles",
                                                            newUsers as [
                                                                Tag,
                                                                ...Tag[]
                                                            ]
                                                        );
                                                    }}
                                                />
                                            </FormControl>
                                            <FormMessage />
                                        </FormItem>
                                    )}
                                />
                                <FormField
                                    control={form.control}
                                    name="users"
                                    render={({ field }) => (
                                        <FormItem className="flex flex-col items-start">
                                            <FormLabel>{t("users")}</FormLabel>
                                            <UsersSelector
                                                selectedUsers={
                                                    field.value ?? []
                                                }
                                                orgId={orgId}
                                                onSelectUsers={(newUsers) => {
                                                    form.setValue(
                                                        "users",
                                                        newUsers as [
                                                            Tag,
                                                            ...Tag[]
                                                        ]
                                                    );
                                                }}
                                            />
                                            <FormMessage />
                                        </FormItem>
                                    )}
                                />
                                {hasMachineClients && (
                                    <FormField
                                        control={form.control}
                                        name="clients"
                                        render={({ field }) => (
                                            <FormItem className="flex flex-col items-start">
                                                <FormLabel>
                                                    {t("machineClients")}
                                                </FormLabel>
                                                <MachinesSelector
                                                    selectedMachines={
                                                        field.value ?? []
                                                    }
                                                    orgId={orgId}
                                                    onSelectMachines={(
                                                        machines
                                                    ) => {
                                                        form.setValue(
                                                            "clients",
                                                            machines
                                                        );
                                                    }}
                                                />
                                                <FormMessage />
                                            </FormItem>
                                        )}
                                    />
                                )}
                            </div>
                        )}
                    </div>

                    {/* SSH Access tab (ssh mode only) */}
                    {!disableEnterpriseFeatures && mode === "ssh" && (
                        <div className="space-y-4 mt-4 p-1">
                            <PaidFeaturesAlert
                                tiers={tierMatrix.advancedPrivateResources}
                            />

                            {/* Mode */}
                            <div className="space-y-2">
                                <p className="font-semibold text-sm">
                                    {t("sshServerMode")}
                                </p>
                                <StrategySelect<"standard" | "native">
                                    value={sshServerMode}
                                    options={[
                                        {
                                            id: "native",
                                            title: t("sshServerModePangolin"),
                                            description: t(
                                                "sshServerModeNativeDescription"
                                            ),
                                            disabled: sshSectionDisabled
                                        },
                                        {
                                            id: "standard",
                                            title: t("sshServerModeStandard"),
                                            description: t(
                                                "sshServerModeStandardDescription"
                                            ),
                                            disabled: sshSectionDisabled
                                        }
                                    ]}
                                    onChange={(v) => {
                                        if (sshSectionDisabled) return;
                                        setSshServerMode(v);
                                        if (v === "native") {
                                            form.setValue(
                                                "authDaemonMode",
                                                "native"
                                            );
                                            form.setValue(
                                                "authDaemonPort",
                                                null
                                            );
                                            // Trim to single site
                                            if (selectedSites.length > 1) {
                                                const first =
                                                    selectedSites.slice(0, 1);
                                                setSelectedSites(first);
                                                form.setValue(
                                                    "siteIds",
                                                    first.map((s) => s.siteId)
                                                );
                                            }
                                        } else {
                                            form.setValue(
                                                "authDaemonMode",
                                                "site"
                                            );
                                        }
                                    }}
                                    cols={2}
                                />
                            </div>

                            <div className="space-y-2">
                                <p className="font-semibold text-sm">
                                    {t("sshAuthenticationMethod")}
                                </p>
                                <FormField
                                    control={form.control}
                                    name="pamMode"
                                    render={({ field }) => (
                                        <FormItem>
                                            <FormControl>
                                                <StrategySelect<
                                                    "passthrough" | "push"
                                                >
                                                    value={
                                                        field.value ??
                                                        "passthrough"
                                                    }
                                                    options={[
                                                        {
                                                            id: "passthrough",
                                                            title: t(
                                                                "sshAuthMethodManual"
                                                            ),
                                                            description: t(
                                                                "sshAuthMethodManualDescription"
                                                            ),
                                                            disabled:
                                                                sshSectionDisabled
                                                        },
                                                        {
                                                            id: "push",
                                                            title: t(
                                                                "sshAuthMethodAutomated"
                                                            ),
                                                            description: t(
                                                                "sshAuthMethodAutomatedDescription"
                                                            ),
                                                            disabled:
                                                                sshSectionDisabled
                                                        }
                                                    ]}
                                                    onChange={(v) => {
                                                        if (sshSectionDisabled)
                                                            return;
                                                        field.onChange(v);
                                                        if (
                                                            v === "passthrough"
                                                        ) {
                                                            form.setValue(
                                                                "authDaemonPort",
                                                                null
                                                            );
                                                        } else if (
                                                            v === "push"
                                                        ) {
                                                            // push + site (default) = single site
                                                            const curAuthMode =
                                                                form.getValues(
                                                                    "authDaemonMode"
                                                                );
                                                            if (
                                                                curAuthMode !==
                                                                    "remote" &&
                                                                selectedSites.length >
                                                                    1
                                                            ) {
                                                                const first =
                                                                    selectedSites.slice(
                                                                        0,
                                                                        1
                                                                    );
                                                                setSelectedSites(
                                                                    first
                                                                );
                                                                form.setValue(
                                                                    "siteIds",
                                                                    first.map(
                                                                        (s) =>
                                                                            s.siteId
                                                                    )
                                                                );
                                                            }
                                                        }
                                                    }}
                                                    cols={2}
                                                />
                                            </FormControl>
                                            <FormMessage />
                                        </FormItem>
                                    )}
                                />
                            </div>

                            {/* Daemon Location (standard + push) */}
                            {showDaemonLocation && (
                                <div className="space-y-2">
                                    <p className="font-semibold text-sm">
                                        {t("sshAuthDaemonLocation")}
                                    </p>
                                    <FormField
                                        control={form.control}
                                        name="authDaemonMode"
                                        render={({ field }) => (
                                            <FormItem>
                                                <FormControl>
                                                    <StrategySelect<
                                                        "site" | "remote"
                                                    >
                                                        value={
                                                            (field.value as
                                                                | "site"
                                                                | "remote") ??
                                                            "site"
                                                        }
                                                        options={[
                                                            {
                                                                id: "site",
                                                                title: t(
                                                                    "internalResourceAuthDaemonSite"
                                                                ),
                                                                description: t(
                                                                    "sshDaemonLocationSiteDescription"
                                                                ),
                                                                disabled:
                                                                    sshSectionDisabled
                                                            },
                                                            {
                                                                id: "remote",
                                                                title: t(
                                                                    "sshDaemonLocationRemote"
                                                                ),
                                                                description: t(
                                                                    "sshDaemonLocationRemoteDescription"
                                                                ),
                                                                disabled:
                                                                    sshSectionDisabled
                                                            }
                                                        ]}
                                                        onChange={(v) => {
                                                            if (
                                                                sshSectionDisabled
                                                            )
                                                                return;
                                                            field.onChange(v);
                                                            if (v === "site") {
                                                                form.setValue(
                                                                    "authDaemonPort",
                                                                    null
                                                                );
                                                                // site daemon = single site
                                                                if (
                                                                    selectedSites.length >
                                                                    1
                                                                ) {
                                                                    const first =
                                                                        selectedSites.slice(
                                                                            0,
                                                                            1
                                                                        );
                                                                    setSelectedSites(
                                                                        first
                                                                    );
                                                                    form.setValue(
                                                                        "siteIds",
                                                                        first.map(
                                                                            (
                                                                                s
                                                                            ) =>
                                                                                s.siteId
                                                                        )
                                                                    );
                                                                }
                                                            }
                                                        }}
                                                        cols={2}
                                                    />
                                                </FormControl>
                                                <FormMessage />
                                            </FormItem>
                                        )}
                                    />
                                    <p className="text-sm text-muted-foreground">
                                        {t("sshDaemonDisclaimer")}{" "}
                                        <a
                                            href="https://docs.pangolin.net/manage/ssh"
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="text-primary hover:underline inline-flex items-center gap-1"
                                        >
                                            {t("learnMore")}
                                            <ExternalLink className="size-3.5 shrink-0" />
                                        </a>
                                    </p>
                                </div>
                            )}

                            {/* Daemon Port (standard + push + remote) */}
                            {showDaemonPort && (
                                <div className="w-full md:w-1/2">
                                    <FormField
                                        control={form.control}
                                        name="authDaemonPort"
                                        render={({ field }) => (
                                            <FormItem>
                                                <FormLabel>
                                                    {t("sshDaemonPort")}
                                                </FormLabel>
                                                <FormControl>
                                                    <Input
                                                        type="number"
                                                        min={1}
                                                        max={65535}
                                                        placeholder="22123"
                                                        disabled={
                                                            sshSectionDisabled
                                                        }
                                                        value={
                                                            field.value ?? ""
                                                        }
                                                        onChange={(e) => {
                                                            if (
                                                                sshSectionDisabled
                                                            )
                                                                return;
                                                            const v =
                                                                e.target.value;
                                                            if (v === "") {
                                                                field.onChange(
                                                                    null
                                                                );
                                                                return;
                                                            }
                                                            const num =
                                                                parseInt(v, 10);
                                                            field.onChange(
                                                                Number.isNaN(
                                                                    num
                                                                )
                                                                    ? null
                                                                    : num
                                                            );
                                                        }}
                                                    />
                                                </FormControl>
                                                <FormMessage />
                                            </FormItem>
                                        )}
                                    />
                                </div>
                            )}
                        </div>
                    )}
                </HorizontalTabs>
            </form>
        </Form>
    );
}
