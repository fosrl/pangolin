"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { z } from "zod";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import {
    Form,
    FormControl,
    FormDescription,
    FormField,
    FormItem,
    FormLabel,
    FormMessage
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue
} from "@/components/ui/select";
import { StrategySelect } from "@app/components/StrategySelect";
import { HeadersInput } from "@app/components/HeadersInput";
import { HorizontalTabs } from "@app/components/HorizontalTabs";
import {
    Credenza,
    CredenzaBody,
    CredenzaClose,
    CredenzaContent,
    CredenzaDescription,
    CredenzaFooter,
    CredenzaHeader,
    CredenzaTitle
} from "@/components/Credenza";
import { toast } from "@app/hooks/useToast";
import { createApiClient, formatAxiosError } from "@app/lib/api";
import { useEnvContext } from "@app/hooks/useEnvContext";
import { useTranslations } from "next-intl";
import { ContactSalesBanner } from "@app/components/ContactSalesBanner";
import {
    Popover,
    PopoverContent,
    PopoverTrigger
} from "@/components/ui/popover";
import { SitesSelector } from "@app/components/site-selector";
import type { Selectedsite } from "@app/components/site-selector";
import { CaretSortIcon } from "@radix-ui/react-icons";
import { cn } from "@app/lib/cn";
import { SwitchInput } from "@app/components/SwitchInput";

export type HealthCheckConfig = {
    hcEnabled: boolean;
    hcPath: string;
    hcMethod: string;
    hcInterval: number;
    hcTimeout: number;
    hcStatus: number | null;
    hcHeaders?: { name: string; value: string }[] | null;
    hcScheme?: string;
    hcHostname: string;
    hcPort: number;
    hcFollowRedirects: boolean;
    hcMode: string;
    hcUnhealthyInterval: number;
    hcTlsServerName: string;
    hcHealthyThreshold: number;
    hcUnhealthyThreshold: number;
};

export type HealthCheckRow = {
    targetHealthCheckId: number;
    name: string;
    hcEnabled: boolean;
    hcHealth: "unknown" | "healthy" | "unhealthy";
    hcMode: string | null;
    hcHostname: string | null;
    hcPort: number | null;
    hcPath: string | null;
    hcScheme: string | null;
    hcMethod: string | null;
    hcInterval: number | null;
    hcUnhealthyInterval: number | null;
    hcTimeout: number | null;
    hcHeaders: string | null;
    hcFollowRedirects: boolean | null;
    hcStatus: number | null;
    hcTlsServerName: string | null;
    hcHealthyThreshold: number | null;
    hcUnhealthyThreshold: number | null;
    resourceId: number | null;
    resourceName: string | null;
    resourceNiceId: string | null;
    siteId: number | null;
    siteName: string | null;
    siteNiceId: string | null;
};

export type HealthCheckCredenzaProps =
    | {
          mode: "autoSave";
          open: boolean;
          setOpen: (v: boolean) => void;
          orgId?: string;
          targetAddress: string;
          targetMethod?: string;
          initialConfig?: Partial<HealthCheckConfig>;
          onChanges: (config: HealthCheckConfig) => Promise<void>;
      }
    | {
          mode: "submit";
          open: boolean;
          setOpen: (v: boolean) => void;
          orgId: string;
          initialValues?: HealthCheckRow | null;
          onSaved: () => void;
      };

const DEFAULT_VALUES = {
    name: "",
    hcEnabled: true,
    hcMode: "http",
    hcScheme: "http",
    hcMethod: "GET",
    hcHostname: "",
    hcPort: "",
    hcPath: "/",
    hcInterval: 30,
    hcUnhealthyInterval: 30,
    hcTimeout: 5,
    hcHealthyThreshold: 1,
    hcUnhealthyThreshold: 1,
    hcFollowRedirects: true,
    hcTlsServerName: "",
    hcStatus: null as number | null,
    hcHeaders: [] as { name: string; value: string }[]
};

export function HealthCheckCredenza(props: HealthCheckCredenzaProps) {
    const { mode, open, setOpen, orgId } = props;

    const t = useTranslations();
    const api = createApiClient(useEnvContext());
    const [loading, setLoading] = useState(false);
    const [selectedSite, setSelectedSite] = useState<Selectedsite | null>(null);

    const healthCheckSchema = z
        .object({
            ...(mode === "submit"
                ? {
                      name: z
                          .string()
                          .min(1, { message: t("standaloneHcNameLabel") })
                  }
                : {}),
            hcEnabled: z.boolean(),
            hcPath: z.string().optional(),
            hcMethod: z.string().optional(),
            hcInterval: z
                .int()
                .positive()
                .min(5, { message: t("healthCheckIntervalMin") }),
            hcTimeout: z
                .int()
                .positive()
                .min(1, { message: t("healthCheckTimeoutMin") }),
            hcStatus: z.int().positive().min(100).optional().nullable(),
            hcHeaders: z
                .array(z.object({ name: z.string(), value: z.string() }))
                .nullable()
                .optional(),
            hcScheme: z.string().optional(),
            hcPort: z
                .string()
                .min(1, { message: t("healthCheckPortInvalid") })
                .refine(
                    (val) => {
                        const port = parseInt(val);
                        return port > 0 && port <= 65535;
                    },
                    { message: t("healthCheckPortInvalid") }
                ),
            hcFollowRedirects: z.boolean(),
            hcHostname: z
                .string()
                .refine((val) => !/\s/.test(val), {
                    message: t("healthCheckHostnameInvalid")
                }),
            hcMode: z.string(),
            hcUnhealthyInterval: z.int().positive().min(5),
            hcTlsServerName: z.string(),
            hcHealthyThreshold: z
                .int()
                .positive()
                .min(1, { message: t("healthCheckHealthyThresholdMin") }),
            hcUnhealthyThreshold: z
                .int()
                .positive()
                .min(1, { message: t("healthCheckUnhealthyThresholdMin") })
        })
        .superRefine((data, ctx) => {
            if (data.hcMode !== "tcp") {
                if (!data.hcPath || data.hcPath.length < 1) {
                    ctx.addIssue({
                        code: z.ZodIssueCode.custom,
                        message: t("healthCheckPathRequired"),
                        path: ["hcPath"]
                    });
                }
                if (!data.hcMethod || data.hcMethod.length < 1) {
                    ctx.addIssue({
                        code: z.ZodIssueCode.custom,
                        message: t("healthCheckMethodRequired"),
                        path: ["hcMethod"]
                    });
                }
            }
        });

    type FormValues = z.infer<typeof healthCheckSchema>;

    const form = useForm<FormValues>({
        resolver: zodResolver(healthCheckSchema),
        defaultValues: mode === "submit" ? DEFAULT_VALUES : {}
    });

    const watchedEnabled = form.watch("hcEnabled");
    const watchedMode = form.watch("hcMode");

    useEffect(() => {
        if (!open) return;

        if (mode === "autoSave") {
            const { initialConfig, targetMethod } = props;

            const getDefaultScheme = () => {
                if (initialConfig?.hcScheme) return initialConfig.hcScheme;
                if (targetMethod === "https") return "https";
                return "http";
            };

            form.reset({
                hcEnabled: initialConfig?.hcEnabled,
                hcPath: initialConfig?.hcPath,
                hcMethod: initialConfig?.hcMethod,
                hcInterval: initialConfig?.hcInterval,
                hcTimeout: initialConfig?.hcTimeout,
                hcStatus: initialConfig?.hcStatus,
                hcHeaders: initialConfig?.hcHeaders,
                hcScheme: getDefaultScheme(),
                hcHostname: initialConfig?.hcHostname,
                hcPort: initialConfig?.hcPort
                    ? initialConfig.hcPort.toString()
                    : "",
                hcFollowRedirects: initialConfig?.hcFollowRedirects,
                hcMode: initialConfig?.hcMode ?? "http",
                hcUnhealthyInterval: initialConfig?.hcUnhealthyInterval,
                hcTlsServerName: initialConfig?.hcTlsServerName ?? "",
                hcHealthyThreshold: initialConfig?.hcHealthyThreshold ?? 1,
                hcUnhealthyThreshold: initialConfig?.hcUnhealthyThreshold ?? 1
            });
        } else {
            const { initialValues } = props;

            if (initialValues) {
                let parsedHeaders: { name: string; value: string }[] = [];
                if (initialValues.hcHeaders) {
                    try {
                        parsedHeaders = JSON.parse(initialValues.hcHeaders);
                    } catch {
                        parsedHeaders = [];
                    }
                }

                form.reset({
                    name: initialValues.name,
                    hcEnabled: initialValues.hcEnabled,
                    hcMode: initialValues.hcMode ?? "http",
                    hcScheme: initialValues.hcScheme ?? "http",
                    hcMethod: initialValues.hcMethod ?? "GET",
                    hcHostname: initialValues.hcHostname ?? "",
                    hcPort: initialValues.hcPort
                        ? initialValues.hcPort.toString()
                        : "",
                    hcPath: initialValues.hcPath ?? "/",
                    hcInterval: initialValues.hcInterval ?? 30,
                    hcUnhealthyInterval:
                        initialValues.hcUnhealthyInterval ?? 30,
                    hcTimeout: initialValues.hcTimeout ?? 5,
                    hcHealthyThreshold: initialValues.hcHealthyThreshold ?? 1,
                    hcUnhealthyThreshold:
                        initialValues.hcUnhealthyThreshold ?? 1,
                    hcFollowRedirects: initialValues.hcFollowRedirects ?? true,
                    hcTlsServerName: initialValues.hcTlsServerName ?? "",
                    hcStatus: initialValues.hcStatus ?? null,
                    hcHeaders: parsedHeaders
                });
                if (initialValues.siteId && initialValues.siteName) {
                    setSelectedSite({
                        siteId: initialValues.siteId,
                        name: initialValues.siteName,
                        type: ""
                    });
                } else {
                    setSelectedSite(null);
                }
            } else {
                form.reset(DEFAULT_VALUES);
                setSelectedSite(null);
            }
        }
    }, [open]);

    const handleFieldChange = async (fieldName: string, value: any) => {
        if (mode !== "autoSave") return;
        try {
            const currentValues = form.getValues();
            const updatedValues = { ...currentValues, [fieldName]: value };

            const configToSend: HealthCheckConfig = {
                ...updatedValues,
                hcPath: updatedValues.hcPath ?? "",
                hcMethod: updatedValues.hcMethod ?? "",
                hcPort: parseInt(updatedValues.hcPort),
                hcStatus: updatedValues.hcStatus || null,
                hcHealthyThreshold: updatedValues.hcHealthyThreshold,
                hcUnhealthyThreshold: updatedValues.hcUnhealthyThreshold
            };

            await props.onChanges(configToSend);
        } catch (error) {
            toast({
                title: t("healthCheckError"),
                description: t("healthCheckErrorDescription"),
                variant: "destructive"
            });
        }
    };

    const handleChange = (
        fieldName: string,
        value: any,
        fieldOnChange: (v: any) => void
    ) => {
        fieldOnChange(value);
        if (mode === "autoSave") {
            handleFieldChange(fieldName, value);
        }
    };

    const onSubmit = async (values: FormValues) => {
        if (mode !== "submit") return;
        const { initialValues, onSaved } = props;

        setLoading(true);
        try {
            const payload = {
                name: (values as any).name,
                siteId: selectedSite?.siteId,
                hcEnabled: values.hcEnabled,
                hcMode: values.hcMode,
                hcScheme: values.hcScheme,
                hcMethod: values.hcMethod,
                hcHostname: values.hcHostname,
                hcPort: parseInt(values.hcPort),
                hcPath: values.hcPath ?? "",
                hcInterval: values.hcInterval,
                hcUnhealthyInterval: values.hcUnhealthyInterval,
                hcTimeout: values.hcTimeout,
                hcHealthyThreshold: values.hcHealthyThreshold,
                hcUnhealthyThreshold: values.hcUnhealthyThreshold,
                hcFollowRedirects: values.hcFollowRedirects,
                hcTlsServerName: values.hcTlsServerName,
                hcStatus: values.hcStatus || null,
                hcHeaders:
                    values.hcHeaders && values.hcHeaders.length > 0
                        ? JSON.stringify(values.hcHeaders)
                        : null
            };

            if (initialValues) {
                await api.post(
                    `/org/${orgId}/health-check/${initialValues.targetHealthCheckId}`,
                    payload
                );
            } else {
                await api.put(`/org/${orgId}/health-check`, payload);
            }

            toast({ title: t("standaloneHcSaved") });
            onSaved();
            setOpen(false);
        } catch (e) {
            toast({
                title: t("error"),
                description: formatAxiosError(e),
                variant: "destructive"
            });
        } finally {
            setLoading(false);
        }
    };

    const isEditing = mode === "submit" && !!(props as any).initialValues;

    const title =
        mode === "autoSave"
            ? t("configureHealthCheck")
            : isEditing
              ? t("standaloneHcEditTitle")
              : t("standaloneHcCreateTitle");

    const description = t("configureHealthCheckDescription");

    const disableTabInputs = mode === "autoSave" && !watchedEnabled;
    const isSnmpOrIcmp = watchedMode === "snmp" || watchedMode === "icmp";
    const isTcp = watchedMode === "tcp";

    return (
        <Credenza open={open} onOpenChange={setOpen}>
            <CredenzaContent className="max-w-2xl">
                <CredenzaHeader>
                    <CredenzaTitle>{title}</CredenzaTitle>
                    <CredenzaDescription>{description}</CredenzaDescription>
                </CredenzaHeader>
                <CredenzaBody>
                    <Form {...form}>
                        <form
                            id="hc-credenza-form"
                            onSubmit={
                                mode === "submit"
                                    ? form.handleSubmit(onSubmit)
                                    : undefined
                            }
                        >
                            {/* Name (submit mode only) */}
                            {mode === "submit" && (
                                <FormField
                                    control={form.control}
                                    name="name"
                                    render={({ field }) => (
                                        <FormItem>
                                            <FormLabel>
                                                {t("standaloneHcNameLabel")}
                                            </FormLabel>
                                            <FormControl>
                                                <Input
                                                    {...field}
                                                    value={
                                                        field.value as string
                                                    }
                                                    placeholder={t(
                                                        "standaloneHcNamePlaceholder"
                                                    )}
                                                />
                                            </FormControl>
                                            <FormMessage />
                                        </FormItem>
                                    )}
                                />
                            )}

                            {/* Site picker (submit mode only) */}
                            {mode === "submit" && (
                                <div className="mt-4">
                                    <FormItem>
                                        <FormLabel>{t("site")}</FormLabel>
                                        <Popover>
                                            <PopoverTrigger asChild>
                                                <Button
                                                    type="button"
                                                    variant="outline"
                                                    role="combobox"
                                                    className={cn(
                                                        "w-full justify-between",
                                                        !selectedSite &&
                                                            "text-muted-foreground"
                                                    )}
                                                >
                                                    <span className="truncate">
                                                        {selectedSite
                                                            ? selectedSite.name
                                                            : t("siteSelect")}
                                                    </span>
                                                    <CaretSortIcon className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                                                </Button>
                                            </PopoverTrigger>
                                            <PopoverContent className="p-0 w-full min-w-64">
                                                <SitesSelector
                                                    orgId={orgId!}
                                                    selectedSite={selectedSite}
                                                    onSelectSite={(site) => {
                                                        setSelectedSite(site);
                                                    }}
                                                    filterTypes={["newt"]}
                                                />
                                            </PopoverContent>
                                        </Popover>
                                    </FormItem>
                                </div>
                            )}

                            {mode === "autoSave" && (
                                <div className="">
                                    <FormField
                                        control={form.control}
                                        name="hcEnabled"
                                        render={({ field }) => (
                                            <FormItem>
                                                <FormControl>
                                                    <SwitchInput
                                                        id="hcEnabled"
                                                        label={t(
                                                            "enableHealthChecks"
                                                        )}
                                                        description={t(
                                                            "healthCheckDisabledStateDescription"
                                                        )}
                                                        checked={field.value}
                                                        onCheckedChange={(
                                                            value
                                                        ) =>
                                                            handleChange(
                                                                "hcEnabled",
                                                                value,
                                                                field.onChange
                                                            )
                                                        }
                                                    />
                                                </FormControl>
                                            </FormItem>
                                        )}
                                    />
                                </div>
                            )}

                            <div className="mt-5">
                                <HorizontalTabs
                                    clientSide
                                    items={[
                                        {
                                            title: t("healthCheckTabStrategy"),

                                            href: ""
                                        },
                                        {
                                            title: t(
                                                "healthCheckTabConnection"
                                            ),
                                            href: ""
                                        },
                                        {
                                            title: t("healthCheckTabAdvanced"),
                                            href: ""
                                        }
                                    ]}
                                >
                                    {/* ── Strategy tab ──────────────────────── */}
                                    <div className="mt-4 p-1">
                                        <fieldset
                                            disabled={disableTabInputs}
                                            className={cn(
                                                "space-y-4",
                                                disableTabInputs &&
                                                    "pointer-events-none opacity-60"
                                            )}
                                        >
                                            {/* Strategy picker */}
                                            <FormField
                                                control={form.control}
                                                name="hcMode"
                                                render={({ field }) => (
                                                    <FormItem>
                                                        <FormControl>
                                                            <StrategySelect
                                                                cols={2}
                                                                options={[
                                                                    {
                                                                        id: "http",
                                                                        title: "HTTP",
                                                                        description:
                                                                            t(
                                                                                "healthCheckStrategyHttp"
                                                                            )
                                                                    },
                                                                    {
                                                                        id: "tcp",
                                                                        title: "TCP",
                                                                        description:
                                                                            t(
                                                                                "healthCheckStrategyTcp"
                                                                            )
                                                                    }
                                                                    // lets hide these for now until they are implemented
                                                                    // {
                                                                    //     id: "snmp",
                                                                    //     title: "SNMP",
                                                                    //     description: t(
                                                                    //         "healthCheckStrategySnmp"
                                                                    //     )
                                                                    // },
                                                                    // {
                                                                    //     id: "icmp",
                                                                    //     title: "Ping (ICMP)",
                                                                    //     description: t(
                                                                    //         "healthCheckStrategyIcmp"
                                                                    //     )
                                                                    // }
                                                                ]}
                                                                value={
                                                                    field.value
                                                                }
                                                                onChange={(
                                                                    value
                                                                ) =>
                                                                    handleChange(
                                                                        "hcMode",
                                                                        value,
                                                                        field.onChange
                                                                    )
                                                                }
                                                            />
                                                        </FormControl>
                                                        <FormMessage />
                                                    </FormItem>
                                                )}
                                            />
                                        </fieldset>
                                    </div>

                                    {/* ── Connection tab ────────────────────── */}
                                    <div className="mt-4 p-1">
                                        <fieldset
                                            disabled={disableTabInputs}
                                            className={cn(
                                                "space-y-4",
                                                disableTabInputs &&
                                                    "pointer-events-none opacity-60"
                                            )}
                                        >
                                            {/* Contact-sales banner for SNMP / ICMP */}
                                            {isSnmpOrIcmp && (
                                                <ContactSalesBanner />
                                            )}

                                            {!isSnmpOrIcmp && (
                                                <>
                                                    {/* Scheme / Hostname / Port */}
                                                    {isTcp ? (
                                                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                                            <FormField
                                                                control={
                                                                    form.control
                                                                }
                                                                name="hcHostname"
                                                                render={({
                                                                    field
                                                                }) => (
                                                                    <FormItem>
                                                                        <FormLabel>
                                                                            {t(
                                                                                "healthHostname"
                                                                            )}
                                                                        </FormLabel>
                                                                        <FormControl>
                                                                            <Input
                                                                                {...field}
                                                                                onChange={(
                                                                                    e
                                                                                ) =>
                                                                                    handleChange(
                                                                                        "hcHostname",
                                                                                        e
                                                                                            .target
                                                                                            .value,
                                                                                        () =>
                                                                                            field.onChange(
                                                                                                e
                                                                                            )
                                                                                    )
                                                                                }
                                                                            />
                                                                        </FormControl>
                                                                        <FormMessage />
                                                                    </FormItem>
                                                                )}
                                                            />
                                                            <FormField
                                                                control={
                                                                    form.control
                                                                }
                                                                name="hcPort"
                                                                render={({
                                                                    field
                                                                }) => (
                                                                    <FormItem>
                                                                        <FormLabel>
                                                                            {t(
                                                                                "healthPort"
                                                                            )}
                                                                        </FormLabel>
                                                                        <FormControl>
                                                                            <Input
                                                                                {...field}
                                                                                type="number"
                                                                                min={
                                                                                    1
                                                                                }
                                                                                max={
                                                                                    65535
                                                                                }
                                                                                onChange={(
                                                                                    e
                                                                                ) =>
                                                                                    handleChange(
                                                                                        "hcPort",
                                                                                        e
                                                                                            .target
                                                                                            .value,
                                                                                        field.onChange
                                                                                    )
                                                                                }
                                                                            />
                                                                        </FormControl>
                                                                        <FormMessage />
                                                                    </FormItem>
                                                                )}
                                                            />
                                                        </div>
                                                    ) : (
                                                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                                                            <FormField
                                                                control={
                                                                    form.control
                                                                }
                                                                name="hcScheme"
                                                                render={({
                                                                    field
                                                                }) => (
                                                                    <FormItem>
                                                                        <FormLabel>
                                                                            {t(
                                                                                "healthScheme"
                                                                            )}
                                                                        </FormLabel>
                                                                        <Select
                                                                            onValueChange={(
                                                                                value
                                                                            ) =>
                                                                                handleChange(
                                                                                    "hcScheme",
                                                                                    value,
                                                                                    field.onChange
                                                                                )
                                                                            }
                                                                            value={
                                                                                field.value
                                                                            }
                                                                        >
                                                                            <FormControl>
                                                                                <SelectTrigger>
                                                                                    <SelectValue
                                                                                        placeholder={t(
                                                                                            "healthSelectScheme"
                                                                                        )}
                                                                                    />
                                                                                </SelectTrigger>
                                                                            </FormControl>
                                                                            <SelectContent>
                                                                                <SelectItem value="http">
                                                                                    HTTP
                                                                                </SelectItem>
                                                                                <SelectItem value="https">
                                                                                    HTTPS
                                                                                </SelectItem>
                                                                            </SelectContent>
                                                                        </Select>
                                                                        <FormMessage />
                                                                    </FormItem>
                                                                )}
                                                            />
                                                            <FormField
                                                                control={
                                                                    form.control
                                                                }
                                                                name="hcHostname"
                                                                render={({
                                                                    field
                                                                }) => (
                                                                    <FormItem>
                                                                        <FormLabel>
                                                                            {t(
                                                                                "healthHostname"
                                                                            )}
                                                                        </FormLabel>
                                                                        <FormControl>
                                                                            <Input
                                                                                {...field}
                                                                                onChange={(
                                                                                    e
                                                                                ) =>
                                                                                    handleChange(
                                                                                        "hcHostname",
                                                                                        e
                                                                                            .target
                                                                                            .value,
                                                                                        () =>
                                                                                            field.onChange(
                                                                                                e
                                                                                            )
                                                                                    )
                                                                                }
                                                                            />
                                                                        </FormControl>
                                                                        <FormMessage />
                                                                    </FormItem>
                                                                )}
                                                            />
                                                            <FormField
                                                                control={
                                                                    form.control
                                                                }
                                                                name="hcPort"
                                                                render={({
                                                                    field
                                                                }) => (
                                                                    <FormItem>
                                                                        <FormLabel>
                                                                            {t(
                                                                                "healthPort"
                                                                            )}
                                                                        </FormLabel>
                                                                        <FormControl>
                                                                            <Input
                                                                                {...field}
                                                                                type="number"
                                                                                min={
                                                                                    1
                                                                                }
                                                                                max={
                                                                                    65535
                                                                                }
                                                                                onChange={(
                                                                                    e
                                                                                ) =>
                                                                                    handleChange(
                                                                                        "hcPort",
                                                                                        e
                                                                                            .target
                                                                                            .value,
                                                                                        field.onChange
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

                                                    {/* Method / Path / Timeout (HTTP) */}
                                                    {!isTcp && (
                                                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                                                            <FormField
                                                                control={
                                                                    form.control
                                                                }
                                                                name="hcMethod"
                                                                render={({
                                                                    field
                                                                }) => (
                                                                    <FormItem>
                                                                        <FormLabel>
                                                                            {t(
                                                                                "httpMethod"
                                                                            )}
                                                                        </FormLabel>
                                                                        <Select
                                                                            onValueChange={(
                                                                                value
                                                                            ) =>
                                                                                handleChange(
                                                                                    "hcMethod",
                                                                                    value,
                                                                                    field.onChange
                                                                                )
                                                                            }
                                                                            value={
                                                                                field.value
                                                                            }
                                                                        >
                                                                            <FormControl>
                                                                                <SelectTrigger>
                                                                                    <SelectValue
                                                                                        placeholder={t(
                                                                                            "selectHttpMethod"
                                                                                        )}
                                                                                    />
                                                                                </SelectTrigger>
                                                                            </FormControl>
                                                                            <SelectContent>
                                                                                <SelectItem value="GET">
                                                                                    GET
                                                                                </SelectItem>
                                                                                <SelectItem value="POST">
                                                                                    POST
                                                                                </SelectItem>
                                                                                <SelectItem value="HEAD">
                                                                                    HEAD
                                                                                </SelectItem>
                                                                                <SelectItem value="PUT">
                                                                                    PUT
                                                                                </SelectItem>
                                                                                <SelectItem value="DELETE">
                                                                                    DELETE
                                                                                </SelectItem>
                                                                            </SelectContent>
                                                                        </Select>
                                                                        <FormMessage />
                                                                    </FormItem>
                                                                )}
                                                            />
                                                            <FormField
                                                                control={
                                                                    form.control
                                                                }
                                                                name="hcPath"
                                                                render={({
                                                                    field
                                                                }) => (
                                                                    <FormItem>
                                                                        <FormLabel>
                                                                            {t(
                                                                                "healthCheckPath"
                                                                            )}
                                                                        </FormLabel>
                                                                        <FormControl>
                                                                            <Input
                                                                                {...field}
                                                                                onChange={(
                                                                                    e
                                                                                ) =>
                                                                                    handleChange(
                                                                                        "hcPath",
                                                                                        e
                                                                                            .target
                                                                                            .value,
                                                                                        () =>
                                                                                            field.onChange(
                                                                                                e
                                                                                            )
                                                                                    )
                                                                                }
                                                                            />
                                                                        </FormControl>
                                                                        <FormMessage />
                                                                    </FormItem>
                                                                )}
                                                            />
                                                            <FormField
                                                                control={
                                                                    form.control
                                                                }
                                                                name="hcTimeout"
                                                                render={({
                                                                    field
                                                                }) => (
                                                                    <FormItem>
                                                                        <FormLabel>
                                                                            {t(
                                                                                "timeoutSeconds"
                                                                            )}
                                                                        </FormLabel>
                                                                        <FormControl>
                                                                            <Input
                                                                                type="number"
                                                                                {...field}
                                                                                onChange={(
                                                                                    e
                                                                                ) =>
                                                                                    handleChange(
                                                                                        "hcTimeout",
                                                                                        parseInt(
                                                                                            e
                                                                                                .target
                                                                                                .value
                                                                                        ),
                                                                                        field.onChange
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

                                                    {/* Timeout for TCP */}
                                                    {isTcp && (
                                                        <FormField
                                                            control={
                                                                form.control
                                                            }
                                                            name="hcTimeout"
                                                            render={({
                                                                field
                                                            }) => (
                                                                <FormItem>
                                                                    <FormLabel>
                                                                        {t(
                                                                            "timeoutSeconds"
                                                                        )}
                                                                    </FormLabel>
                                                                    <FormControl>
                                                                        <Input
                                                                            type="number"
                                                                            {...field}
                                                                            onChange={(
                                                                                e
                                                                            ) =>
                                                                                handleChange(
                                                                                    "hcTimeout",
                                                                                    parseInt(
                                                                                        e
                                                                                            .target
                                                                                            .value
                                                                                    ),
                                                                                    field.onChange
                                                                                )
                                                                            }
                                                                        />
                                                                    </FormControl>
                                                                    <FormMessage />
                                                                </FormItem>
                                                            )}
                                                        />
                                                    )}
                                                </>
                                            )}
                                        </fieldset>
                                    </div>

                                    {/* ── Advanced tab ──────────────────────── */}
                                    <div className="mt-4 p-1">
                                        <fieldset
                                            disabled={disableTabInputs}
                                            className={cn(
                                                "space-y-4",
                                                disableTabInputs &&
                                                    "pointer-events-none opacity-60"
                                            )}
                                        >
                                            {/* Contact-sales banner for SNMP / ICMP */}
                                            {isSnmpOrIcmp && (
                                                <ContactSalesBanner />
                                            )}

                                            {!isSnmpOrIcmp && (
                                                <>
                                                    {/* Healthy interval + threshold */}
                                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                                        <FormField
                                                            control={
                                                                form.control
                                                            }
                                                            name="hcInterval"
                                                            render={({
                                                                field
                                                            }) => (
                                                                <FormItem>
                                                                    <FormLabel>
                                                                        {t(
                                                                            "healthyIntervalSeconds"
                                                                        )}
                                                                    </FormLabel>
                                                                    <FormControl>
                                                                        <Input
                                                                            type="number"
                                                                            {...field}
                                                                            onChange={(
                                                                                e
                                                                            ) =>
                                                                                handleChange(
                                                                                    "hcInterval",
                                                                                    parseInt(
                                                                                        e
                                                                                            .target
                                                                                            .value
                                                                                    ),
                                                                                    field.onChange
                                                                                )
                                                                            }
                                                                        />
                                                                    </FormControl>
                                                                    <FormMessage />
                                                                </FormItem>
                                                            )}
                                                        />
                                                        <FormField
                                                            control={
                                                                form.control
                                                            }
                                                            name="hcHealthyThreshold"
                                                            render={({
                                                                field
                                                            }) => (
                                                                <FormItem>
                                                                    <FormLabel>
                                                                        {t(
                                                                            "healthyThreshold"
                                                                        )}
                                                                    </FormLabel>
                                                                    <FormControl>
                                                                        <Input
                                                                            type="number"
                                                                            {...field}
                                                                            onChange={(
                                                                                e
                                                                            ) =>
                                                                                handleChange(
                                                                                    "hcHealthyThreshold",
                                                                                    parseInt(
                                                                                        e
                                                                                            .target
                                                                                            .value
                                                                                    ),
                                                                                    field.onChange
                                                                                )
                                                                            }
                                                                        />
                                                                    </FormControl>
                                                                    <FormMessage />
                                                                </FormItem>
                                                            )}
                                                        />
                                                    </div>

                                                    {/* Unhealthy interval + threshold */}
                                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                                        <FormField
                                                            control={
                                                                form.control
                                                            }
                                                            name="hcUnhealthyInterval"
                                                            render={({
                                                                field
                                                            }) => (
                                                                <FormItem>
                                                                    <FormLabel>
                                                                        {t(
                                                                            "unhealthyIntervalSeconds"
                                                                        )}
                                                                    </FormLabel>
                                                                    <FormControl>
                                                                        <Input
                                                                            type="number"
                                                                            {...field}
                                                                            onChange={(
                                                                                e
                                                                            ) =>
                                                                                handleChange(
                                                                                    "hcUnhealthyInterval",
                                                                                    parseInt(
                                                                                        e
                                                                                            .target
                                                                                            .value
                                                                                    ),
                                                                                    field.onChange
                                                                                )
                                                                            }
                                                                        />
                                                                    </FormControl>
                                                                    <FormMessage />
                                                                </FormItem>
                                                            )}
                                                        />
                                                        <FormField
                                                            control={
                                                                form.control
                                                            }
                                                            name="hcUnhealthyThreshold"
                                                            render={({
                                                                field
                                                            }) => (
                                                                <FormItem>
                                                                    <FormLabel>
                                                                        {t(
                                                                            "unhealthyThreshold"
                                                                        )}
                                                                    </FormLabel>
                                                                    <FormControl>
                                                                        <Input
                                                                            type="number"
                                                                            {...field}
                                                                            onChange={(
                                                                                e
                                                                            ) =>
                                                                                handleChange(
                                                                                    "hcUnhealthyThreshold",
                                                                                    parseInt(
                                                                                        e
                                                                                            .target
                                                                                            .value
                                                                                    ),
                                                                                    field.onChange
                                                                                )
                                                                            }
                                                                        />
                                                                    </FormControl>
                                                                    <FormMessage />
                                                                </FormItem>
                                                            )}
                                                        />
                                                    </div>

                                                    {/* HTTP-only advanced fields */}
                                                    {!isTcp && (
                                                        <>
                                                            {/* Expected status + TLS server name */}
                                                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                                                <FormField
                                                                    control={
                                                                        form.control
                                                                    }
                                                                    name="hcStatus"
                                                                    render={({
                                                                        field
                                                                    }) => (
                                                                        <FormItem>
                                                                            <FormLabel>
                                                                                {t(
                                                                                    "expectedResponseCodes"
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
                                                                                    ) => {
                                                                                        const val =
                                                                                            e
                                                                                                .target
                                                                                                .value;
                                                                                        const value =
                                                                                            val
                                                                                                ? parseInt(
                                                                                                      val
                                                                                                  )
                                                                                                : null;
                                                                                        handleChange(
                                                                                            "hcStatus",
                                                                                            value,
                                                                                            field.onChange
                                                                                        );
                                                                                    }}
                                                                                />
                                                                            </FormControl>
                                                                            <FormMessage />
                                                                        </FormItem>
                                                                    )}
                                                                />
                                                                <FormField
                                                                    control={
                                                                        form.control
                                                                    }
                                                                    name="hcTlsServerName"
                                                                    render={({
                                                                        field
                                                                    }) => (
                                                                        <FormItem>
                                                                            <FormLabel>
                                                                                {t(
                                                                                    "tlsServerName"
                                                                                )}
                                                                            </FormLabel>
                                                                            <FormControl>
                                                                                <Input
                                                                                    {...field}
                                                                                    onChange={(
                                                                                        e
                                                                                    ) =>
                                                                                        handleChange(
                                                                                            "hcTlsServerName",
                                                                                            e
                                                                                                .target
                                                                                                .value,
                                                                                            () =>
                                                                                                field.onChange(
                                                                                                    e
                                                                                                )
                                                                                        )
                                                                                    }
                                                                                />
                                                                            </FormControl>
                                                                            <FormMessage />
                                                                        </FormItem>
                                                                    )}
                                                                />
                                                            </div>

                                                            {/* Follow redirects */}
                                                            <FormField
                                                                control={
                                                                    form.control
                                                                }
                                                                name="hcFollowRedirects"
                                                                render={({
                                                                    field
                                                                }) => (
                                                                    <FormItem>
                                                                        <FormControl>
                                                                            <SwitchInput
                                                                                id="hcFollowRedirects"
                                                                                label={t(
                                                                                    "followRedirects"
                                                                                )}
                                                                                checked={
                                                                                    field.value
                                                                                }
                                                                                onCheckedChange={(
                                                                                    value
                                                                                ) =>
                                                                                    handleChange(
                                                                                        "hcFollowRedirects",
                                                                                        value,
                                                                                        field.onChange
                                                                                    )
                                                                                }
                                                                            />
                                                                        </FormControl>
                                                                    </FormItem>
                                                                )}
                                                            />

                                                            {/* Custom headers */}
                                                            <FormField
                                                                control={
                                                                    form.control
                                                                }
                                                                name="hcHeaders"
                                                                render={({
                                                                    field
                                                                }) => (
                                                                    <FormItem>
                                                                        <FormLabel>
                                                                            {t(
                                                                                "customRequestHeaders"
                                                                            )}
                                                                        </FormLabel>
                                                                        <FormControl>
                                                                            <HeadersInput
                                                                                value={
                                                                                    field.value
                                                                                }
                                                                                onChange={(
                                                                                    value
                                                                                ) =>
                                                                                    handleChange(
                                                                                        "hcHeaders",
                                                                                        value,
                                                                                        field.onChange
                                                                                    )
                                                                                }
                                                                                rows={
                                                                                    4
                                                                                }
                                                                            />
                                                                        </FormControl>
                                                                        <FormDescription>
                                                                            {t(
                                                                                "customRequestHeadersDescription"
                                                                            )}
                                                                        </FormDescription>
                                                                        <FormMessage />
                                                                    </FormItem>
                                                                )}
                                                            />
                                                        </>
                                                    )}
                                                </>
                                            )}
                                        </fieldset>
                                    </div>
                                </HorizontalTabs>
                            </div>
                        </form>
                    </Form>
                </CredenzaBody>
                <CredenzaFooter>
                    {mode === "autoSave" ? (
                        <Button onClick={() => setOpen(false)}>
                            {t("done")}
                        </Button>
                    ) : (
                        <>
                            <CredenzaClose asChild>
                                <Button variant="outline" type="button">
                                    {t("cancel")}
                                </Button>
                            </CredenzaClose>
                            <Button
                                type="submit"
                                form="hc-credenza-form"
                                disabled={loading}
                            >
                                {t("save")}
                            </Button>
                        </>
                    )}
                </CredenzaFooter>
            </CredenzaContent>
        </Credenza>
    );
}

export default HealthCheckCredenza;
