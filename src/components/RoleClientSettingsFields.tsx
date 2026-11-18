"use client";

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
import {
    InfoSection,
    InfoSectionContent,
    InfoSectionTitle,
    InfoSections
} from "@app/components/InfoSection";
import { OptionSelect } from "@app/components/OptionSelect";
import { PaidFeaturesAlert } from "@app/components/PaidFeaturesAlert";
import {
    SettingsSubsectionDescription,
    SettingsSubsectionHeader,
    SettingsSubsectionTitle
} from "@app/components/Settings";
import { SwitchInput } from "@app/components/SwitchInput";
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
    SelectSeparator,
    SelectTrigger,
    SelectValue
} from "@app/components/ui/select";
import { Textarea } from "@app/components/ui/textarea";
import { createApiClient } from "@app/lib/api";
import { cn } from "@app/lib/cn";
import { orgQueries } from "@app/lib/queries";
import { zodResolver } from "@hookform/resolvers/zod";
import { tierMatrix } from "@server/lib/billing/tierMatrix";
import type { RoleClientSettingsValues } from "@server/routers/role/types";
import type { ListAllSiteResourcesByOrgResponse } from "@server/routers/siteResource";
import { useQuery } from "@tanstack/react-query";
import { ExternalLink } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState, type FormEvent, type ReactNode } from "react";
import {
    useForm,
    useWatch,
    type FieldValues,
    type Path,
    type UseFormReturn
} from "react-hook-form";
import { z } from "zod";

export const defaultRoleClientSettings: RoleClientSettingsValues = {
    enabled: false,
    overrideDns: null,
    mtu: null,
    tunnelDns: null,
    primaryDns: null,
    secondaryDns: null,
    exitNodeTakesPrecedence: null,
    exitNodeSiteResourceId: null,
    exitNodeLocked: false,
    matchDomains: null,
    preferLocalRoutes: null
};

export async function saveRoleClientSettings(
    api: ReturnType<typeof createApiClient>,
    roleId: number,
    settings: RoleClientSettingsValues
) {
    await api.post(`/role/${roleId}/client-settings`, settings);
}

type ManagedBoolean = "unmanaged" | "on" | "off";
type SettingsSectionKey = "dns" | "exitNode" | "advanced";

const NO_EXIT_NODE = "none";

const DNS_UNMANAGED = "unmanaged";
const DNS_CUSTOM = "custom";

// Well-known public resolvers offered in the upstream DNS pickers. Provider
// names are brands, so they aren't translated.
const PUBLIC_DNS_SERVERS: { provider: string; address: string }[] = [
    { provider: "Cloudflare", address: "1.1.1.1" },
    { provider: "Cloudflare", address: "1.0.0.1" },
    { provider: "Google", address: "8.8.8.8" },
    { provider: "Google", address: "8.8.4.4" },
    { provider: "Quad9", address: "9.9.9.9" },
    { provider: "Quad9", address: "149.112.112.112" },
    { provider: "OpenDNS", address: "208.67.222.222" },
    { provider: "OpenDNS", address: "208.67.220.220" },
    { provider: "AdGuard", address: "94.140.14.14" },
    { provider: "AdGuard", address: "94.140.15.15" }
];

function publicDnsLabel(address: string): string | undefined {
    const server = PUBLIC_DNS_SERVERS.find((s) => s.address === address);
    return server ? `${server.provider} (${server.address})` : undefined;
}

// Splits a stored DNS server into the picker's choice and its custom value.
function toDnsChoice(address: string | null): {
    choice: string;
    custom: string;
} {
    if (!address) return { choice: DNS_UNMANAGED, custom: "" };
    if (publicDnsLabel(address)) return { choice: address, custom: "" };
    return { choice: DNS_CUSTOM, custom: address };
}

function fromDnsChoice(choice: string, custom: string): string | null {
    if (choice === DNS_UNMANAGED) return null;
    if (choice === DNS_CUSTOM) return custom.trim() || null;
    return choice;
}
const CLIENT_SETTINGS_DOCS_URL =
    "https://docs.pangolin.net/manage/clients/platforms#shared-preferences-all-platforms";
const managedBooleanSchema = z.enum(["unmanaged", "on", "off"]);

function toManagedBoolean(value: boolean | null): ManagedBoolean {
    return value === null ? "unmanaged" : value ? "on" : "off";
}

function fromManagedBoolean(value: ManagedBoolean): boolean | null {
    return value === "unmanaged" ? null : value === "on";
}

type RoleClientSettingsFieldsProps = {
    orgId: string;
    /** Gateway resources loaded on the server, so exit node names show at once. */
    initialGateways?: ListAllSiteResourcesByOrgResponse["siteResources"];
    value: RoleClientSettingsValues;
    onChange: (value: RoleClientSettingsValues) => void;
    disabled?: boolean;
};

export function RoleClientSettingsFields({
    orgId,
    initialGateways,
    value,
    onChange,
    disabled = false
}: RoleClientSettingsFieldsProps) {
    const t = useTranslations();
    const [editing, setEditing] = useState<SettingsSectionKey | null>(null);

    const gatewaysQuery = useQuery({
        ...orgQueries.gatewayResources({ orgId }),
        enabled: !disabled,
        initialData: initialGateways
    });
    const gateways = gatewaysQuery.data ?? [];

    const cardsDisabled = disabled || !value.enabled;

    function apply(changes: Partial<RoleClientSettingsValues>) {
        onChange({ ...value, ...changes });
        setEditing(null);
    }

    function booleanLabel(setting: boolean | null) {
        if (setting === null) return t("clientSettingsUnmanaged");
        return setting ? t("clientSettingsOn") : t("clientSettingsOff");
    }

    function dnsLabel(address: string | null) {
        if (!address) return t("clientSettingsUnmanaged");
        return publicDnsLabel(address) ?? address;
    }

    function textLabel(setting: string | number | null) {
        return setting === null || setting === ""
            ? t("clientSettingsUnmanaged")
            : String(setting);
    }

    const exitNodeName =
        value.exitNodeSiteResourceId === null
            ? t("clientSettingsUnmanaged")
            : (gateways.find(
                  (g) => g.siteResourceId === value.exitNodeSiteResourceId
              )?.name ?? String(value.exitNodeSiteResourceId));

    const matchDomains = value.matchDomains?.filter((d) => d.trim()) ?? [];

    return (
        <div className="space-y-6">
            <PaidFeaturesAlert tiers={tierMatrix.clientSettings} />

            <SwitchInput
                id="client-settings-enabled"
                label={t("clientSettingsEnabled")}
                description={t("clientSettingsEnabledDescription")}
                checked={value.enabled}
                disabled={disabled}
                onCheckedChange={(enabled) => onChange({ ...value, enabled })}
            />

            <div className="flex flex-col gap-6">
                <SettingsCard
                    title={t("clientSettingsSectionDns")}
                    description={t("clientSettingsSectionDnsDescription")}
                    disabled={cardsDisabled}
                    onEdit={() => setEditing("dns")}
                    rows={[
                        {
                            label: t("clientSettingsOverrideDns"),
                            value: booleanLabel(value.overrideDns)
                        },
                        {
                            label: t("clientSettingsTunnelDns"),
                            value: booleanLabel(value.tunnelDns)
                        },
                        {
                            label: t("clientSettingsPrimaryDns"),
                            value: dnsLabel(value.primaryDns)
                        },
                        {
                            label: t("clientSettingsSecondaryDns"),
                            value: dnsLabel(value.secondaryDns)
                        },
                        {
                            label: t("clientSettingsMatchDomains"),
                            value: matchDomains.length
                                ? t("clientSettingsMatchDomainsCount", {
                                      count: matchDomains.length
                                  })
                                : t("clientSettingsUnmanaged")
                        }
                    ]}
                />

                <SettingsCard
                    title={t("clientSettingsSectionExitNode")}
                    description={t("clientSettingsSectionExitNodeDescription")}
                    disabled={cardsDisabled}
                    onEdit={() => setEditing("exitNode")}
                    rows={[
                        {
                            label: t("clientSettingsExitNode"),
                            value: exitNodeName
                        },
                        ...(value.exitNodeSiteResourceId !== null
                            ? [
                                  {
                                      label: t("clientSettingsExitNodeMode"),
                                      value: value.exitNodeLocked
                                          ? t("clientSettingsExitNodeLocked")
                                          : t("clientSettingsExitNodeDefault")
                                  }
                              ]
                            : []),
                        {
                            label: t("clientSettingsExitNodePrecedence"),
                            value: booleanLabel(value.exitNodeTakesPrecedence)
                        }
                    ]}
                />

                <SettingsCard
                    title={t("clientSettingsSectionAdvanced")}
                    description={t("clientSettingsSectionAdvancedDescription")}
                    disabled={cardsDisabled}
                    onEdit={() => setEditing("advanced")}
                    rows={[
                        {
                            label: t("clientSettingsMtu"),
                            value: textLabel(value.mtu)
                        },
                        {
                            label: t("clientSettingsPreferLocalRoutes"),
                            value: booleanLabel(value.preferLocalRoutes)
                        }
                    ]}
                />
            </div>

            {editing === "dns" && (
                <DnsSettingsCredenza
                    value={value}
                    onApply={apply}
                    onClose={() => setEditing(null)}
                />
            )}
            {editing === "exitNode" && (
                <ExitNodeSettingsCredenza
                    value={value}
                    gateways={gateways}
                    onApply={apply}
                    onClose={() => setEditing(null)}
                />
            )}
            {editing === "advanced" && (
                <AdvancedSettingsCredenza
                    value={value}
                    onApply={apply}
                    onClose={() => setEditing(null)}
                />
            )}
        </div>
    );
}

function SettingsCard({
    title,
    description,
    rows,
    disabled,
    onEdit
}: {
    title: string;
    description: string;
    rows: { label: string; value: string }[];
    disabled: boolean;
    onEdit: () => void;
}) {
    const t = useTranslations();
    return (
        <div className={cn("flex flex-col gap-2", disabled && "opacity-60")}>
            <SettingsSubsectionHeader>
                <SettingsSubsectionTitle>{title}</SettingsSubsectionTitle>
                <SettingsSubsectionDescription>
                    {description}
                </SettingsSubsectionDescription>
            </SettingsSubsectionHeader>
            <InfoSections cols={3} size="sm">
                {rows.map((row) => (
                    <InfoSection key={row.label}>
                        <InfoSectionTitle>{row.label}</InfoSectionTitle>
                        <InfoSectionContent>{row.value}</InfoSectionContent>
                    </InfoSection>
                ))}
            </InfoSections>
            <div className="pt-2">
                <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={disabled}
                    onClick={onEdit}
                >
                    {t("edit")}
                </Button>
            </div>
        </div>
    );
}

type SectionCredenzaProps = {
    value: RoleClientSettingsValues;
    onApply: (changes: Partial<RoleClientSettingsValues>) => void;
    onClose: () => void;
};

// The Credenza is portaled, but React still bubbles its submit event up to the
// role form it is rendered inside, so stop it here.
function isolatedSubmit<T extends FieldValues>(
    form: UseFormReturn<T>,
    onValid: (values: T) => void
) {
    return (e: FormEvent<HTMLFormElement>) => {
        e.stopPropagation();
        return form.handleSubmit(onValid)(e);
    };
}

function SectionCredenza({
    formId,
    title,
    description,
    onClose,
    children
}: {
    formId: string;
    title: string;
    description: string;
    onClose: () => void;
    children: ReactNode;
}) {
    const t = useTranslations();
    return (
        <Credenza open onOpenChange={(open) => !open && onClose()}>
            <CredenzaContent>
                <CredenzaHeader>
                    <CredenzaTitle>{title}</CredenzaTitle>
                    <CredenzaDescription>
                        {description}{" "}
                        <a
                            href={CLIENT_SETTINGS_DOCS_URL}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-primary hover:underline inline-flex items-center gap-1"
                        >
                            {t("learnMore")}
                            <ExternalLink className="size-3.5 shrink-0" />
                        </a>
                    </CredenzaDescription>
                </CredenzaHeader>
                <CredenzaBody>{children}</CredenzaBody>
                <CredenzaFooter>
                    <CredenzaClose asChild>
                        <Button type="button" variant="outline">
                            {t("cancel")}
                        </Button>
                    </CredenzaClose>
                    <Button type="submit" form={formId}>
                        {t("done")}
                    </Button>
                </CredenzaFooter>
            </CredenzaContent>
        </Credenza>
    );
}

function ManagedBooleanField<T extends FieldValues>({
    form,
    name,
    label,
    description
}: {
    form: UseFormReturn<T>;
    name: Path<T>;
    label: string;
    description: string;
}) {
    const t = useTranslations();
    return (
        <FormField
            control={form.control}
            name={name}
            render={({ field }) => (
                <FormItem>
                    <FormLabel>{label}</FormLabel>
                    <OptionSelect<ManagedBoolean>
                        options={[
                            {
                                value: "unmanaged",
                                label: t("clientSettingsUnmanaged")
                            },
                            { value: "on", label: t("clientSettingsOn") },
                            { value: "off", label: t("clientSettingsOff") }
                        ]}
                        value={field.value as ManagedBoolean}
                        onChange={field.onChange}
                        cols={3}
                    />
                    <FormDescription>{description}</FormDescription>
                    <FormMessage />
                </FormItem>
            )}
        />
    );
}

function DnsSettingsCredenza({
    value,
    onApply,
    onClose
}: SectionCredenzaProps) {
    const t = useTranslations();

    const isIp = (v: string) =>
        z.union([z.ipv4(), z.ipv6()]).safeParse(v).success;

    const schema = z
        .object({
            overrideDns: managedBooleanSchema,
            tunnelDns: managedBooleanSchema,
            primaryDnsChoice: z.string(),
            primaryDnsCustom: z.string().trim(),
            secondaryDnsChoice: z.string(),
            secondaryDnsCustom: z.string().trim(),
            matchDomains: z.string()
        })
        .superRefine((values, ctx) => {
            for (const key of ["primaryDns", "secondaryDns"] as const) {
                if (
                    values[`${key}Choice`] === DNS_CUSTOM &&
                    !isIp(values[`${key}Custom`])
                ) {
                    ctx.addIssue({
                        code: "custom",
                        path: [`${key}Custom`],
                        message: t("rulesErrorInvalidIpAddressDescription")
                    });
                }
            }
        });
    type Values = z.infer<typeof schema>;

    const primary = toDnsChoice(value.primaryDns);
    const secondary = toDnsChoice(value.secondaryDns);

    const form = useForm<Values>({
        resolver: zodResolver(schema),
        defaultValues: {
            overrideDns: toManagedBoolean(value.overrideDns),
            tunnelDns: toManagedBoolean(value.tunnelDns),
            primaryDnsChoice: primary.choice,
            primaryDnsCustom: primary.custom,
            secondaryDnsChoice: secondary.choice,
            secondaryDnsCustom: secondary.custom,
            matchDomains: value.matchDomains?.join("\n") ?? ""
        }
    });

    function onSubmit(values: Values) {
        const matchDomains = values.matchDomains
            .split(/\r?\n/)
            .map((d) => d.trim())
            .filter(Boolean);
        onApply({
            overrideDns: fromManagedBoolean(values.overrideDns),
            tunnelDns: fromManagedBoolean(values.tunnelDns),
            primaryDns: fromDnsChoice(
                values.primaryDnsChoice,
                values.primaryDnsCustom
            ),
            secondaryDns: fromDnsChoice(
                values.secondaryDnsChoice,
                values.secondaryDnsCustom
            ),
            matchDomains: matchDomains.length ? matchDomains : null
        });
    }

    const formId = "role-client-settings-dns-form";

    return (
        <SectionCredenza
            formId={formId}
            title={t("clientSettingsSectionDns")}
            description={t("clientSettingsSectionDnsDescription")}
            onClose={onClose}
        >
            <Form {...form}>
                <form
                    id={formId}
                    className="space-y-6"
                    onSubmit={isolatedSubmit(form, onSubmit)}
                >
                    <ManagedBooleanField
                        form={form}
                        name="overrideDns"
                        label={t("clientSettingsOverrideDns")}
                        description={t("clientSettingsOverrideDnsDescription")}
                    />
                    <ManagedBooleanField
                        form={form}
                        name="tunnelDns"
                        label={t("clientSettingsTunnelDns")}
                        description={t("clientSettingsTunnelDnsDescription")}
                    />
                    <div className="grid gap-4 sm:grid-cols-2">
                        <DnsServerField
                            form={form}
                            choiceName="primaryDnsChoice"
                            customName="primaryDnsCustom"
                            label={t("clientSettingsPrimaryDns")}
                        />
                        <DnsServerField
                            form={form}
                            choiceName="secondaryDnsChoice"
                            customName="secondaryDnsCustom"
                            label={t("clientSettingsSecondaryDns")}
                        />
                    </div>
                    <FormField
                        control={form.control}
                        name="matchDomains"
                        render={({ field }) => (
                            <FormItem>
                                <FormLabel>
                                    {t("clientSettingsMatchDomains")}
                                </FormLabel>
                                <FormControl>
                                    <Textarea
                                        {...field}
                                        className="h-24 min-h-24"
                                        placeholder={t(
                                            "clientSettingsUnmanaged"
                                        )}
                                    />
                                </FormControl>
                                <FormDescription>
                                    {t("clientSettingsMatchDomainsDescription")}
                                </FormDescription>
                                <FormMessage />
                            </FormItem>
                        )}
                    />
                </form>
            </Form>
        </SectionCredenza>
    );
}

function DnsServerField<T extends FieldValues>({
    form,
    choiceName,
    customName,
    label
}: {
    form: UseFormReturn<T>;
    choiceName: Path<T>;
    customName: Path<T>;
    label: string;
}) {
    const t = useTranslations();
    const choice = useWatch({ control: form.control, name: choiceName });

    return (
        <div className="space-y-2">
            <FormField
                control={form.control}
                name={choiceName}
                render={({ field }) => (
                    <FormItem>
                        <FormLabel>{label}</FormLabel>
                        <Select
                            value={field.value}
                            onValueChange={field.onChange}
                        >
                            <FormControl>
                                <SelectTrigger className="w-full">
                                    <SelectValue />
                                </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                                <SelectItem value={DNS_UNMANAGED}>
                                    {t("clientSettingsUnmanaged")}
                                </SelectItem>
                                <SelectSeparator />
                                {PUBLIC_DNS_SERVERS.map((server) => (
                                    <SelectItem
                                        key={server.address}
                                        value={server.address}
                                    >
                                        {server.provider} ({server.address})
                                    </SelectItem>
                                ))}
                                <SelectSeparator />
                                <SelectItem value={DNS_CUSTOM}>
                                    {t("clientSettingsDnsCustom")}
                                </SelectItem>
                            </SelectContent>
                        </Select>
                        <FormMessage />
                    </FormItem>
                )}
            />
            {choice === DNS_CUSTOM && (
                <FormField
                    control={form.control}
                    name={customName}
                    render={({ field }) => (
                        <FormItem>
                            <FormControl>
                                <Input
                                    {...field}
                                    aria-label={label}
                                    placeholder={t(
                                        "clientSettingsDnsCustomPlaceholder"
                                    )}
                                />
                            </FormControl>
                            <FormMessage />
                        </FormItem>
                    )}
                />
            )}
        </div>
    );
}

function ExitNodeSettingsCredenza({
    value,
    gateways,
    onApply,
    onClose
}: SectionCredenzaProps & {
    gateways: { siteResourceId: number; name: string }[];
}) {
    const t = useTranslations();

    const schema = z.object({
        exitNode: z.string(),
        exitNodeMode: z.enum(["default", "locked"]),
        exitNodeTakesPrecedence: managedBooleanSchema
    });
    type Values = z.infer<typeof schema>;

    const form = useForm<Values>({
        resolver: zodResolver(schema),
        defaultValues: {
            exitNode: value.exitNodeSiteResourceId?.toString() ?? NO_EXIT_NODE,
            exitNodeMode: value.exitNodeLocked ? "locked" : "default",
            exitNodeTakesPrecedence: toManagedBoolean(
                value.exitNodeTakesPrecedence
            )
        }
    });

    const exitNode = useWatch({ control: form.control, name: "exitNode" });

    function onSubmit(values: Values) {
        const exitNodeSiteResourceId =
            values.exitNode === NO_EXIT_NODE ? null : Number(values.exitNode);
        onApply({
            exitNodeSiteResourceId,
            exitNodeLocked:
                exitNodeSiteResourceId !== null &&
                values.exitNodeMode === "locked",
            exitNodeTakesPrecedence: fromManagedBoolean(
                values.exitNodeTakesPrecedence
            )
        });
    }

    const formId = "role-client-settings-exit-node-form";

    return (
        <SectionCredenza
            formId={formId}
            title={t("clientSettingsSectionExitNode")}
            description={t("clientSettingsSectionExitNodeDescription")}
            onClose={onClose}
        >
            <Form {...form}>
                <form
                    id={formId}
                    className="space-y-6"
                    onSubmit={isolatedSubmit(form, onSubmit)}
                >
                    <FormField
                        control={form.control}
                        name="exitNode"
                        render={({ field }) => (
                            <FormItem>
                                <FormLabel>
                                    {t("clientSettingsExitNode")}
                                </FormLabel>
                                <Select
                                    value={field.value}
                                    onValueChange={field.onChange}
                                >
                                    <FormControl>
                                        <SelectTrigger className="w-full">
                                            <SelectValue />
                                        </SelectTrigger>
                                    </FormControl>
                                    <SelectContent>
                                        <SelectItem value={NO_EXIT_NODE}>
                                            {t("clientSettingsUnmanaged")}
                                        </SelectItem>
                                        {gateways.map((gateway) => (
                                            <SelectItem
                                                key={gateway.siteResourceId}
                                                value={gateway.siteResourceId.toString()}
                                            >
                                                {gateway.name}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                                <FormDescription>
                                    {t("clientSettingsExitNodeDescription")}
                                </FormDescription>
                                <FormMessage />
                            </FormItem>
                        )}
                    />
                    {exitNode !== NO_EXIT_NODE && (
                        <FormField
                            control={form.control}
                            name="exitNodeMode"
                            render={({ field }) => (
                                <FormItem>
                                    <FormLabel>
                                        {t("clientSettingsExitNodeMode")}
                                    </FormLabel>
                                    <OptionSelect<"default" | "locked">
                                        options={[
                                            {
                                                value: "default",
                                                label: t(
                                                    "clientSettingsExitNodeDefault"
                                                )
                                            },
                                            {
                                                value: "locked",
                                                label: t(
                                                    "clientSettingsExitNodeLocked"
                                                )
                                            }
                                        ]}
                                        value={field.value}
                                        onChange={field.onChange}
                                        cols={2}
                                    />
                                    <FormDescription>
                                        {t(
                                            "clientSettingsExitNodeModeDescription"
                                        )}
                                    </FormDescription>
                                    <FormMessage />
                                </FormItem>
                            )}
                        />
                    )}
                    <ManagedBooleanField
                        form={form}
                        name="exitNodeTakesPrecedence"
                        label={t("clientSettingsExitNodePrecedence")}
                        description={t(
                            "clientSettingsExitNodePrecedenceDescription"
                        )}
                    />
                </form>
            </Form>
        </SectionCredenza>
    );
}

function AdvancedSettingsCredenza({
    value,
    onApply,
    onClose
}: SectionCredenzaProps) {
    const t = useTranslations();

    const schema = z.object({
        mtu: z
            .string()
            .trim()
            .refine(
                (v) => {
                    if (v === "") return true;
                    const n = Number(v);
                    return Number.isInteger(n) && n >= 576 && n <= 65535;
                },
                { message: t("clientSettingsMtuDescription") }
            ),
        preferLocalRoutes: managedBooleanSchema
    });
    type Values = z.infer<typeof schema>;

    const form = useForm<Values>({
        resolver: zodResolver(schema),
        defaultValues: {
            mtu: value.mtu?.toString() ?? "",
            preferLocalRoutes: toManagedBoolean(value.preferLocalRoutes)
        }
    });

    function onSubmit(values: Values) {
        onApply({
            mtu: values.mtu ? Number(values.mtu) : null,
            preferLocalRoutes: fromManagedBoolean(values.preferLocalRoutes)
        });
    }

    const formId = "role-client-settings-advanced-form";

    return (
        <SectionCredenza
            formId={formId}
            title={t("clientSettingsSectionAdvanced")}
            description={t("clientSettingsSectionAdvancedDescription")}
            onClose={onClose}
        >
            <Form {...form}>
                <form
                    id={formId}
                    className="space-y-6"
                    onSubmit={isolatedSubmit(form, onSubmit)}
                >
                    <FormField
                        control={form.control}
                        name="mtu"
                        render={({ field }) => (
                            <FormItem>
                                <FormLabel>{t("clientSettingsMtu")}</FormLabel>
                                <FormControl>
                                    <Input
                                        {...field}
                                        type="number"
                                        placeholder={t(
                                            "clientSettingsUnmanaged"
                                        )}
                                        min={576}
                                        max={65535}
                                    />
                                </FormControl>
                                <FormDescription>
                                    {t("clientSettingsMtuDescription")}
                                </FormDescription>
                                <FormMessage />
                            </FormItem>
                        )}
                    />
                    <ManagedBooleanField
                        form={form}
                        name="preferLocalRoutes"
                        label={t("clientSettingsPreferLocalRoutes")}
                        description={t(
                            "clientSettingsPreferLocalRoutesDescription"
                        )}
                    />
                </form>
            </Form>
        </SectionCredenza>
    );
}
