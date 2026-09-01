"use client";

import { ContactSalesBanner } from "@app/components/ContactSalesBanner";
import { StrategySelect } from "@app/components/StrategySelect";
import { TagInput, type Tag } from "@app/components/tags/tag-input";
import { Button } from "@app/components/ui/button";
import { Checkbox } from "@app/components/ui/checkbox";
import {
    Command,
    CommandEmpty,
    CommandGroup,
    CommandInput,
    CommandItem,
    CommandList
} from "@app/components/ui/command";
import {
    FormControl,
    FormDescription,
    FormField,
    FormItem,
    FormLabel,
    FormMessage
} from "@app/components/ui/form";
import { Input } from "@app/components/ui/input";
import { Switch } from "@app/components/ui/switch";
import { Textarea } from "@app/components/ui/textarea";
import { Label } from "@app/components/ui/label";
import {
    Popover,
    PopoverContent,
    PopoverTrigger
} from "@app/components/ui/popover";
import { RadioGroup, RadioGroupItem } from "@app/components/ui/radio-group";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue
} from "@app/components/ui/select";
import {
    type AlertRuleFormAction,
    type AlertRuleFormValues
} from "@app/lib/alertRuleForm";
import { getUserDisplayName } from "@app/lib/getUserDisplayName";
import { orgQueries } from "@app/lib/queries";
import { useQuery } from "@tanstack/react-query";
import {
    Bell,
    ChevronRightIcon,
    ChevronsUpDown,
    Globe,
    Plus,
    Trash2
} from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useMemo, useRef, useState } from "react";
import type { Control, UseFormReturn } from "react-hook-form";
import { useFormContext, useWatch } from "react-hook-form";
import { useDebounce } from "use-debounce";
import { RolesSelector } from "../roles-selector";
import { UsersSelector } from "../users-selector";
import { cn } from "@app/lib/cn";

export function AddActionPanel({
    onAdd
}: {
    onAdd: (type: AlertRuleFormAction["type"]) => void;
}) {
    const t = useTranslations();

    const EXTERNAL_INTEGRATIONS = [
        {
            id: "pagerduty",
            name: "PagerDuty",
            logo: "/third-party/pgd.png",
            description: "Send alerts to PagerDuty for incident management",
            descriptionKey: t("alertingExternalPagerDutyDescription")
        },
        {
            id: "opsgenie",
            name: "Opsgenie",
            logo: "/third-party/opsgenie.png",
            description: "Route alerts to Opsgenie for on-call management",
            descriptionKey: t("alertingExternalOpsgenieDescription")
        },
        {
            id: "servicenow",
            name: "ServiceNow",
            logo: "/third-party/servicenow.png",
            description: "Create ServiceNow incidents from alert events",
            descriptionKey: t("alertingExternalServiceNowDescription")
        },
        {
            id: "incidentio",
            name: "Incident.io",
            logo: "/third-party/incidentio.png",
            description: "Trigger Incident.io workflows from alert events",
            descriptionKey: t("alertingExternalIncidentIoDescription")
        }
    ] as const;

    const EXTERNAL_IDS = EXTERNAL_INTEGRATIONS.map((i) => i.id);

    const [selected, setSelected] = useState<string | null>("notify");
    const [isPopoverOpen, setPopoverOpen] = useState(false);

    const isPremiumSelected =
        selected !== null && EXTERNAL_IDS.includes(selected as any);
    const isBuiltInSelected = selected !== null && !isPremiumSelected;

    const actionTypeOptions = [
        {
            id: "notify",
            title: t("alertingActionNotify"),
            description: t("alertingActionNotifyDescription"),
            icon: <Bell className="h-5 w-5" />
        },
        {
            id: "webhook",
            title: t("alertingActionWebhook"),
            description: t("alertingActionWebhookDescription"),
            icon: <Globe className="h-5 w-5" />
        },
        ...EXTERNAL_INTEGRATIONS.map((integration) => ({
            id: integration.id,
            title: integration.name,
            description: integration.description,
            icon: (
                <img
                    src={integration.logo}
                    alt={integration.name}
                    className="h-5 w-5 object-contain"
                />
            )
        }))
    ];

    const handleAdd = () => {
        if (!isBuiltInSelected) return;
        onAdd(selected as AlertRuleFormAction["type"]);
        setSelected(null);
        setPopoverOpen(false);
    };

    return (
        <div className="flex flex-col gap-3 items-start">
            <h3 className="font-medium">{t("alertingAddActionHeading")}</h3>
            <Popover open={isPopoverOpen} onOpenChange={setPopoverOpen}>
                <PopoverTrigger asChild>
                    <Button type="button" variant="outline">
                        {t("alertingSelectActionType")}
                        <ChevronRightIcon
                            className={cn(
                                "size-4 transition-transform duration-150",
                                isPopoverOpen && "rotate-90"
                            )}
                        />
                    </Button>
                </PopoverTrigger>
                <PopoverContent className="shadow-md flex flex-col gap-3 w-150">
                    <StrategySelect
                        options={actionTypeOptions}
                        value={selected}
                        cols={2}
                        onChange={(v) => setSelected(v)}
                    />

                    {isPremiumSelected ? (
                        <ContactSalesBanner />
                    ) : (
                        <Button
                            type="button"
                            disabled={!isBuiltInSelected}
                            onClick={handleAdd}
                        >
                            <Plus className="h-4 w-4 mr-1" />
                            {t("alertingAddAction")}
                        </Button>
                    )}
                </PopoverContent>
            </Popover>
        </div>
    );
}

function SiteMultiSelect({
    orgId,
    value,
    onChange
}: {
    orgId: string;
    value: number[];
    onChange: (v: number[]) => void;
}) {
    const t = useTranslations();
    const [open, setOpen] = useState(false);
    const [q, setQ] = useState("");
    const [debounced] = useDebounce(q, 150);
    const { data: sites = [] } = useQuery(
        orgQueries.sites({ orgId, query: debounced, perPage: 500 })
    );
    const toggle = (id: number) => {
        if (value.includes(id)) {
            onChange(value.filter((x) => x !== id));
        } else {
            onChange([...value, id]);
        }
    };
    const summary =
        value.length === 0
            ? t("alertingSelectSites")
            : t("alertingSitesSelected", { count: value.length });
    return (
        <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
                <Button
                    variant="outline"
                    role="combobox"
                    className="w-full justify-between font-normal"
                >
                    <span className="truncate">{summary}</span>
                    <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                </Button>
            </PopoverTrigger>
            <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0">
                <Command shouldFilter={false}>
                    <CommandInput
                        placeholder={t("siteSearch")}
                        value={q}
                        onValueChange={setQ}
                    />
                    <CommandList>
                        <CommandEmpty>{t("siteNotFound")}</CommandEmpty>
                        <CommandGroup>
                            {sites.map((s) => (
                                <CommandItem
                                    key={s.siteId}
                                    value={`${s.siteId}`}
                                    onSelect={() => toggle(s.siteId)}
                                    className="cursor-pointer"
                                >
                                    <Checkbox
                                        checked={value.includes(s.siteId)}
                                        className="mr-2 pointer-events-none"
                                    />
                                    {s.name}
                                </CommandItem>
                            ))}
                        </CommandGroup>
                    </CommandList>
                </Command>
            </PopoverContent>
        </Popover>
    );
}

function HealthCheckMultiSelect({
    orgId,
    value,
    onChange
}: {
    orgId: string;
    value: number[];
    onChange: (v: number[]) => void;
}) {
    const t = useTranslations();
    const [open, setOpen] = useState(false);
    const [q, setQ] = useState("");
    const [debounced] = useDebounce(q, 150);

    const { data: healthChecks = [] } = useQuery(
        orgQueries.healthChecks({ orgId })
    );

    const shown = useMemo(() => {
        const query = debounced.trim().toLowerCase();
        const base = query
            ? healthChecks.filter((hc) => hc.name.toLowerCase().includes(query))
            : healthChecks;
        // Always keep already-selected items visible even if they fall outside the search
        if (query && value.length > 0) {
            const selectedNotInBase = healthChecks.filter(
                (hc) =>
                    value.includes(hc.targetHealthCheckId) &&
                    !base.some(
                        (b) => b.targetHealthCheckId === hc.targetHealthCheckId
                    )
            );
            return [...selectedNotInBase, ...base];
        }
        return base;
    }, [healthChecks, debounced, value]);

    const toggle = (id: number) => {
        if (value.includes(id)) {
            onChange(value.filter((x) => x !== id));
        } else {
            onChange([...value, id]);
        }
    };

    const summary =
        value.length === 0
            ? t("alertingSelectHealthChecks")
            : t("alertingHealthChecksSelected", { count: value.length });

    return (
        <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
                <Button
                    type="button"
                    variant="outline"
                    role="combobox"
                    className="w-full justify-between font-normal"
                >
                    <span className="truncate">{summary}</span>
                    <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                </Button>
            </PopoverTrigger>
            <PopoverContent
                className="w-[var(--radix-popover-trigger-width)] p-0"
                align="start"
            >
                <Command shouldFilter={false}>
                    <CommandInput
                        placeholder={t("alertingSearchHealthChecks")}
                        value={q}
                        onValueChange={setQ}
                    />
                    <CommandList>
                        <CommandEmpty>
                            {t("alertingHealthChecksEmpty")}
                        </CommandEmpty>
                        <CommandGroup>
                            {shown.map((hc) => (
                                <CommandItem
                                    key={hc.targetHealthCheckId}
                                    value={`${hc.targetHealthCheckId}:${hc.name}`}
                                    onSelect={() =>
                                        toggle(hc.targetHealthCheckId)
                                    }
                                    className="cursor-pointer"
                                >
                                    <Checkbox
                                        checked={value.includes(
                                            hc.targetHealthCheckId
                                        )}
                                        className="mr-2 pointer-events-none shrink-0"
                                        aria-hidden
                                        tabIndex={-1}
                                    />
                                    <span className="truncate">{hc.name}</span>
                                </CommandItem>
                            ))}
                        </CommandGroup>
                    </CommandList>
                </Command>
            </PopoverContent>
        </Popover>
    );
}

function ResourceMultiSelect({
    orgId,
    value,
    onChange
}: {
    orgId: string;
    value: number[];
    onChange: (v: number[]) => void;
}) {
    const t = useTranslations();
    const [open, setOpen] = useState(false);
    const [q, setQ] = useState("");
    const [debounced] = useDebounce(q, 150);

    const { data: resources = [] } = useQuery(
        orgQueries.proxyResources({ orgId, query: debounced, perPage: 10 })
    );

    const shown = useMemo(() => {
        return resources;
    }, [resources]);

    const toggle = (id: number) => {
        if (value.includes(id)) {
            onChange(value.filter((x) => x !== id));
        } else {
            onChange([...value, id]);
        }
    };

    const summary =
        value.length === 0
            ? t("alertingSelectResources")
            : t("alertingResourcesSelected", { count: value.length });

    return (
        <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
                <Button
                    type="button"
                    variant="outline"
                    role="combobox"
                    className="w-full justify-between font-normal"
                >
                    <span className="truncate">{summary}</span>
                    <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                </Button>
            </PopoverTrigger>
            <PopoverContent
                className="w-[var(--radix-popover-trigger-width)] p-0"
                align="start"
            >
                <Command shouldFilter={false}>
                    <CommandInput
                        placeholder={t("alertingSelectResources")}
                        value={q}
                        onValueChange={setQ}
                    />
                    <CommandList>
                        <CommandEmpty>
                            {t("alertingResourcesEmpty")}
                        </CommandEmpty>
                        <CommandGroup>
                            {shown.map((r) => (
                                <CommandItem
                                    key={r.resourceId}
                                    value={`${r.resourceId}:${r.name}`}
                                    onSelect={() => toggle(r.resourceId)}
                                    className="cursor-pointer"
                                >
                                    <Checkbox
                                        checked={value.includes(r.resourceId)}
                                        className="mr-2 pointer-events-none shrink-0"
                                        aria-hidden
                                        tabIndex={-1}
                                    />
                                    <span className="truncate">{r.name}</span>
                                </CommandItem>
                            ))}
                        </CommandGroup>
                    </CommandList>
                </Command>
            </PopoverContent>
        </Popover>
    );
}

export function ActionBlock({
    orgId,
    index,
    control,
    form,
    onRemove,
    onUpdate,
    canRemove
}: {
    orgId: string;
    index: number;
    control: Control<AlertRuleFormValues>;
    form: UseFormReturn<AlertRuleFormValues>;
    onRemove: () => void;
    onUpdate: (val: AlertRuleFormAction) => void;
    canRemove: boolean;
}) {
    const t = useTranslations();
    const type = useWatch({ control, name: `actions.${index}.type` });

    const typeHeader =
        type === "notify" ? (
            <div className="flex items-center gap-2 text-sm font-medium">
                <Bell className="h-4 w-4 text-muted-foreground" />
                {t("alertingActionNotify")}
            </div>
        ) : (
            <div className="flex items-center gap-2 text-sm font-medium">
                <Globe className="h-4 w-4 text-muted-foreground" />
                {t("alertingActionWebhook")}
            </div>
        );

    return (
        <div className="relative space-y-3 pr-10 pt-1">
            {canRemove && (
                <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="absolute top-1 right-0 h-8 w-8"
                    onClick={onRemove}
                >
                    <Trash2 className="h-4 w-4 text-destructive" />
                </Button>
            )}
            {typeHeader}
            {type === "notify" && (
                <NotifyActionFields
                    orgId={orgId}
                    index={index}
                    control={control}
                    form={form}
                />
            )}
            {type === "webhook" && (
                <WebhookActionFields
                    index={index}
                    control={control}
                    form={form}
                />
            )}
        </div>
    );
}

function NotifyActionFields({
    orgId,
    index,
    control,
    form
}: {
    orgId: string;
    index: number;
    control: Control<AlertRuleFormValues>;
    form: UseFormReturn<AlertRuleFormValues>;
}) {
    const t = useTranslations();

    const [emailActiveIdx, setEmailActiveIdx] = useState<number | null>(null);

    const { data: orgUsers = [], isLoading: isLoadingUsers } = useQuery(
        orgQueries.users({ orgId })
    );
    const { data: orgRoles = [], isLoading: isLoadingRoles } = useQuery(
        orgQueries.roles({ orgId })
    );

    const allUsers = useMemo(
        () =>
            orgUsers.map((u) => ({
                id: String(u.id),
                text: getUserDisplayName({
                    email: u.email,
                    name: u.name,
                    username: u.username
                })
            })),
        [orgUsers]
    );

    const allRoles = useMemo(
        () => orgRoles.map((r) => ({ id: String(r.roleId), text: r.name })),
        [orgRoles]
    );

    const hasResolvedTagsRef = useRef(false);

    useEffect(() => {
        if (isLoadingUsers || isLoadingRoles) return;
        if (hasResolvedTagsRef.current) return;

        const currentUserTags = form.getValues(
            `actions.${index}.userTags`
        ) as Tag[];
        const currentRoleTags = form.getValues(
            `actions.${index}.roleTags`
        ) as Tag[];

        const resolvedUserTags = currentUserTags.map((tag) => {
            const match = allUsers.find((u) => u.id === tag.id);
            return match ? { id: tag.id, text: match.text } : tag;
        });

        const resolvedRoleTags = currentRoleTags.map((tag) => {
            const match = allRoles.find((r) => r.id === tag.id);
            return match ? { id: tag.id, text: match.text } : tag;
        });

        const userTagsNeedUpdate = resolvedUserTags.some(
            (t, i) => t.text !== currentUserTags[i]?.text
        );
        const roleTagsNeedUpdate = resolvedRoleTags.some(
            (t, i) => t.text !== currentRoleTags[i]?.text
        );

        if (userTagsNeedUpdate) {
            form.setValue(`actions.${index}.userTags`, resolvedUserTags, {
                shouldDirty: false
            });
        }
        if (roleTagsNeedUpdate) {
            form.setValue(`actions.${index}.roleTags`, resolvedRoleTags, {
                shouldDirty: false
            });
        }

        hasResolvedTagsRef.current = true;
    }, [isLoadingUsers, isLoadingRoles, allUsers, allRoles]);

    const emailTags = (useWatch({
        control,
        name: `actions.${index}.emailTags`
    }) ?? []) as Tag[];

    return (
        <div className="space-y-3 pt-1">
            <FormField
                control={control}
                name={`actions.${index}.userTags`}
                render={({ field }) => (
                    <FormItem className="flex flex-col items-start">
                        <FormLabel>{t("alertingNotifyUsers")}</FormLabel>
                        <FormControl>
                            <UsersSelector
                                selectedUsers={field.value ?? []}
                                orgId={orgId}
                                onSelectUsers={(newUsers) => {
                                    form.setValue(
                                        `actions.${index}.userTags`,
                                        newUsers as [Tag, ...Tag[]],
                                        { shouldDirty: true }
                                    );
                                }}
                            />
                        </FormControl>
                        <FormMessage />
                    </FormItem>
                )}
            />
            <FormField
                control={control}
                name={`actions.${index}.roleTags`}
                render={({ field }) => (
                    <FormItem className="flex flex-col items-start">
                        <FormLabel>{t("alertingNotifyRoles")}</FormLabel>
                        <FormControl>
                            <RolesSelector
                                selectedRoles={field.value ?? []}
                                restrictAdminRole
                                orgId={orgId}
                                onSelectRoles={(newUsers) => {
                                    form.setValue(
                                        `actions.${index}.roleTags`,
                                        newUsers as [Tag, ...Tag[]],
                                        { shouldDirty: true }
                                    );
                                }}
                            />
                        </FormControl>
                        <FormMessage />
                    </FormItem>
                )}
            />
            <FormField
                control={control}
                name={`actions.${index}.emailTags`}
                render={({ field }) => (
                    <FormItem className="flex flex-col items-start">
                        <FormLabel>{t("alertingNotifyEmails")}</FormLabel>
                        <FormControl>
                            <TagInput
                                {...field}
                                tags={emailTags}
                                setTags={(updater) => {
                                    const next =
                                        typeof updater === "function"
                                            ? updater(emailTags)
                                            : updater;
                                    form.setValue(
                                        `actions.${index}.emailTags`,
                                        next as Tag[],
                                        { shouldDirty: true }
                                    );
                                }}
                                activeTagIndex={emailActiveIdx}
                                setActiveTagIndex={setEmailActiveIdx}
                                placeholder={t("alertingEmailPlaceholder")}
                                size="sm"
                                allowDuplicates={false}
                                sortTags={true}
                                validateTag={(tag) =>
                                    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(tag)
                                }
                                delimiterList={[",", "Enter"]}
                            />
                        </FormControl>
                        <FormMessage />
                    </FormItem>
                )}
            />
        </div>
    );
}

function WebhookActionFields({
    index,
    control,
    form
}: {
    index: number;
    control: Control<AlertRuleFormValues>;
    form: UseFormReturn<AlertRuleFormValues>;
}) {
    const t = useTranslations();
    return (
        <div className="space-y-3 pt-1">
            <FormField
                control={control}
                name={`actions.${index}.url`}
                render={({ field }) => (
                    <FormItem>
                        <FormLabel>{t("webhookUrlLabel")}</FormLabel>
                        <FormControl>
                            <Input
                                {...field}
                                placeholder="https://example.com/hook"
                            />
                        </FormControl>
                        <FormMessage />
                    </FormItem>
                )}
            />
            <FormField
                control={control}
                name={`actions.${index}.method`}
                render={({ field }) => (
                    <FormItem>
                        <FormLabel>{t("alertingWebhookMethod")}</FormLabel>
                        <Select
                            value={field.value}
                            onValueChange={field.onChange}
                        >
                            <FormControl>
                                <SelectTrigger className="max-w-xs">
                                    <SelectValue />
                                </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                                {["GET", "POST", "PUT", "PATCH"].map((m) => (
                                    <SelectItem key={m} value={m}>
                                        {m}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                        <FormMessage />
                    </FormItem>
                )}
            />
            {/* Authentication */}
            <div className="space-y-3">
                <div>
                    <label className="font-medium text-sm block">
                        {t("httpDestAuthTitle")}
                    </label>
                    <p className="text-xs text-muted-foreground mt-0.5">
                        {t("httpDestAuthDescription")}
                    </p>
                </div>
                <FormField
                    control={control}
                    name={`actions.${index}.authType`}
                    render={({ field }) => (
                        <FormItem>
                            <FormControl>
                                <RadioGroup
                                    value={field.value}
                                    onValueChange={field.onChange}
                                    className="gap-2"
                                >
                                    {/* None */}
                                    <div className="flex items-start gap-3 rounded-md border p-3 transition-colors">
                                        <RadioGroupItem
                                            value="none"
                                            id={`auth-none-${index}`}
                                            className="mt-0.5"
                                        />
                                        <div>
                                            <Label
                                                htmlFor={`auth-none-${index}`}
                                                className="cursor-pointer font-medium"
                                            >
                                                {t("httpDestAuthNoneTitle")}
                                            </Label>
                                            <p className="text-xs text-muted-foreground mt-0.5">
                                                {t(
                                                    "httpDestAuthNoneDescription"
                                                )}
                                            </p>
                                        </div>
                                    </div>

                                    {/* Bearer */}
                                    <div className="flex items-start gap-3 rounded-md border p-3">
                                        <RadioGroupItem
                                            value="bearer"
                                            id={`auth-bearer-${index}`}
                                            className="mt-0.5"
                                        />
                                        <div className="flex-1 space-y-3">
                                            <div>
                                                <Label
                                                    htmlFor={`auth-bearer-${index}`}
                                                    className="cursor-pointer font-medium"
                                                >
                                                    {t(
                                                        "httpDestAuthBearerTitle"
                                                    )}
                                                </Label>
                                                <p className="text-xs text-muted-foreground mt-0.5">
                                                    {t(
                                                        "httpDestAuthBearerDescription"
                                                    )}
                                                </p>
                                            </div>
                                            {field.value === "bearer" && (
                                                <FormField
                                                    control={control}
                                                    name={`actions.${index}.bearerToken`}
                                                    render={({ field: f }) => (
                                                        <FormItem>
                                                            <FormControl>
                                                                <Input
                                                                    {...f}
                                                                    placeholder={t(
                                                                        "httpDestAuthBearerPlaceholder"
                                                                    )}
                                                                />
                                                            </FormControl>
                                                            <FormMessage />
                                                        </FormItem>
                                                    )}
                                                />
                                            )}
                                        </div>
                                    </div>

                                    {/* Basic */}
                                    <div className="flex items-start gap-3 rounded-md border p-3">
                                        <RadioGroupItem
                                            value="basic"
                                            id={`auth-basic-${index}`}
                                            className="mt-0.5"
                                        />
                                        <div className="flex-1 space-y-3">
                                            <div>
                                                <Label
                                                    htmlFor={`auth-basic-${index}`}
                                                    className="cursor-pointer font-medium"
                                                >
                                                    {t(
                                                        "httpDestAuthBasicTitle"
                                                    )}
                                                </Label>
                                                <p className="text-xs text-muted-foreground mt-0.5">
                                                    {t(
                                                        "httpDestAuthBasicDescription"
                                                    )}
                                                </p>
                                            </div>
                                            {field.value === "basic" && (
                                                <FormField
                                                    control={control}
                                                    name={`actions.${index}.basicCredentials`}
                                                    render={({ field: f }) => (
                                                        <FormItem>
                                                            <FormControl>
                                                                <Input
                                                                    {...f}
                                                                    placeholder={t(
                                                                        "httpDestAuthBasicPlaceholder"
                                                                    )}
                                                                />
                                                            </FormControl>
                                                            <FormMessage />
                                                        </FormItem>
                                                    )}
                                                />
                                            )}
                                        </div>
                                    </div>

                                    {/* Custom */}
                                    <div className="flex items-start gap-3 rounded-md border p-3">
                                        <RadioGroupItem
                                            value="custom"
                                            id={`auth-custom-${index}`}
                                            className="mt-0.5"
                                        />
                                        <div className="flex-1 space-y-3">
                                            <div>
                                                <Label
                                                    htmlFor={`auth-custom-${index}`}
                                                    className="cursor-pointer font-medium"
                                                >
                                                    {t(
                                                        "httpDestAuthCustomTitle"
                                                    )}
                                                </Label>
                                                <p className="text-xs text-muted-foreground mt-0.5">
                                                    {t(
                                                        "httpDestAuthCustomDescription"
                                                    )}
                                                </p>
                                            </div>
                                            {field.value === "custom" && (
                                                <div className="flex gap-2">
                                                    <FormField
                                                        control={control}
                                                        name={`actions.${index}.customHeaderName`}
                                                        render={({
                                                            field: f
                                                        }) => (
                                                            <FormItem className="flex-1">
                                                                <FormControl>
                                                                    <Input
                                                                        {...f}
                                                                        placeholder={t(
                                                                            "httpDestAuthCustomHeaderNamePlaceholder"
                                                                        )}
                                                                    />
                                                                </FormControl>
                                                                <FormMessage />
                                                            </FormItem>
                                                        )}
                                                    />
                                                    <FormField
                                                        control={control}
                                                        name={`actions.${index}.customHeaderValue`}
                                                        render={({
                                                            field: f
                                                        }) => (
                                                            <FormItem className="flex-1">
                                                                <FormControl>
                                                                    <Input
                                                                        {...f}
                                                                        placeholder={t(
                                                                            "httpDestAuthCustomHeaderValuePlaceholder"
                                                                        )}
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
                                </RadioGroup>
                            </FormControl>
                            <FormMessage />
                        </FormItem>
                    )}
                />
            </div>
            <WebhookHeadersField index={index} control={control} form={form} />
            {/* Body Template */}
            <div className="space-y-3">
                <div>
                    <label className="font-medium text-sm block">
                        {t("httpDestBodyTemplateTitle")}
                    </label>
                    <p className="text-xs text-muted-foreground mt-0.5">
                        {t("httpDestBodyTemplateDescription")}
                    </p>
                </div>
                <FormField
                    control={control}
                    name={`actions.${index}.useBodyTemplate`}
                    render={({ field }) => (
                        <FormItem>
                            <div className="flex items-center gap-3">
                                <FormControl>
                                    <Switch
                                        id={`body-template-${index}`}
                                        checked={field.value}
                                        onCheckedChange={field.onChange}
                                    />
                                </FormControl>
                                <Label
                                    htmlFor={`body-template-${index}`}
                                    className="cursor-pointer"
                                >
                                    {t("httpDestEnableBodyTemplate")}
                                </Label>
                            </div>
                        </FormItem>
                    )}
                />
                {useWatch({
                    control,
                    name: `actions.${index}.useBodyTemplate`
                }) && (
                    <FormField
                        control={control}
                        name={`actions.${index}.bodyTemplate`}
                        render={({ field }) => (
                            <FormItem>
                                <FormLabel>
                                    {t("httpDestBodyTemplateLabel")}
                                </FormLabel>
                                <FormControl>
                                    <Textarea
                                        {...field}
                                        placeholder={
                                            '{\n  "event": "{{event}}",\n  "timestamp": "{{timestamp}}",\n  "status": "{{status}}",\n  "data": {{data}}\n}'
                                        }
                                        className="font-mono text-xs min-h-45 resize-y"
                                    />
                                </FormControl>
                                <FormDescription>
                                    {t("httpDestBodyTemplateHint")}
                                </FormDescription>
                                <FormMessage />
                            </FormItem>
                        )}
                    />
                )}
            </div>
        </div>
    );
}

function WebhookHeadersField({
    index,
    control,
    form
}: {
    index: number;
    control: Control<AlertRuleFormValues>;
    form: UseFormReturn<AlertRuleFormValues>;
}) {
    const t = useTranslations();
    const headers =
        useWatch({ control, name: `actions.${index}.headers` as const }) ?? [];
    return (
        <div className="space-y-2">
            <FormLabel>{t("alertingWebhookHeaders")}</FormLabel>
            {headers.map((_, hi) => (
                <div key={hi} className="flex gap-2 items-start">
                    <FormField
                        control={control}
                        name={`actions.${index}.headers.${hi}.key`}
                        render={({ field }) => (
                            <FormItem className="flex-1">
                                <FormControl>
                                    <Input
                                        {...field}
                                        placeholder={t(
                                            "webhookHeaderKeyPlaceholder"
                                        )}
                                    />
                                </FormControl>
                            </FormItem>
                        )}
                    />
                    <FormField
                        control={control}
                        name={`actions.${index}.headers.${hi}.value`}
                        render={({ field }) => (
                            <FormItem className="flex-1">
                                <FormControl>
                                    <Input
                                        {...field}
                                        placeholder={t(
                                            "webhookHeaderValuePlaceholder"
                                        )}
                                    />
                                </FormControl>
                            </FormItem>
                        )}
                    />
                    <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="shrink-0"
                        onClick={() => {
                            const cur =
                                form.getValues(`actions.${index}.headers`) ??
                                [];
                            form.setValue(
                                `actions.${index}.headers`,
                                cur.filter((__, i) => i !== hi),
                                { shouldDirty: true }
                            );
                        }}
                    >
                        <Trash2 className="h-4 w-4" />
                    </Button>
                </div>
            ))}
            <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                    const cur =
                        form.getValues(`actions.${index}.headers`) ?? [];
                    form.setValue(
                        `actions.${index}.headers`,
                        [...cur, { key: "", value: "" }],
                        { shouldDirty: true }
                    );
                }}
            >
                <Plus className="h-4 w-4 mr-1" />
                {t("alertingAddHeader")}
            </Button>
        </div>
    );
}

export function AlertRuleSourceFields({
    orgId,
    control
}: {
    orgId: string;
    control: Control<AlertRuleFormValues>;
}) {
    const t = useTranslations();
    const { setValue, getValues } = useFormContext<AlertRuleFormValues>();
    const sourceType = useWatch({ control, name: "sourceType" });
    const allSites = useWatch({ control, name: "allSites" });
    const allHealthChecks = useWatch({ control, name: "allHealthChecks" });
    const allResources = useWatch({ control, name: "allResources" });

    const siteStrategyOptions = useMemo(
        () => [
            {
                id: "all" as const,
                title: t("alertingAllSites"),
                description: t("alertingAllSitesDescription")
            },
            {
                id: "specific" as const,
                title: t("alertingSpecificSites"),
                description: t("alertingSpecificSitesDescription")
            }
        ],
        [t]
    );

    const healthCheckStrategyOptions = useMemo(
        () => [
            {
                id: "all" as const,
                title: t("alertingAllHealthChecks"),
                description: t("alertingAllHealthChecksDescription")
            },
            {
                id: "specific" as const,
                title: t("alertingSpecificHealthChecks"),
                description: t("alertingSpecificHealthChecksDescription")
            }
        ],
        [t]
    );

    const resourceStrategyOptions = useMemo(
        () => [
            {
                id: "all" as const,
                title: t("alertingAllResources"),
                description: t("alertingAllResourcesDescription")
            },
            {
                id: "specific" as const,
                title: t("alertingSpecificResources"),
                description: t("alertingSpecificResourcesDescription")
            }
        ],
        [t]
    );

    return (
        <div className="space-y-4">
            <FormField
                control={control}
                name="sourceType"
                render={({ field }) => (
                    <FormItem>
                        <FormLabel>{t("alertingSourceType")}</FormLabel>
                        <Select
                            value={field.value}
                            onValueChange={(v) => {
                                const next =
                                    v as AlertRuleFormValues["sourceType"];
                                field.onChange(next);
                                const curTrigger = getValues("trigger");
                                if (next === "site") {
                                    if (
                                        curTrigger !== "site_online" &&
                                        curTrigger !== "site_offline" &&
                                        curTrigger !== "site_toggle"
                                    ) {
                                        setValue("trigger", "site_toggle", {
                                            shouldValidate: true
                                        });
                                    }
                                } else if (next === "resource") {
                                    if (
                                        curTrigger !== "resource_healthy" &&
                                        curTrigger !== "resource_unhealthy" &&
                                        curTrigger !== "resource_degraded" &&
                                        curTrigger !== "resource_toggle"
                                    ) {
                                        setValue("trigger", "resource_toggle", {
                                            shouldValidate: true
                                        });
                                    }
                                } else if (
                                    curTrigger !== "health_check_healthy" &&
                                    curTrigger !== "health_check_unhealthy" &&
                                    curTrigger !== "health_check_toggle"
                                ) {
                                    setValue("trigger", "health_check_toggle", {
                                        shouldValidate: true
                                    });
                                }
                            }}
                        >
                            <FormControl>
                                <SelectTrigger>
                                    <SelectValue />
                                </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                                <SelectItem value="site">
                                    {t("alertingSourceSite")}
                                </SelectItem>
                                <SelectItem value="health_check">
                                    {t("alertingSourceHealthCheck")}
                                </SelectItem>
                                <SelectItem value="resource">
                                    {t("alertingSourceResource")}
                                </SelectItem>
                            </SelectContent>
                        </Select>
                        <FormMessage />
                    </FormItem>
                )}
            />
            {sourceType === "site" ? (
                <>
                    <FormField
                        control={control}
                        name="allSites"
                        shouldUnregister={false}
                        render={({ field }) => (
                            <FormItem>
                                <StrategySelect
                                    options={siteStrategyOptions}
                                    value={field.value ? "all" : "specific"}
                                    onChange={(v) => {
                                        field.onChange(v === "all");
                                        if (v === "all") {
                                            setValue("siteIds", []);
                                        }
                                    }}
                                    cols={2}
                                />
                                <FormMessage />
                            </FormItem>
                        )}
                    />
                    {!allSites && (
                        <FormField
                            control={control}
                            name="siteIds"
                            render={({ field }) => (
                                <FormItem>
                                    <FormLabel>
                                        {t("alertingPickSites")}
                                    </FormLabel>
                                    <SiteMultiSelect
                                        orgId={orgId}
                                        value={field.value}
                                        onChange={field.onChange}
                                    />
                                    <FormMessage />
                                </FormItem>
                            )}
                        />
                    )}
                </>
            ) : sourceType === "resource" ? (
                <>
                    <FormField
                        control={control}
                        name="allResources"
                        shouldUnregister={false}
                        render={({ field }) => (
                            <FormItem>
                                <StrategySelect
                                    options={resourceStrategyOptions}
                                    value={field.value ? "all" : "specific"}
                                    onChange={(v) => {
                                        field.onChange(v === "all");
                                        if (v === "all") {
                                            setValue("resourceIds", []);
                                        }
                                    }}
                                    cols={2}
                                />
                                <FormMessage />
                            </FormItem>
                        )}
                    />
                    {!allResources && (
                        <FormField
                            control={control}
                            name="resourceIds"
                            render={({ field }) => (
                                <FormItem>
                                    <FormLabel>
                                        {t("alertingPickResources")}
                                    </FormLabel>
                                    <ResourceMultiSelect
                                        orgId={orgId}
                                        value={field.value}
                                        onChange={field.onChange}
                                    />
                                    <FormMessage />
                                </FormItem>
                            )}
                        />
                    )}
                </>
            ) : (
                <>
                    <FormField
                        control={control}
                        name="allHealthChecks"
                        shouldUnregister={false}
                        render={({ field }) => (
                            <FormItem>
                                <StrategySelect
                                    options={healthCheckStrategyOptions}
                                    value={field.value ? "all" : "specific"}
                                    onChange={(v) => {
                                        field.onChange(v === "all");
                                        if (v === "all") {
                                            setValue("healthCheckIds", []);
                                        }
                                    }}
                                    cols={2}
                                />
                                <FormMessage />
                            </FormItem>
                        )}
                    />
                    {!allHealthChecks && (
                        <FormField
                            control={control}
                            name="healthCheckIds"
                            render={({ field }) => (
                                <FormItem>
                                    <FormLabel>
                                        {t("alertingPickHealthChecks")}
                                    </FormLabel>
                                    <HealthCheckMultiSelect
                                        orgId={orgId}
                                        value={field.value}
                                        onChange={field.onChange}
                                    />
                                    <FormMessage />
                                </FormItem>
                            )}
                        />
                    )}
                </>
            )}
        </div>
    );
}

export function AlertRuleTriggerFields({
    control
}: {
    control: Control<AlertRuleFormValues>;
}) {
    const t = useTranslations();
    const sourceType = useWatch({ control, name: "sourceType" });
    return (
        <FormField
            control={control}
            name="trigger"
            render={({ field }) => (
                <FormItem>
                    <FormLabel>{t("alertingTrigger")}</FormLabel>
                    <Select
                        key={sourceType}
                        value={field.value}
                        onValueChange={field.onChange}
                    >
                        <FormControl>
                            <SelectTrigger>
                                <SelectValue />
                            </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                            {sourceType === "site" ? (
                                <>
                                    <SelectItem value="site_toggle">
                                        {t("alertingTriggerSiteToggle")}
                                    </SelectItem>
                                    <SelectItem value="site_online">
                                        {t("alertingTriggerSiteOnline")}
                                    </SelectItem>
                                    <SelectItem value="site_offline">
                                        {t("alertingTriggerSiteOffline")}
                                    </SelectItem>
                                </>
                            ) : sourceType === "resource" ? (
                                <>
                                    <SelectItem value="resource_toggle">
                                        {t("alertingTriggerResourceToggle")}
                                    </SelectItem>
                                    <SelectItem value="resource_healthy">
                                        {t("alertingTriggerResourceHealthy")}
                                    </SelectItem>
                                    <SelectItem value="resource_unhealthy">
                                        {t("alertingTriggerResourceUnhealthy")}
                                    </SelectItem>
                                    <SelectItem value="resource_degraded">
                                        {t("alertingTriggerResourceDegraded")}
                                    </SelectItem>
                                </>
                            ) : (
                                <>
                                    <SelectItem value="health_check_toggle">
                                        {t("alertingTriggerHcToggle")}
                                    </SelectItem>
                                    <SelectItem value="health_check_healthy">
                                        {t("alertingTriggerHcHealthy")}
                                    </SelectItem>
                                    <SelectItem value="health_check_unhealthy">
                                        {t("alertingTriggerHcUnhealthy")}
                                    </SelectItem>
                                </>
                            )}
                        </SelectContent>
                    </Select>
                    <FormMessage />
                </FormItem>
            )}
        />
    );
}
