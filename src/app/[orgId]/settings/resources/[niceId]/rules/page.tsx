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
import { AxiosResponse } from "axios";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
    Form,
    FormControl,
    FormField,
    FormItem,
    FormLabel,
    FormMessage
} from "@app/components/ui/form";
import {
    ColumnDef,
    getFilteredRowModel,
    getSortedRowModel,
    getPaginationRowModel,
    getCoreRowModel,
    useReactTable,
    flexRender
} from "@tanstack/react-table";
import {
    Table,
    TableBody,
    TableCaption,
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
import {
    SettingsContainer,
    SettingsSection,
    SettingsSectionHeader,
    SettingsSectionTitle,
    SettingsSectionDescription,
    SettingsSectionBody,
    SettingsSectionFooter
} from "@app/components/Settings";
import { ListResourceRulesResponse } from "@server/routers/resource/listResourceRules";
import { SwitchInput } from "@app/components/SwitchInput";
import { Alert, AlertDescription, AlertTitle } from "@app/components/ui/alert";
import { ArrowUpDown, Check, InfoIcon, X, ChevronsUpDown } from "lucide-react";
import {
    InfoSection,
    InfoSections,
    InfoSectionTitle
} from "@app/components/InfoSection";
import { InfoPopup } from "@app/components/ui/info-popup";
import {
    isValidCIDR,
    isValidIP,
    isValidUrlGlobPattern
} from "@server/lib/validators";
import { Switch } from "@app/components/ui/switch";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { COUNTRIES } from "@server/db/countries";
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

// Schema for rule validation
const addRuleSchema = z.object({
    action: z.enum(["ACCEPT", "DROP", "PASS"]),
    match: z.string(),
    value: z.string(),
    priority: z.coerce.number().int().optional()
});

type LocalRule = ArrayElement<ListResourceRulesResponse["rules"]> & {
    new?: boolean;
    updated?: boolean;
};

export default function ResourceRules(props: {
    params: Promise<{ resourceId: number }>;
}) {
    const params = use(props.params);
    const { resource, updateResource } = useResourceContext();
    const api = createApiClient(useEnvContext());
    const [rules, setRules] = useState<LocalRule[]>([]);
    const [rulesToRemove, setRulesToRemove] = useState<number[]>([]);
    const [loading, setLoading] = useState(false);
    const [pageLoading, setPageLoading] = useState(true);
    const [rulesEnabled, setRulesEnabled] = useState(resource.applyRules);
    const [openCountrySelect, setOpenCountrySelect] = useState(false);
    const [countrySelectValue, setCountrySelectValue] = useState("");
    const [openAddRuleCountrySelect, setOpenAddRuleCountrySelect] = useState(false);
    const router = useRouter();
    const t = useTranslations();
    const { env } = useEnvContext();
    const isMaxmindAvailable = env.server.maxmind_db_path && env.server.maxmind_db_path.length > 0;

    const RuleAction = {
        ACCEPT: t('alwaysAllow'),
        DROP: t('alwaysDeny'),
        PASS: t('passToAuth')
    } as const;

    const RuleMatch = {
        PATH: t('path'),
        IP: "IP",
        CIDR: t('ipAddressRange'),
        COUNTRY: t('country')
    } as const;

    const addRuleForm = useForm({
        resolver: zodResolver(addRuleSchema),
        defaultValues: {
            action: "ACCEPT",
            match: "IP",
            value: ""
        }
    });

    useEffect(() => {
        const fetchRules = async () => {
            try {
                const res = await api.get<
                    AxiosResponse<ListResourceRulesResponse>
                >(`/resource/${resource.resourceId}/rules`);
                if (res.status === 200) {
                    setRules(res.data.data.rules);
                }
            } catch (err) {
                console.error(err);
                toast({
                    variant: "destructive",
                    title: t('rulesErrorFetch'),
                    description: formatAxiosError(
                        err,
                        t('rulesErrorFetchDescription')
                    )
                });
            } finally {
                setPageLoading(false);
            }
        };
        fetchRules();
    }, []);

    async function addRule(data: z.infer<typeof addRuleSchema>) {
        const isDuplicate = rules.some(
            (rule) =>
                rule.action === data.action &&
                rule.match === data.match &&
                rule.value === data.value
        );

        if (isDuplicate) {
            toast({
                variant: "destructive",
                title: t('rulesErrorDuplicate'),
                description: t('rulesErrorDuplicateDescription')
            });
            return;
        }

        if (data.match === "CIDR" && !isValidCIDR(data.value)) {
            toast({
                variant: "destructive",
                title: t('rulesErrorInvalidIpAddressRange'),
                description: t('rulesErrorInvalidIpAddressRangeDescription')
            });
            setLoading(false);
            return;
        }
        if (data.match === "PATH" && !isValidUrlGlobPattern(data.value)) {
            toast({
                variant: "destructive",
                title: t('rulesErrorInvalidUrl'),
                description: t('rulesErrorInvalidUrlDescription')
            });
            setLoading(false);
            return;
        }
        if (data.match === "IP" && !isValidIP(data.value)) {
            toast({
                variant: "destructive",
                title: t('rulesErrorInvalidIpAddress'),
                description: t('rulesErrorInvalidIpAddressDescription')
            });
            setLoading(false);
            return;
        }
        if (data.match === "COUNTRY" && !COUNTRIES.some(c => c.code === data.value)) {
            toast({
                variant: "destructive",
                title: t('rulesErrorInvalidCountry'),
                description: t('rulesErrorInvalidCountryDescription') || "Invalid country code."
            });
            setLoading(false);
            return;
        }

        // find the highest priority and add one
        let priority = data.priority;
        if (priority === undefined) {
            priority = rules.reduce(
                (acc, rule) => (rule.priority > acc ? rule.priority : acc),
                0
            );
            priority++;
        }

        const newRule: LocalRule = {
            ...data,
            ruleId: new Date().getTime(),
            new: true,
            resourceId: resource.resourceId,
            priority,
            enabled: true
        };

        setRules([...rules, newRule]);
        addRuleForm.reset();
    }

    const removeRule = (ruleId: number) => {
        setRules([...rules.filter((rule) => rule.ruleId !== ruleId)]);
        if (!rules.find((rule) => rule.ruleId === ruleId)?.new) {
            setRulesToRemove([...rulesToRemove, ruleId]);
        }
    };

    async function updateRule(ruleId: number, data: Partial<LocalRule>) {
        setRules(
            rules.map((rule) =>
                rule.ruleId === ruleId
                    ? { ...rule, ...data, updated: true }
                    : rule
            )
        );
    }

    function getValueHelpText(type: string) {
        switch (type) {
            case "CIDR":
                return t('rulesMatchIpAddressRangeDescription');
            case "IP":
                return t('rulesMatchIpAddress');
            case "PATH":
                return t('rulesMatchUrl');
            case "COUNTRY":
                return t('rulesMatchCountry');
        }
    }

    async function saveAllSettings() {
        try {
            setLoading(true);

            // Save rules enabled state
            const res = await api
                .post(`/resource/${resource.resourceId}`, {
                    applyRules: rulesEnabled
                })
                .catch((err) => {
                    console.error(err);
                    toast({
                        variant: "destructive",
                        title: t('rulesErrorUpdate'),
                        description: formatAxiosError(
                            err,
                            t('rulesErrorUpdateDescription')
                        )
                    });
                    throw err;
                });

            if (res && res.status === 200) {
                updateResource({ applyRules: rulesEnabled });
            }

            // Save rules
            for (const rule of rules) {
                const data = {
                    action: rule.action,
                    match: rule.match,
                    value: rule.value,
                    priority: rule.priority,
                    enabled: rule.enabled
                };

                if (rule.match === "CIDR" && !isValidCIDR(rule.value)) {
                    toast({
                        variant: "destructive",
                        title: t('rulesErrorInvalidIpAddressRange'),
                        description: t('rulesErrorInvalidIpAddressRangeDescription')
                    });
                    setLoading(false);
                    return;
                }
                if (
                    rule.match === "PATH" &&
                    !isValidUrlGlobPattern(rule.value)
                ) {
                    toast({
                        variant: "destructive",
                        title: t('rulesErrorInvalidUrl'),
                        description: t('rulesErrorInvalidUrlDescription')
                    });
                    setLoading(false);
                    return;
                }
                if (rule.match === "IP" && !isValidIP(rule.value)) {
                    toast({
                        variant: "destructive",
                        title: t('rulesErrorInvalidIpAddress'),
                        description: t('rulesErrorInvalidIpAddressDescription')
                    });
                    setLoading(false);
                    return;
                }

                if (rule.priority === undefined) {
                    toast({
                        variant: "destructive",
                        title: t('rulesErrorInvalidPriority'),
                        description: t('rulesErrorInvalidPriorityDescription')
                    });
                    setLoading(false);
                    return;
                }

                // make sure no duplicate priorities
                const priorities = rules.map((r) => r.priority);
                if (priorities.length !== new Set(priorities).size) {
                    toast({
                        variant: "destructive",
                        title: t('rulesErrorDuplicatePriority'),
                        description: t('rulesErrorDuplicatePriorityDescription')
                    });
                    setLoading(false);
                    return;
                }

                if (rule.new) {
                    const res = await api.put(
                        `/resource/${resource.resourceId}/rule`,
                        data
                    );
                    rule.ruleId = res.data.data.ruleId;
                } else if (rule.updated) {
                    await api.post(
                        `/resource/${resource.resourceId}/rule/${rule.ruleId}`,
                        data
                    );
                }

                setRules([
                    ...rules.map((r) => {
                        const res = {
                            ...r,
                            new: false,
                            updated: false
                        };
                        return res;
                    })
                ]);
            }

            for (const ruleId of rulesToRemove) {
                await api.delete(
                    `/resource/${resource.resourceId}/rule/${ruleId}`
                );
                setRules(rules.filter((r) => r.ruleId !== ruleId));
            }

            toast({
                title: t('ruleUpdated'),
                description: t('ruleUpdatedDescription')
            });

            setRulesToRemove([]);
            router.refresh();
        } catch (err) {
            console.error(err);
            toast({
                variant: "destructive",
                title: t('ruleErrorUpdate'),
                description: formatAxiosError(
                    err,
                    t('ruleErrorUpdateDescription')
                )
            });
        }
        setLoading(false);
    }

    const columns: ColumnDef<LocalRule>[] = [
        {
            accessorKey: "priority",
            header: ({ column }) => {
                return (
                    <Button
                        variant="ghost"
                        onClick={() =>
                            column.toggleSorting(column.getIsSorted() === "asc")
                        }
                    >
                        {t('rulesPriority')}
                        <ArrowUpDown className="ml-2 h-4 w-4" />
                    </Button>
                );
            },
            cell: ({ row }) => (
                <Input
                    defaultValue={row.original.priority}
                    className="w-[75px]"
                    type="number"
                    onClick={(e) => e.currentTarget.focus()}
                    onBlur={(e) => {
                        const parsed = z.coerce
                            .number()
                            .int()
                            .optional()
                            .safeParse(e.target.value);

                        if (!parsed.data) {
                            toast({
                                variant: "destructive",
                                title: t('rulesErrorInvalidIpAddress'), // correct priority or IP?
                                description: t('rulesErrorInvalidPriorityDescription')
                            });
                            setLoading(false);
                            return;
                        }

                        updateRule(row.original.ruleId, {
                            priority: parsed.data
                        });
                    }}
                />
            )
        },
        {
            accessorKey: "action",
            header: t('rulesAction'),
            cell: ({ row }) => (
                <Select
                    defaultValue={row.original.action}
                    onValueChange={(value: "ACCEPT" | "DROP" | "PASS") =>
                        updateRule(row.original.ruleId, { action: value })
                    }
                >
                    <SelectTrigger className="min-w-[150px]">
                        <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="ACCEPT">
                            {RuleAction.ACCEPT}
                        </SelectItem>
                        <SelectItem value="DROP">{RuleAction.DROP}</SelectItem>
                        <SelectItem value="PASS">{RuleAction.PASS}</SelectItem>
                    </SelectContent>
                </Select>
            )
        },
        {
            accessorKey: "match",
            header: t('rulesMatchType'),
            cell: ({ row }) => (
                <Select
                    defaultValue={row.original.match}
                    onValueChange={(value: "CIDR" | "IP" | "PATH" | "COUNTRY") =>
                        updateRule(row.original.ruleId, { match: value, value: value === "COUNTRY" ? "US" : row.original.value })
                    }
                >
                    <SelectTrigger className="min-w-[125px]">
                        <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="PATH">{RuleMatch.PATH}</SelectItem>
                        <SelectItem value="IP">{RuleMatch.IP}</SelectItem>
                        <SelectItem value="CIDR">{RuleMatch.CIDR}</SelectItem>
                        {isMaxmindAvailable && (
                            <SelectItem value="COUNTRY">{RuleMatch.COUNTRY}</SelectItem>
                        )}
                    </SelectContent>
                </Select>
            )
        },
        {
            accessorKey: "value",
            header: t('value'),
            cell: ({ row }) => (
                row.original.match === "COUNTRY" ? (
                    <Popover>
                        <PopoverTrigger asChild>
                            <Button
                                variant="outline"
                                role="combobox"
                                className="min-w-[200px] justify-between"
                            >
                                {row.original.value
                                    ? COUNTRIES.find((country) => country.code === row.original.value)?.name +
                                      " (" + row.original.value + ")"
                                    : t('selectCountry')}
                                <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                            </Button>
                        </PopoverTrigger>
                        <PopoverContent className="min-w-[200px] p-0">
                            <Command>
                                <CommandInput placeholder={t('searchCountries')} />
                                <CommandList>
                                    <CommandEmpty>{t('noCountryFound')}</CommandEmpty>
                                    <CommandGroup>
                                        {COUNTRIES.map((country) => (
                                            <CommandItem
                                                key={country.code}
                                                value={country.name}
                                                onSelect={() => {
                                                    updateRule(row.original.ruleId, { value: country.code });
                                                }}
                                            >
                                                <Check
                                                    className={`mr-2 h-4 w-4 ${
                                                        row.original.value === country.code
                                                            ? "opacity-100"
                                                            : "opacity-0"
                                                    }`}
                                                />
                                                {country.name} ({country.code})
                                            </CommandItem>
                                        ))}
                                    </CommandGroup>
                                </CommandList>
                            </Command>
                        </PopoverContent>
                    </Popover>
                ) : (
                    <Input
                        defaultValue={row.original.value}
                        className="min-w-[200px]"
                        onBlur={(e) =>
                            updateRule(row.original.ruleId, {
                                value: e.target.value
                            })
                        }
                    />
                )
            )
        },
        {
            accessorKey: "enabled",
            header: t('enabled'),
            cell: ({ row }) => (
                <Switch
                    defaultChecked={row.original.enabled}
                    onCheckedChange={(val) =>
                        updateRule(row.original.ruleId, { enabled: val })
                    }
                />
            )
        },
        {
            id: "actions",
            cell: ({ row }) => (
                <div className="flex items-center justify-end space-x-2">
                    <Button
                        variant="outline"
                        onClick={() => removeRule(row.original.ruleId)}
                    >
                        {t('delete')}
                    </Button>
                </div>
            )
        }
    ];

    const table = useReactTable({
        data: rules,
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
            {/* <Alert className="hidden md:block"> */}
            {/*     <InfoIcon className="h-4 w-4" /> */}
            {/*     <AlertTitle className="font-semibold">{t('rulesAbout')}</AlertTitle> */}
            {/*     <AlertDescription className="mt-4"> */}
            {/*         <div className="space-y-1 mb-4"> */}
            {/*             <p> */}
            {/*                 {t('rulesAboutDescription')} */}
            {/*             </p> */}
            {/*         </div> */}
            {/*         <InfoSections cols={2}> */}
            {/*             <InfoSection> */}
            {/*                 <InfoSectionTitle>{t('rulesActions')}</InfoSectionTitle> */}
            {/*                 <ul className="text-sm text-muted-foreground space-y-1"> */}
            {/*                     <li className="flex items-center gap-2"> */}
            {/*                         <Check className="text-green-500 w-4 h-4" /> */}
            {/*                         {t('rulesActionAlwaysAllow')} */}
            {/*                     </li> */}
            {/*                     <li className="flex items-center gap-2"> */}
            {/*                         <X className="text-red-500 w-4 h-4" /> */}
            {/*                         {t('rulesActionAlwaysDeny')} */}
            {/*                     </li> */}
            {/*                 </ul> */}
            {/*             </InfoSection> */}
            {/*             <InfoSection> */}
            {/*                 <InfoSectionTitle> */}
            {/*                     {t('rulesMatchCriteria')} */}
            {/*                 </InfoSectionTitle> */}
            {/*                 <ul className="text-sm text-muted-foreground space-y-1"> */}
            {/*                     <li className="flex items-center gap-2"> */}
            {/*                         {t('rulesMatchCriteriaIpAddress')} */}
            {/*                     </li> */}
            {/*                     <li className="flex items-center gap-2"> */}
            {/*                         {t('rulesMatchCriteriaIpAddressRange')} */}
            {/*                     </li> */}
            {/*                     <li className="flex items-center gap-2"> */}
            {/*                         {t('rulesMatchCriteriaUrl')} */}
            {/*                     </li> */}
            {/*                 </ul> */}
            {/*             </InfoSection> */}
            {/*         </InfoSections> */}
            {/*     </AlertDescription> */}
            {/* </Alert> */}

            <SettingsSection>
                <SettingsSectionHeader>
                    <SettingsSectionTitle>
                        {t('rulesResource')}
                    </SettingsSectionTitle>
                    <SettingsSectionDescription>
                        {t('rulesResourceDescription')}
                    </SettingsSectionDescription>
                </SettingsSectionHeader>
                <SettingsSectionBody>
                    <div className="space-y-6">
                        <div className="flex items-center space-x-2">
                            <SwitchInput
                                id="rules-toggle"
                                label={t('rulesEnable')}
                                defaultChecked={rulesEnabled}
                                onCheckedChange={(val) => setRulesEnabled(val)}
                            />
                        </div>

                        <Form {...addRuleForm}>
                            <form
                                onSubmit={addRuleForm.handleSubmit(addRule)}
                                className="space-y-4"
                            >
                                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 items-end">
                                    <FormField
                                        control={addRuleForm.control}
                                        name="action"
                                        render={({ field }) => (
                                            <FormItem>
                                                <FormLabel>{t('rulesAction')}</FormLabel>
                                                <FormControl>
                                                    <Select
                                                        value={field.value}
                                                        onValueChange={
                                                            field.onChange
                                                        }
                                                    >
                                                        <SelectTrigger className="w-full">
                                                            <SelectValue />
                                                        </SelectTrigger>
                                                        <SelectContent>
                                                            <SelectItem value="ACCEPT">
                                                                {RuleAction.ACCEPT}
                                                            </SelectItem>
                                                            <SelectItem value="DROP">
                                                                {RuleAction.DROP}
                                                            </SelectItem>
                                                            <SelectItem value="PASS">
                                                                {RuleAction.PASS}
                                                            </SelectItem>
                                                        </SelectContent>
                                                    </Select>
                                                </FormControl>
                                                <FormMessage />
                                            </FormItem>
                                        )}
                                    />
                                    <FormField
                                        control={addRuleForm.control}
                                        name="match"
                                        render={({ field }) => (
                                            <FormItem>
                                                <FormLabel>{t('rulesMatchType')}</FormLabel>
                                                <FormControl>
                                                    <Select
                                                        value={field.value}
                                                        onValueChange={field.onChange}
                                                    >
                                                        <SelectTrigger className="w-full">
                                                            <SelectValue />
                                                        </SelectTrigger>
                                                        <SelectContent>
                                                            {resource.http && (
                                                                <SelectItem value="PATH">
                                                                    {RuleMatch.PATH}
                                                                </SelectItem>
                                                            )}
                                                            <SelectItem value="IP">
                                                                {RuleMatch.IP}
                                                            </SelectItem>
                                                            <SelectItem value="CIDR">
                                                                {RuleMatch.CIDR}
                                                            </SelectItem>
                                                            {isMaxmindAvailable && (
                                                                <SelectItem value="COUNTRY">
                                                                    {RuleMatch.COUNTRY}
                                                                </SelectItem>
                                                            )}
                                                        </SelectContent>
                                                    </Select>
                                                </FormControl>
                                                <FormMessage />
                                            </FormItem>
                                        )}
                                    />
                                    <FormField
                                        control={addRuleForm.control}
                                        name="value"
                                        render={({ field }) => (
                                            <FormItem className="gap-1">
                                                <InfoPopup
                                                    text={t('value')}
                                                    info={
                                                        getValueHelpText(
                                                            addRuleForm.watch(
                                                                "match"
                                                            )
                                                        ) || ""
                                                    }
                                                />
                                                <FormControl>
                                                    {addRuleForm.watch("match") === "COUNTRY" ? (
                                                        <Popover open={openAddRuleCountrySelect} onOpenChange={setOpenAddRuleCountrySelect}>
                                                            <PopoverTrigger asChild>
                                                                <Button
                                                                    variant="outline"
                                                                    role="combobox"
                                                                    aria-expanded={openAddRuleCountrySelect}
                                                                    className="w-full justify-between"
                                                                >
                                                                    {field.value
                                                                        ? COUNTRIES.find((country) => country.code === field.value)?.name +
                                                                          " (" + field.value + ")"
                                                                        : t('selectCountry')}
                                                                    <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                                                                </Button>
                                                            </PopoverTrigger>
                                                            <PopoverContent className="w-full p-0">
                                                                <Command>
                                                                    <CommandInput placeholder={t('searchCountries')} />
                                                                    <CommandList>
                                                                        <CommandEmpty>{t('noCountryFound')}</CommandEmpty>
                                                                        <CommandGroup>
                                                                            {COUNTRIES.map((country) => (
                                                                                <CommandItem
                                                                                    key={country.code}
                                                                                    value={country.name}
                                                                                    onSelect={() => {
                                                                                        field.onChange(country.code);
                                                                                        setOpenAddRuleCountrySelect(false);
                                                                                    }}
                                                                                >
                                                                                    <Check
                                                                                        className={`mr-2 h-4 w-4 ${
                                                                                            field.value === country.code
                                                                                                ? "opacity-100"
                                                                                                : "opacity-0"
                                                                                        }`}
                                                                                    />
                                                                                    {country.name} ({country.code})
                                                                                </CommandItem>
                                                                            ))}
                                                                        </CommandGroup>
                                                                    </CommandList>
                                                                </Command>
                                                            </PopoverContent>
                                                        </Popover>
                                                    ) : (
                                                        <Input {...field} />
                                                    )}
                                                </FormControl>
                                                <FormMessage />
                                            </FormItem>
                                        )}
                                    />
                                    <Button
                                        type="submit"
                                        variant="secondary"
                                        disabled={!rulesEnabled}
                                    >
                                        {t('ruleSubmit')}
                                    </Button>
                                </div>
                            </form>
                        </Form>
                        <Table>
                            <TableHeader>
                                {table.getHeaderGroups().map((headerGroup) => (
                                    <TableRow key={headerGroup.id}>
                                        {headerGroup.headers.map((header) => (
                                            <TableHead key={header.id}>
                                                {header.isPlaceholder
                                                    ? null
                                                    : flexRender(
                                                          header.column.columnDef
                                                              .header,
                                                          header.getContext()
                                                      )}
                                            </TableHead>
                                        ))}
                                    </TableRow>
                                ))}
                            </TableHeader>
                            <TableBody>
                                {table.getRowModel().rows?.length ? (
                                    table.getRowModel().rows.map((row) => (
                                        <TableRow key={row.id}>
                                            {row.getVisibleCells().map((cell) => (
                                                <TableCell key={cell.id}>
                                                    {flexRender(
                                                        cell.column.columnDef.cell,
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
                                            {t('rulesNoOne')}
                                        </TableCell>
                                    </TableRow>
                                )}
                            </TableBody>
                            {/* <TableCaption> */}
                            {/*     {t('rulesOrder')} */}
                            {/* </TableCaption> */}
                        </Table>
                    </div>
                </SettingsSectionBody>
            </SettingsSection>

            <div className="flex justify-end">
                <Button
                    onClick={saveAllSettings}
                    loading={loading}
                    disabled={loading}
                >
                    {t('saveAllSettings')}
                </Button>
            </div>
        </SettingsContainer>
    );
}
