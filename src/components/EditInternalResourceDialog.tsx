"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@app/components/ui/button";
import { Input } from "@app/components/ui/input";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue
} from "@app/components/ui/select";
import { Switch } from "@app/components/ui/switch";
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
import {
    Credenza,
    CredenzaBody,
    CredenzaClose,
    CredenzaContent,
    CredenzaDescription,
    CredenzaFooter,
    CredenzaHeader,
    CredenzaTitle
} from "@app/components/Credenza";
import { toast } from "@app/hooks/useToast";
import { useTranslations } from "next-intl";
import { createApiClient, formatAxiosError } from "@app/lib/api";
import { useEnvContext } from "@app/hooks/useEnvContext";
import { Tag, TagInput } from "@app/components/tags/tag-input";
import { UserType } from "@server/types/UserTypes";
import { useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { orgQueries, resourceQueries } from "@app/lib/queries";
// import { InfoPopup } from "@app/components/ui/info-popup";

// Helper to validate port range string format
const isValidPortRangeString = (val: string | undefined | null): boolean => {
    if (!val || val.trim() === "" || val.trim() === "*") {
        return true;
    }

    const parts = val.split(",").map((p) => p.trim());

    for (const part of parts) {
        if (part === "") {
            return false;
        }

        if (part.includes("-")) {
            const [start, end] = part.split("-").map((p) => p.trim());
            if (!start || !end) {
                return false;
            }

            const startPort = parseInt(start, 10);
            const endPort = parseInt(end, 10);

            if (isNaN(startPort) || isNaN(endPort)) {
                return false;
            }

            if (startPort < 1 || startPort > 65535 || endPort < 1 || endPort > 65535) {
                return false;
            }

            if (startPort > endPort) {
                return false;
            }
        } else {
            const port = parseInt(part, 10);
            if (isNaN(port)) {
                return false;
            }
            if (port < 1 || port > 65535) {
                return false;
            }
        }
    }

    return true;
};

// Port range string schema for client-side validation
const portRangeStringSchema = z
    .string()
    .optional()
    .nullable()
    .refine(
        (val) => isValidPortRangeString(val),
        {
            message:
                'Port range must be "*" for all ports, or a comma-separated list of ports and ranges (e.g., "80,443,8000-9000"). Ports must be between 1 and 65535.'
        }
    );

// Helper to determine the port mode from a port range string
type PortMode = "all" | "blocked" | "custom";
const getPortModeFromString = (val: string | undefined | null): PortMode => {
    if (val === "*") return "all";
    if (!val || val.trim() === "") return "blocked";
    return "custom";
};

// Helper to get the port string for API from mode and custom value
const getPortStringFromMode = (mode: PortMode, customValue: string): string | undefined => {
    if (mode === "all") return "*";
    if (mode === "blocked") return "";
    return customValue;
};

type InternalResourceData = {
    id: number;
    name: string;
    orgId: string;
    siteName: string;
    // mode: "host" | "cidr" | "port";
    mode: "host" | "cidr";
    // protocol: string | null;
    // proxyPort: number | null;
    siteId: number;
    destination: string;
    // destinationPort?: number | null;
    alias?: string | null;
    tcpPortRangeString?: string | null;
    udpPortRangeString?: string | null;
    disableIcmp?: boolean;
};

type EditInternalResourceDialogProps = {
    open: boolean;
    setOpen: (val: boolean) => void;
    resource: InternalResourceData;
    orgId: string;
    onSuccess?: () => void;
};

export default function EditInternalResourceDialog({
    open,
    setOpen,
    resource,
    orgId,
    onSuccess
}: EditInternalResourceDialogProps) {
    const t = useTranslations();
    const api = createApiClient(useEnvContext());
    const queryClient = useQueryClient();
    const [isSubmitting, setIsSubmitting] = useState(false);

    const formSchema = z.object({
        name: z
            .string()
            .min(1, t("editInternalResourceDialogNameRequired"))
            .max(255, t("editInternalResourceDialogNameMaxLength")),
        mode: z.enum(["host", "cidr", "port"]),
        // protocol: z.enum(["tcp", "udp"]).nullish(),
        // proxyPort: z.int().positive().min(1, t("editInternalResourceDialogProxyPortMin")).max(65535, t("editInternalResourceDialogProxyPortMax")).nullish(),
        destination: z.string().min(1),
        // destinationPort: z.int().positive().min(1, t("editInternalResourceDialogDestinationPortMin")).max(65535, t("editInternalResourceDialogDestinationPortMax")).nullish(),
        alias: z.string().nullish(),
        tcpPortRangeString: portRangeStringSchema,
        udpPortRangeString: portRangeStringSchema,
        disableIcmp: z.boolean().optional(),
        roles: z
            .array(
                z.object({
                    id: z.string(),
                    text: z.string()
                })
            )
            .optional(),
        users: z
            .array(
                z.object({
                    id: z.string(),
                    text: z.string()
                })
            )
            .optional(),
        clients: z
            .array(
                z.object({
                    id: z.string(),
                    text: z.string()
                })
            )
            .optional()
    });
    // .refine(
    //     (data) => {
    //         if (data.mode === "port") {
    //             return data.protocol !== undefined && data.protocol !== null;
    //         }
    //         return true;
    //     },
    //     {
    //         message: t("editInternalResourceDialogProtocol") + " is required for port mode",
    //         path: ["protocol"]
    //     }
    // )
    // .refine(
    //     (data) => {
    //         if (data.mode === "port") {
    //             return data.proxyPort !== undefined && data.proxyPort !== null;
    //         }
    //         return true;
    //     },
    //     {
    //         message: t("editInternalResourceDialogSitePort") + " is required for port mode",
    //         path: ["proxyPort"]
    //     }
    // )
    // .refine(
    //     (data) => {
    //         if (data.mode === "port") {
    //             return data.destinationPort !== undefined && data.destinationPort !== null;
    //         }
    //         return true;
    //     },
    //     {
    //         message: t("targetPort") + " is required for port mode",
    //         path: ["destinationPort"]
    //     }
    // );

    type FormData = z.infer<typeof formSchema>;

    const queries = useQueries({
        queries: [
            orgQueries.roles({ orgId }),
            orgQueries.users({ orgId }),
            orgQueries.clients({
                orgId,
                filters: {
                    filter: "machine"
                }
            }),
            resourceQueries.resourceUsers({ resourceId: resource.id }),
            resourceQueries.resourceRoles({ resourceId: resource.id }),
            resourceQueries.resourceClients({ resourceId: resource.id })
        ],
        combine: (results) => {
            const [
                rolesQuery,
                usersQuery,
                clientsQuery,
                resourceUsersQuery,
                resourceRolesQuery,
                resourceClientsQuery
            ] = results;

            const allRoles = (rolesQuery.data ?? [])
                .map((role) => ({
                    id: role.roleId.toString(),
                    text: role.name
                }))
                .filter((role) => role.text !== "Admin");

            const allUsers = (usersQuery.data ?? []).map((user) => ({
                id: user.id.toString(),
                text: `${user.email || user.username}${user.type !== UserType.Internal ? ` (${user.idpName})` : ""}`
            }));

            const machineClients = (clientsQuery.data ?? [])
                .filter((client) => !client.userId)
                .map((client) => ({
                    id: client.clientId.toString(),
                    text: client.name
                }));

            const existingClients = (resourceClientsQuery.data ?? []).map(
                (c: { clientId: number; name: string }) => ({
                    id: c.clientId.toString(),
                    text: c.name
                })
            );

            const formRoles = (resourceRolesQuery.data ?? [])
                .map((i) => ({
                    id: i.roleId.toString(),
                    text: i.name
                }))
                .filter((role) => role.text !== "Admin");

            const formUsers = (resourceUsersQuery.data ?? []).map((i) => ({
                id: i.userId.toString(),
                text: `${i.email || i.username}${i.type !== UserType.Internal ? ` (${i.idpName})` : ""}`
            }));

            return {
                allRoles,
                allUsers,
                machineClients,
                existingClients,
                formRoles,
                formUsers,
                hasMachineClients:
                    machineClients.length > 0 || existingClients.length > 0,
                isLoading: results.some((query) => query.isLoading)
            };
        }
    });

    const {
        allRoles,
        allUsers,
        machineClients,
        existingClients,
        formRoles,
        formUsers,
        hasMachineClients,
        isLoading: loadingRolesUsers
    } = queries;

    const [activeRolesTagIndex, setActiveRolesTagIndex] = useState<
        number | null
    >(null);
    const [activeUsersTagIndex, setActiveUsersTagIndex] = useState<
        number | null
    >(null);
    const [activeClientsTagIndex, setActiveClientsTagIndex] = useState<
        number | null
    >(null);

    // Port restriction UI state
    const [tcpPortMode, setTcpPortMode] = useState<PortMode>(
        getPortModeFromString(resource.tcpPortRangeString)
    );
    const [udpPortMode, setUdpPortMode] = useState<PortMode>(
        getPortModeFromString(resource.udpPortRangeString)
    );
    const [tcpCustomPorts, setTcpCustomPorts] = useState<string>(
        resource.tcpPortRangeString && resource.tcpPortRangeString !== "*"
            ? resource.tcpPortRangeString
            : ""
    );
    const [udpCustomPorts, setUdpCustomPorts] = useState<string>(
        resource.udpPortRangeString && resource.udpPortRangeString !== "*"
            ? resource.udpPortRangeString
            : ""
    );

    const form = useForm<FormData>({
        resolver: zodResolver(formSchema),
        defaultValues: {
            name: resource.name,
            mode: resource.mode || "host",
            // protocol: (resource.protocol as "tcp" | "udp" | null | undefined) ?? undefined,
            // proxyPort: resource.proxyPort ?? undefined,
            destination: resource.destination || "",
            // destinationPort: resource.destinationPort ?? undefined,
            alias: resource.alias ?? null,
            tcpPortRangeString: resource.tcpPortRangeString ?? "*",
            udpPortRangeString: resource.udpPortRangeString ?? "*",
            disableIcmp: resource.disableIcmp ?? false,
            roles: [],
            users: [],
            clients: []
        }
    });

    const mode = form.watch("mode");

    // Update form values when port mode or custom ports change
    useEffect(() => {
        const tcpValue = getPortStringFromMode(tcpPortMode, tcpCustomPorts);
        form.setValue("tcpPortRangeString", tcpValue);
    }, [tcpPortMode, tcpCustomPorts, form]);

    useEffect(() => {
        const udpValue = getPortStringFromMode(udpPortMode, udpCustomPorts);
        form.setValue("udpPortRangeString", udpValue);
    }, [udpPortMode, udpCustomPorts, form]);

    // Helper function to check if destination contains letters (hostname vs IP)
    const isHostname = (destination: string): boolean => {
        return /[a-zA-Z]/.test(destination);
    };

    // Helper function to clean resource name for FQDN format
    const cleanForFQDN = (name: string): string => {
        return name
            .toLowerCase()
            .replace(/[^a-z0-9.-]/g, "-") // Replace invalid chars with hyphens
            .replace(/[-]+/g, "-") // Replace multiple hyphens with single hyphen
            .replace(/^-|-$/g, "") // Remove leading/trailing hyphens
            .replace(/^\.|\.$/g, ""); // Remove leading/trailing dots
    };

    const handleSubmit = async (data: FormData) => {
        setIsSubmitting(true);
        try {
            // Validate: if mode is "host" and destination is a hostname (contains letters),
            // an alias is required
            if (data.mode === "host" && isHostname(data.destination)) {
                const currentAlias = data.alias?.trim() || "";

                if (!currentAlias) {
                    // Prefill alias based on destination
                    let aliasValue = data.destination;
                    if (data.destination.toLowerCase() === "localhost") {
                        // Use resource name cleaned for FQDN with .internal suffix
                        const cleanedName = cleanForFQDN(data.name);
                        aliasValue = `${cleanedName}.internal`;
                    }

                    // Update the form with the prefilled alias
                    form.setValue("alias", aliasValue);
                    data.alias = aliasValue;
                }
            }

            // Update the site resource
            await api.post(
                `/org/${orgId}/site/${resource.siteId}/resource/${resource.id}`,
                {
                    name: data.name,
                    mode: data.mode,
                    // protocol: data.mode === "port" ? data.protocol : null,
                    // proxyPort: data.mode === "port" ? data.proxyPort : null,
                    // destinationPort: data.mode === "port" ? data.destinationPort : null,
                    destination: data.destination,
                    alias:
                        data.alias &&
                        typeof data.alias === "string" &&
                        data.alias.trim()
                            ? data.alias
                            : null,
                    tcpPortRangeString: data.tcpPortRangeString,
                    udpPortRangeString: data.udpPortRangeString,
                    disableIcmp: data.disableIcmp ?? false,
                    roleIds: (data.roles || []).map((r) => parseInt(r.id)),
                    userIds: (data.users || []).map((u) => u.id),
                    clientIds: (data.clients || []).map((c) => parseInt(c.id))
                }
            );

            // Update roles, users, and clients
            // await Promise.all([
            //     api.post(`/site-resource/${resource.id}/roles`, {
            //         roleIds: (data.roles || []).map((r) => parseInt(r.id))
            //     }),
            //     api.post(`/site-resource/${resource.id}/users`, {
            //         userIds: (data.users || []).map((u) => u.id)
            //     }),
            //     api.post(`/site-resource/${resource.id}/clients`, {
            //         clientIds: (data.clients || []).map((c) => parseInt(c.id))
            //     })
            // ]);

            await queryClient.invalidateQueries(
                resourceQueries.resourceRoles({ resourceId: resource.id })
            );
            await queryClient.invalidateQueries(
                resourceQueries.resourceUsers({ resourceId: resource.id })
            );
            await queryClient.invalidateQueries(
                resourceQueries.resourceClients({ resourceId: resource.id })
            );

            toast({
                title: t("editInternalResourceDialogSuccess"),
                description: t(
                    "editInternalResourceDialogInternalResourceUpdatedSuccessfully"
                ),
                variant: "default"
            });

            onSuccess?.();
            setOpen(false);
        } catch (error) {
            console.error("Error updating internal resource:", error);
            toast({
                title: t("editInternalResourceDialogError"),
                description: formatAxiosError(
                    error,
                    t(
                        "editInternalResourceDialogFailedToUpdateInternalResource"
                    )
                ),
                variant: "destructive"
            });
        } finally {
            setIsSubmitting(false);
        }
    };

    const hasInitialized = useRef(false);
    const previousResourceId = useRef<number | null>(null);

    useEffect(() => {
        if (open) {
            const resourceChanged = previousResourceId.current !== resource.id;

            if (resourceChanged) {
                form.reset({
                    name: resource.name,
                    mode: resource.mode || "host",
                    destination: resource.destination || "",
                    alias: resource.alias ?? null,
                    tcpPortRangeString: resource.tcpPortRangeString ?? "*",
                    udpPortRangeString: resource.udpPortRangeString ?? "*",
                    disableIcmp: resource.disableIcmp ?? false,
                    roles: [],
                    users: [],
                    clients: []
                });
                // Reset port mode state
                setTcpPortMode(getPortModeFromString(resource.tcpPortRangeString));
                setUdpPortMode(getPortModeFromString(resource.udpPortRangeString));
                setTcpCustomPorts(
                    resource.tcpPortRangeString && resource.tcpPortRangeString !== "*"
                        ? resource.tcpPortRangeString
                        : ""
                );
                setUdpCustomPorts(
                    resource.udpPortRangeString && resource.udpPortRangeString !== "*"
                        ? resource.udpPortRangeString
                        : ""
                );
                previousResourceId.current = resource.id;
            }

            hasInitialized.current = false;
        }
    }, [
        open,
        resource.id,
        resource.name,
        resource.mode,
        resource.destination,
        resource.alias,
        form
    ]);

    useEffect(() => {
        if (open && !loadingRolesUsers && !hasInitialized.current) {
            hasInitialized.current = true;
            form.setValue("roles", formRoles);
            form.setValue("users", formUsers);
            form.setValue("clients", existingClients);
        }
    }, [open, loadingRolesUsers, formRoles, formUsers, existingClients, form]);

    return (
        <Credenza
            open={open}
            onOpenChange={(open) => {
                if (!open) {
                    // reset only on close
                    form.reset({
                        name: resource.name,
                        mode: resource.mode || "host",
                        // protocol: (resource.protocol as "tcp" | "udp" | null | undefined) ?? undefined,
                        // proxyPort: resource.proxyPort ?? undefined,
                        destination: resource.destination || "",
                        // destinationPort: resource.destinationPort ?? undefined,
                        alias: resource.alias ?? null,
                        tcpPortRangeString: resource.tcpPortRangeString ?? "*",
                        udpPortRangeString: resource.udpPortRangeString ?? "*",
                        disableIcmp: resource.disableIcmp ?? false,
                        roles: [],
                        users: [],
                        clients: []
                    });
                    // Reset port mode state
                    setTcpPortMode(getPortModeFromString(resource.tcpPortRangeString));
                    setUdpPortMode(getPortModeFromString(resource.udpPortRangeString));
                    setTcpCustomPorts(
                        resource.tcpPortRangeString && resource.tcpPortRangeString !== "*"
                            ? resource.tcpPortRangeString
                            : ""
                    );
                    setUdpCustomPorts(
                        resource.udpPortRangeString && resource.udpPortRangeString !== "*"
                            ? resource.udpPortRangeString
                            : ""
                    );
                    // Reset previous resource ID to ensure clean state on next open
                    previousResourceId.current = null;
                }
                setOpen(open);
            }}
        >
            <CredenzaContent className="max-w-2xl">
                <CredenzaHeader>
                    <CredenzaTitle>
                        {t("editInternalResourceDialogEditClientResource")}
                    </CredenzaTitle>
                    <CredenzaDescription>
                        {t(
                            "editInternalResourceDialogUpdateResourceProperties",
                            { resourceName: resource.name }
                        )}
                    </CredenzaDescription>
                </CredenzaHeader>
                <CredenzaBody>
                    <Form {...form}>
                        <form
                            onSubmit={form.handleSubmit(handleSubmit)}
                            className="space-y-6"
                            id="edit-internal-resource-form"
                        >
                            {/* Resource Properties Form */}
                            <div>
                                <h3 className="text-lg font-semibold mb-4">
                                    {t(
                                        "editInternalResourceDialogResourceProperties"
                                    )}
                                </h3>
                                <div className="space-y-4">
                                    <FormField
                                        control={form.control}
                                        name="name"
                                        render={({ field }) => (
                                            <FormItem>
                                                <FormLabel>
                                                    {t(
                                                        "editInternalResourceDialogName"
                                                    )}
                                                </FormLabel>
                                                <FormControl>
                                                    <Input {...field} />
                                                </FormControl>
                                                <FormMessage />
                                            </FormItem>
                                        )}
                                    />

                                    <FormField
                                        control={form.control}
                                        name="mode"
                                        render={({ field }) => (
                                            <FormItem>
                                                <FormLabel>
                                                    {t(
                                                        "editInternalResourceDialogMode"
                                                    )}
                                                </FormLabel>
                                                <Select
                                                    onValueChange={
                                                        field.onChange
                                                    }
                                                    value={field.value}
                                                >
                                                    <FormControl>
                                                        <SelectTrigger>
                                                            <SelectValue />
                                                        </SelectTrigger>
                                                    </FormControl>
                                                    <SelectContent>
                                                        {/* <SelectItem value="port">{t("editInternalResourceDialogModePort")}</SelectItem> */}
                                                        <SelectItem value="host">
                                                            {t(
                                                                "editInternalResourceDialogModeHost"
                                                            )}
                                                        </SelectItem>
                                                        <SelectItem value="cidr">
                                                            {t(
                                                                "editInternalResourceDialogModeCidr"
                                                            )}
                                                        </SelectItem>
                                                    </SelectContent>
                                                </Select>
                                                <FormMessage />
                                            </FormItem>
                                        )}
                                    />

                                    {/* {mode === "port" && (
                                        <div className="grid grid-cols-2 gap-4">
                                            <FormField
                                                control={form.control}
                                                name="protocol"
                                                render={({ field }) => (
                                                    <FormItem>
                                                        <FormLabel>{t("editInternalResourceDialogProtocol")}</FormLabel>
                                                        <Select
                                                            onValueChange={field.onChange}
                                                            value={field.value ?? undefined}
                                                        >
                                                            <FormControl>
                                                                <SelectTrigger>
                                                                    <SelectValue />
                                                                </SelectTrigger>
                                                            </FormControl>
                                                            <SelectContent>
                                                                <SelectItem value="tcp">TCP</SelectItem>
                                                                <SelectItem value="udp">UDP</SelectItem>
                                                            </SelectContent>
                                                        </Select>
                                                        <FormMessage />
                                                    </FormItem>
                                                )}
                                            />

                                            <FormField
                                                control={form.control}
                                                name="proxyPort"
                                                render={({ field }) => (
                                                    <FormItem>
                                                        <FormLabel>{t("editInternalResourceDialogSitePort")}</FormLabel>
                                                        <FormControl>
                                                            <Input
                                                                type="number"
                                                                value={field.value || ""}
                                                                onChange={(e) => field.onChange(e.target.value === "" ? undefined : parseInt(e.target.value) || 0)}
                                                            />
                                                        </FormControl>
                                                        <FormMessage />
                                                    </FormItem>
                                                )}
                                            />
                                        </div>
                                    )} */}
                                </div>
                            </div>

                            {/* Target Configuration Form */}
                            <div>
                                <h3 className="text-lg font-semibold mb-4">
                                    {t(
                                        "editInternalResourceDialogTargetConfiguration"
                                    )}
                                </h3>
                                <div className="space-y-4">
                                    <FormField
                                        control={form.control}
                                        name="destination"
                                        render={({ field }) => (
                                            <FormItem>
                                                <FormLabel>
                                                    {t(
                                                        "editInternalResourceDialogDestination"
                                                    )}
                                                </FormLabel>
                                                <FormControl>
                                                    <Input {...field} />
                                                </FormControl>
                                                <FormDescription>
                                                    {mode === "host" &&
                                                        t(
                                                            "editInternalResourceDialogDestinationHostDescription"
                                                        )}
                                                    {mode === "cidr" &&
                                                        t(
                                                            "editInternalResourceDialogDestinationCidrDescription"
                                                        )}
                                                    {/* {mode === "port" && t("editInternalResourceDialogDestinationIPDescription")} */}
                                                </FormDescription>
                                                <FormMessage />
                                            </FormItem>
                                        )}
                                    />

                                    {/* {mode === "port" && (
                                        <FormField
                                            control={form.control}
                                            name="destinationPort"
                                            render={({ field }) => (
                                                <FormItem>
                                                    <FormLabel>{t("targetPort")}</FormLabel>
                                                    <FormControl>
                                                        <Input
                                                            type="number"
                                                            value={field.value || ""}
                                                            onChange={(e) => field.onChange(e.target.value === "" ? undefined : parseInt(e.target.value) || 0)}
                                                        />
                                                    </FormControl>
                                                    <FormMessage />
                                                </FormItem>
                                            )}
                                        />
                                    )} */}
                                </div>
                            </div>

                            {/* Alias */}
                            {mode !== "cidr" && (
                                <div>
                                    <FormField
                                        control={form.control}
                                        name="alias"
                                        render={({ field }) => (
                                            <FormItem>
                                                <FormLabel>
                                                    {t(
                                                        "editInternalResourceDialogAlias"
                                                    )}
                                                </FormLabel>
                                                <FormControl>
                                                    <Input
                                                        {...field}
                                                        value={
                                                            field.value ?? ""
                                                        }
                                                    />
                                                </FormControl>
                                                <FormDescription>
                                                    {t(
                                                        "editInternalResourceDialogAliasDescription"
                                                    )}
                                                </FormDescription>
                                                <FormMessage />
                                            </FormItem>
                                        )}
                                    />
                                </div>
                            )}

                            {/* Port Restrictions Section */}
                            <div>
                                <h3 className="text-lg font-semibold mb-4">
                                    {t("portRestrictions")}
                                </h3>
                                <div className="space-y-4">
                                    {/* TCP Ports */}
                                    <FormField
                                        control={form.control}
                                        name="tcpPortRangeString"
                                        render={({ field }) => (
                                            <FormItem>
                                                <div className="flex items-center gap-2">
                                                    <FormLabel className="min-w-10">
                                                        TCP
                                                    </FormLabel>
                                                    {/*<InfoPopup
                                                        info={t("tcpPortsDescription")}
                                                    />*/}
                                                    <Select
                                                        value={tcpPortMode}
                                                        onValueChange={(value: PortMode) => {
                                                            setTcpPortMode(value);
                                                        }}
                                                    >
                                                        <SelectTrigger className="w-[110px]">
                                                            <SelectValue />
                                                        </SelectTrigger>
                                                        <SelectContent>
                                                            <SelectItem value="all">
                                                                {t("allPorts")}
                                                            </SelectItem>
                                                            <SelectItem value="blocked">
                                                                {t("blocked")}
                                                            </SelectItem>
                                                            <SelectItem value="custom">
                                                                {t("custom")}
                                                            </SelectItem>
                                                        </SelectContent>
                                                    </Select>
                                                    {tcpPortMode === "custom" ? (
                                                        <FormControl>
                                                            <Input
                                                                placeholder="80,443,8000-9000"
                                                                value={tcpCustomPorts}
                                                                onChange={(e) =>
                                                                    setTcpCustomPorts(e.target.value)
                                                                }
                                                                className="flex-1"
                                                            />
                                                        </FormControl>
                                                    ) : (
                                                        <Input
                                                            disabled
                                                            placeholder={
                                                                tcpPortMode === "all"
                                                                    ? t("allPortsAllowed")
                                                                    : t("allPortsBlocked")
                                                            }
                                                            className="flex-1"
                                                        />
                                                    )}
                                                </div>
                                                <FormMessage />
                                            </FormItem>
                                        )}
                                    />

                                    {/* UDP Ports */}
                                    <FormField
                                        control={form.control}
                                        name="udpPortRangeString"
                                        render={({ field }) => (
                                            <FormItem>
                                                <div className="flex items-center gap-2">
                                                    <FormLabel className="min-w-10">
                                                        UDP
                                                    </FormLabel>
                                                    {/*<InfoPopup
                                                        info={t("udpPortsDescription")}
                                                    />*/}
                                                    <Select
                                                        value={udpPortMode}
                                                        onValueChange={(value: PortMode) => {
                                                            setUdpPortMode(value);
                                                        }}
                                                    >
                                                        <SelectTrigger className="w-[110px]">
                                                            <SelectValue />
                                                        </SelectTrigger>
                                                        <SelectContent>
                                                            <SelectItem value="all">
                                                                {t("allPorts")}
                                                            </SelectItem>
                                                            <SelectItem value="blocked">
                                                                {t("blocked")}
                                                            </SelectItem>
                                                            <SelectItem value="custom">
                                                                {t("custom")}
                                                            </SelectItem>
                                                        </SelectContent>
                                                    </Select>
                                                    {udpPortMode === "custom" ? (
                                                        <FormControl>
                                                            <Input
                                                                placeholder="53,123,500-600"
                                                                value={udpCustomPorts}
                                                                onChange={(e) =>
                                                                    setUdpCustomPorts(e.target.value)
                                                                }
                                                                className="flex-1"
                                                            />
                                                        </FormControl>
                                                    ) : (
                                                        <Input
                                                            disabled
                                                            placeholder={
                                                                udpPortMode === "all"
                                                                    ? t("allPortsAllowed")
                                                                    : t("allPortsBlocked")
                                                            }
                                                            className="flex-1"
                                                        />
                                                    )}
                                                </div>
                                                <FormMessage />
                                            </FormItem>
                                        )}
                                    />

                                    {/* ICMP Toggle */}
                                    <FormField
                                        control={form.control}
                                        name="disableIcmp"
                                        render={({ field }) => (
                                            <FormItem>
                                                <div className="flex items-center gap-2">
                                                    <FormLabel className="min-w-10">
                                                        ICMP
                                                    </FormLabel>
                                                    <FormControl>
                                                        <Switch
                                                            checked={!field.value}
                                                            onCheckedChange={(checked) => field.onChange(!checked)}
                                                        />
                                                    </FormControl>
                                                    <span className="text-sm text-muted-foreground">
                                                        {field.value ? t("blocked") : t("allowed")}
                                                    </span>
                                                </div>
                                                <FormMessage />
                                            </FormItem>
                                        )}
                                    />
                                </div>
                            </div>

                            {/* Access Control Section */}
                            <div>
                                <h3 className="text-lg font-semibold mb-4">
                                    {t("resourceUsersRoles")}
                                </h3>
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
                                                    <FormLabel>
                                                        {t("roles")}
                                                    </FormLabel>
                                                    <FormControl>
                                                        <TagInput
                                                            {...field}
                                                            activeTagIndex={
                                                                activeRolesTagIndex
                                                            }
                                                            setActiveTagIndex={
                                                                setActiveRolesTagIndex
                                                            }
                                                            placeholder={t(
                                                                "accessRoleSelect2"
                                                            )}
                                                            size="sm"
                                                            tags={
                                                                form.getValues()
                                                                    .roles || []
                                                            }
                                                            setTags={(
                                                                newRoles
                                                            ) => {
                                                                form.setValue(
                                                                    "roles",
                                                                    newRoles as [
                                                                        Tag,
                                                                        ...Tag[]
                                                                    ]
                                                                );
                                                            }}
                                                            enableAutocomplete={
                                                                true
                                                            }
                                                            autocompleteOptions={
                                                                allRoles
                                                            }
                                                            allowDuplicates={
                                                                false
                                                            }
                                                            restrictTagsToAutocompleteOptions={
                                                                true
                                                            }
                                                            sortTags={true}
                                                        />
                                                    </FormControl>
                                                    <FormMessage />
                                                    <FormDescription>
                                                        {t(
                                                            "resourceRoleDescription"
                                                        )}
                                                    </FormDescription>
                                                </FormItem>
                                            )}
                                        />
                                        <FormField
                                            control={form.control}
                                            name="users"
                                            render={({ field }) => (
                                                <FormItem className="flex flex-col items-start">
                                                    <FormLabel>
                                                        {t("users")}
                                                    </FormLabel>
                                                    <FormControl>
                                                        <TagInput
                                                            {...field}
                                                            activeTagIndex={
                                                                activeUsersTagIndex
                                                            }
                                                            setActiveTagIndex={
                                                                setActiveUsersTagIndex
                                                            }
                                                            placeholder={t(
                                                                "accessUserSelect"
                                                            )}
                                                            tags={
                                                                form.getValues()
                                                                    .users || []
                                                            }
                                                            size="sm"
                                                            setTags={(
                                                                newUsers
                                                            ) => {
                                                                form.setValue(
                                                                    "users",
                                                                    newUsers as [
                                                                        Tag,
                                                                        ...Tag[]
                                                                    ]
                                                                );
                                                            }}
                                                            enableAutocomplete={
                                                                true
                                                            }
                                                            autocompleteOptions={
                                                                allUsers
                                                            }
                                                            allowDuplicates={
                                                                false
                                                            }
                                                            restrictTagsToAutocompleteOptions={
                                                                true
                                                            }
                                                            sortTags={true}
                                                        />
                                                    </FormControl>
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
                                                            {t(
                                                                "machineClients"
                                                            )}
                                                        </FormLabel>
                                                        <FormControl>
                                                            <TagInput
                                                                {...field}
                                                                activeTagIndex={
                                                                    activeClientsTagIndex
                                                                }
                                                                setActiveTagIndex={
                                                                    setActiveClientsTagIndex
                                                                }
                                                                placeholder={
                                                                    t(
                                                                        "accessClientSelect"
                                                                    ) ||
                                                                    "Select machine clients"
                                                                }
                                                                size="sm"
                                                                tags={
                                                                    form.getValues()
                                                                        .clients ||
                                                                    []
                                                                }
                                                                setTags={(
                                                                    newClients
                                                                ) => {
                                                                    form.setValue(
                                                                        "clients",
                                                                        newClients as [
                                                                            Tag,
                                                                            ...Tag[]
                                                                        ]
                                                                    );
                                                                }}
                                                                enableAutocomplete={
                                                                    true
                                                                }
                                                                autocompleteOptions={
                                                                    machineClients
                                                                }
                                                                allowDuplicates={
                                                                    false
                                                                }
                                                                restrictTagsToAutocompleteOptions={
                                                                    true
                                                                }
                                                                sortTags={true}
                                                            />
                                                        </FormControl>
                                                        <FormMessage />
                                                    </FormItem>
                                                )}
                                            />
                                        )}
                                    </div>
                                )}
                            </div>
                        </form>
                    </Form>
                </CredenzaBody>
                <CredenzaFooter>
                    <CredenzaClose asChild>
                        <Button
                            variant="outline"
                            onClick={() => setOpen(false)}
                            disabled={isSubmitting}
                        >
                            {t("editInternalResourceDialogCancel")}
                        </Button>
                    </CredenzaClose>
                    <Button
                        type="submit"
                        form="edit-internal-resource-form"
                        disabled={isSubmitting}
                        loading={isSubmitting}
                    >
                        {t("editInternalResourceDialogSaveResource")}
                    </Button>
                </CredenzaFooter>
            </CredenzaContent>
        </Credenza>
    );
}
