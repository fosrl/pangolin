"use client";

import { Button } from "@app/components/ui/button";
import { DataTableEmptyState } from "@app/components/ui/data-table-empty-state";
import {
    Command,
    CommandEmpty,
    CommandGroup,
    CommandInput,
    CommandItem,
    CommandList
} from "@app/components/ui/command";
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
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow
} from "@app/components/ui/table";
import { toast } from "@app/hooks/useToast";
import { cn } from "@app/lib/cn";
import { MAJOR_ASNS } from "@server/db/asns";
import { COUNTRIES } from "@server/db/countries";
import { REGIONS, getRegionNameById } from "@server/db/regions";
import {
    ColumnDef,
    flexRender,
    getCoreRowModel,
    getFilteredRowModel,
    getPaginationRowModel,
    getSortedRowModel,
    useReactTable
} from "@tanstack/react-table";
import {
    ArrowUpDown,
    Check,
    ChevronsUpDown,
    GripVertical,
    LockIcon
} from "lucide-react";
import { useTranslations } from "next-intl";
import {
    useCallback,
    useMemo,
    useState,
    type DragEvent,
    type ReactNode
} from "react";
import {
    validatePolicyRulePriority,
    validatePolicyRuleValue
} from "./policy-access-rule-validation";
import {
    buildDisplayPrioritiesForResourceOverlay,
    reorderPolicyRules,
    reorderResourceOverlayRules,
    setResourceRuleDisplayPriority,
    sortPolicyRulesByPriority,
    sortPolicyRulesForResourceOverlay,
    type PolicyAccessRule
} from "./policy-access-rule-utils";
import { countryCodeToFlagEmoji } from "@app/lib/countryCodeToFlagEmoji";

export type PolicyAccessRulesTableProps = {
    rules: PolicyAccessRule[];
    onRulesChange: (rules: PolicyAccessRule[]) => void;
    updateRule: (ruleId: number, data: Partial<PolicyAccessRule>) => void;
    removeRule: (ruleId: number) => void;
    isMaxmindAvailable: boolean;
    isMaxmindAsnAvailable: boolean;
    emptyStateAction: ReactNode;
    readonly?: boolean;
    includeRegionMatch?: boolean;
    markUpdatedOnReorder?: boolean;
    resourceOverlayMode?: boolean;
    isRuleDraggable?: (rule: PolicyAccessRule) => boolean;
    isRuleLocked?: (rule: PolicyAccessRule) => boolean;
};

function getColumnClassName(columnId: string) {
    if (columnId === "actions") {
        return "sticky right-0 z-10 w-[1%] min-w-fit bg-card text-right";
    }
    if (columnId === "dragHandle") {
        return "w-8 max-w-8 px-2";
    }
    if (columnId === "priority") {
        return "w-24 max-w-24";
    }
    if (columnId === "action") {
        return "w-42 max-w-42";
    }
    if (columnId === "match") {
        return "w-36 max-w-36";
    }
    return "";
}

export function PolicyAccessRulesTable({
    rules,
    onRulesChange,
    updateRule,
    removeRule,
    isMaxmindAvailable,
    isMaxmindAsnAvailable,
    emptyStateAction,
    readonly = false,
    includeRegionMatch = false,
    markUpdatedOnReorder = false,
    resourceOverlayMode = false,
    isRuleDraggable: isRuleDraggableProp,
    isRuleLocked: isRuleLockedProp
}: PolicyAccessRulesTableProps) {
    const t = useTranslations();
    const [draggedRuleId, setDraggedRuleId] = useState<number | null>(null);
    const [dragOverRuleId, setDragOverRuleId] = useState<number | null>(null);

    const isRuleLocked = useCallback(
        (rule: PolicyAccessRule) =>
            isRuleLockedProp
                ? isRuleLockedProp(rule)
                : Boolean(rule.fromPolicy),
        [isRuleLockedProp]
    );

    const isRuleDraggable = useCallback(
        (rule: PolicyAccessRule) =>
            isRuleDraggableProp
                ? isRuleDraggableProp(rule)
                : !readonly && !isRuleLocked(rule),
        [isRuleDraggableProp, isRuleLocked, readonly]
    );

    const sortedRules = useMemo(
        () =>
            resourceOverlayMode
                ? sortPolicyRulesForResourceOverlay(rules)
                : sortPolicyRulesByPriority(rules),
        [rules, resourceOverlayMode]
    );

    const displayPriorities = useMemo(
        () =>
            resourceOverlayMode
                ? buildDisplayPrioritiesForResourceOverlay(rules)
                : null,
        [rules, resourceOverlayMode]
    );

    const resourceRuleCount = useMemo(
        () => rules.filter((rule) => !rule.fromPolicy).length,
        [rules]
    );

    const handleReorder = useCallback(
        (fromRuleId: number, toRuleId: number) => {
            if (resourceOverlayMode) {
                onRulesChange(
                    reorderResourceOverlayRules(rules, fromRuleId, toRuleId, {
                        markUpdated: markUpdatedOnReorder
                    })
                );
                return;
            }

            const fromIndex = sortedRules.findIndex(
                (rule) => rule.ruleId === fromRuleId
            );
            const toIndex = sortedRules.findIndex(
                (rule) => rule.ruleId === toRuleId
            );
            if (fromIndex === -1 || toIndex === -1 || fromIndex === toIndex) {
                return;
            }

            const reordered = reorderPolicyRules(
                sortedRules,
                fromIndex,
                toIndex,
                { markUpdated: markUpdatedOnReorder }
            );
            onRulesChange(reordered);
        },
        [
            rules,
            sortedRules,
            onRulesChange,
            markUpdatedOnReorder,
            resourceOverlayMode
        ]
    );

    const handleDragStart = useCallback((ruleId: number, e: DragEvent) => {
        setDraggedRuleId(ruleId);
        e.dataTransfer.effectAllowed = "move";
    }, []);

    const handleDragEnd = useCallback(() => {
        setDraggedRuleId(null);
        setDragOverRuleId(null);
    }, []);

    const RuleAction = useMemo(
        () => ({
            ACCEPT: t("alwaysAllow"),
            DROP: t("alwaysDeny"),
            PASS: t("passToAuth")
        }),
        [t]
    );

    const RuleMatch = useMemo(
        () => ({
            PATH: t("path"),
            IP: "IP",
            CIDR: t("ipAddressRange"),
            COUNTRY: t("country"),
            ASN: "ASN",
            REGION: t("region")
        }),
        [t]
    );

    const columns: ColumnDef<PolicyAccessRule>[] = useMemo(
        () => [
            {
                id: "dragHandle",
                size: 32,
                maxSize: 32,
                header: () => null,
                cell: ({ row }) =>
                    isRuleDraggable(row.original) ? (
                        <button
                            type="button"
                            draggable
                            tabIndex={-1}
                            aria-label={t("rulesReorderDragHandle")}
                            className="flex items-center justify-center text-muted-foreground cursor-grab active:cursor-grabbing"
                            onDragStart={(e) =>
                                handleDragStart(row.original.ruleId, e)
                            }
                            onDragEnd={handleDragEnd}
                        >
                            <GripVertical className="h-4 w-4" />
                        </button>
                    ) : null
            },
            {
                accessorKey: "priority",
                size: 96,
                maxSize: 96,
                header: ({ column }) => (
                    <div className="p-3">
                        {resourceOverlayMode ? (
                            <span className="font-medium text-muted-foreground">
                                {t("rulesPriority")}
                            </span>
                        ) : (
                            <Button
                                variant="ghost"
                                className="h-auto p-0 font-medium text-muted-foreground hover:bg-transparent"
                                onClick={() =>
                                    column.toggleSorting(
                                        column.getIsSorted() === "asc"
                                    )
                                }
                            >
                                {t("rulesPriority")}
                                <ArrowUpDown className="ml-1 h-3 w-3" />
                            </Button>
                        )}
                    </div>
                ),
                cell: ({ row }) => {
                    const displayPriority = resourceOverlayMode
                        ? (displayPriorities?.get(row.original.ruleId) ??
                          row.original.priority)
                        : row.original.priority;

                    return (
                        <Input
                            key={`${row.original.ruleId}-${displayPriority}`}
                            defaultValue={displayPriority}
                            className="w-full min-w-0"
                            type="number"
                            disabled={readonly || isRuleLocked(row.original)}
                            onClick={(e) => e.currentTarget.focus()}
                            onBlur={(e) => {
                                const validated = validatePolicyRulePriority(
                                    t,
                                    e.target.value
                                );
                                if (!validated.success) {
                                    toast({
                                        variant: "destructive",
                                        ...validated.toast
                                    });
                                    return;
                                }

                                if (resourceOverlayMode) {
                                    if (
                                        validated.data > resourceRuleCount ||
                                        validated.data < 1
                                    ) {
                                        toast({
                                            variant: "destructive",
                                            title: t(
                                                "rulesErrorInvalidPriority"
                                            ),
                                            description: t(
                                                "rulesErrorInvalidPriorityDescription"
                                            )
                                        });
                                        return;
                                    }

                                    const duplicateDisplayPriority = rules.some(
                                        (rule) =>
                                            !rule.fromPolicy &&
                                            rule.ruleId !==
                                                row.original.ruleId &&
                                            displayPriorities?.get(
                                                rule.ruleId
                                            ) === validated.data
                                    );
                                    if (duplicateDisplayPriority) {
                                        toast({
                                            variant: "destructive",
                                            title: t(
                                                "rulesErrorDuplicatePriority"
                                            ),
                                            description: t(
                                                "rulesErrorDuplicatePriorityDescription"
                                            )
                                        });
                                        return;
                                    }

                                    if (validated.data === displayPriority) {
                                        return;
                                    }

                                    onRulesChange(
                                        setResourceRuleDisplayPriority(
                                            rules,
                                            row.original.ruleId,
                                            validated.data,
                                            {
                                                markUpdated:
                                                    markUpdatedOnReorder
                                            }
                                        )
                                    );
                                    return;
                                }

                                const duplicatePriority = rules.some(
                                    (rule) =>
                                        rule.ruleId !== row.original.ruleId &&
                                        rule.priority === validated.data
                                );
                                if (duplicatePriority) {
                                    toast({
                                        variant: "destructive",
                                        title: t("rulesErrorDuplicatePriority"),
                                        description: t(
                                            "rulesErrorDuplicatePriorityDescription"
                                        )
                                    });
                                    return;
                                }
                                updateRule(row.original.ruleId, {
                                    priority: validated.data
                                });
                            }}
                        />
                    );
                }
            },
            {
                accessorKey: "action",
                size: 160,
                maxSize: 160,
                header: () => <span className="p-3">{t("rulesAction")}</span>,
                cell: ({ row }) => (
                    <Select
                        defaultValue={row.original.action}
                        disabled={readonly || isRuleLocked(row.original)}
                        onValueChange={(value: "ACCEPT" | "DROP" | "PASS") =>
                            updateRule(row.original.ruleId, {
                                action: value
                            })
                        }
                    >
                        <SelectTrigger className="h-8 w-full min-w-0">
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
                )
            },
            {
                accessorKey: "match",
                size: 144,
                maxSize: 144,
                header: () => (
                    <span className="p-3">{t("rulesMatchType")}</span>
                ),
                cell: ({ row }) => (
                    <Select
                        defaultValue={row.original.match}
                        disabled={readonly || isRuleLocked(row.original)}
                        onValueChange={(
                            value:
                                | "CIDR"
                                | "IP"
                                | "PATH"
                                | "COUNTRY"
                                | "ASN"
                                | "REGION"
                        ) =>
                            updateRule(row.original.ruleId, {
                                match: value,
                                value:
                                    value === "COUNTRY"
                                        ? "US"
                                        : value === "ASN"
                                          ? "AS15169"
                                          : value === "REGION"
                                            ? "021"
                                            : row.original.value
                            })
                        }
                    >
                        <SelectTrigger className="h-8 w-full min-w-0">
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="PATH">
                                {RuleMatch.PATH}
                            </SelectItem>
                            <SelectItem value="IP">{RuleMatch.IP}</SelectItem>
                            <SelectItem value="CIDR">
                                {RuleMatch.CIDR}
                            </SelectItem>
                            {isMaxmindAvailable && (
                                <SelectItem value="COUNTRY">
                                    {RuleMatch.COUNTRY}
                                </SelectItem>
                            )}
                            {includeRegionMatch && isMaxmindAvailable && (
                                <SelectItem value="REGION">
                                    {RuleMatch.REGION}
                                </SelectItem>
                            )}
                            {isMaxmindAsnAvailable && (
                                <SelectItem value="ASN">
                                    {RuleMatch.ASN}
                                </SelectItem>
                            )}
                        </SelectContent>
                    </Select>
                )
            },
            {
                accessorKey: "value",
                header: () => <span className="p-3">{t("value")}</span>,
                cell: ({ row }) => {
                    let selectedCountry: (typeof COUNTRIES)[number] | undefined;
                    if (
                        row.original.match === "COUNTRY" &&
                        row.original.value
                    ) {
                        selectedCountry = COUNTRIES.find(
                            (c) => c.code === row.original.value
                        );
                    }
                    return row.original.match === "COUNTRY" ? (
                        <Popover>
                            <PopoverTrigger asChild>
                                <Button
                                    variant="outline"
                                    role="combobox"
                                    disabled={
                                        readonly || isRuleLocked(row.original)
                                    }
                                    className="w-full min-w-0 justify-between"
                                >
                                    {selectedCountry ? (
                                        <>
                                            <span>
                                                {selectedCountry.code === "ALL"
                                                    ? "🌍"
                                                    : countryCodeToFlagEmoji(
                                                          selectedCountry.code
                                                      )}
                                                &nbsp;&nbsp;
                                                {selectedCountry.name} (
                                                {selectedCountry.code})
                                            </span>
                                        </>
                                    ) : (
                                        t("selectCountry")
                                    )}
                                    <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                                </Button>
                            </PopoverTrigger>
                            <PopoverContent className="min-w-50 p-0">
                                <Command>
                                    <CommandInput
                                        placeholder={t("searchCountries")}
                                    />
                                    <CommandList>
                                        <CommandEmpty>
                                            {t("noCountryFound")}
                                        </CommandEmpty>
                                        <CommandGroup>
                                            {COUNTRIES.map((country) => (
                                                <CommandItem
                                                    key={country.code}
                                                    value={country.name}
                                                    onSelect={() =>
                                                        updateRule(
                                                            row.original.ruleId,
                                                            {
                                                                value: country.code
                                                            }
                                                        )
                                                    }
                                                >
                                                    <Check
                                                        className={`mr-2 h-4 w-4 ${row.original.value === country.code ? "opacity-100" : "opacity-0"}`}
                                                    />
                                                    <span>
                                                        {country.code === "ALL"
                                                            ? "🌍"
                                                            : countryCodeToFlagEmoji(
                                                                  country.code
                                                              )}
                                                    </span>
                                                    {country.name} (
                                                    {country.code})
                                                </CommandItem>
                                            ))}
                                        </CommandGroup>
                                    </CommandList>
                                </Command>
                            </PopoverContent>
                        </Popover>
                    ) : row.original.match === "ASN" ? (
                        <Popover>
                            <PopoverTrigger asChild>
                                <Button
                                    variant="outline"
                                    role="combobox"
                                    disabled={
                                        readonly || isRuleLocked(row.original)
                                    }
                                    className="w-full min-w-0 justify-between"
                                >
                                    {row.original.value
                                        ? (() => {
                                              const found = MAJOR_ASNS.find(
                                                  (asn) =>
                                                      asn.code ===
                                                      row.original.value
                                              );
                                              return found
                                                  ? `${found.name} (${row.original.value})`
                                                  : `Custom (${row.original.value})`;
                                          })()
                                        : "Select ASN"}
                                    <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                                </Button>
                            </PopoverTrigger>
                            <PopoverContent className="min-w-50 p-0">
                                <Command>
                                    <CommandInput placeholder="Search ASNs or enter custom..." />
                                    <CommandList>
                                        <CommandEmpty>
                                            No ASN found. Enter a custom ASN
                                            below.
                                        </CommandEmpty>
                                        <CommandGroup>
                                            {MAJOR_ASNS.map((asn) => (
                                                <CommandItem
                                                    key={asn.code}
                                                    value={
                                                        asn.name +
                                                        " " +
                                                        asn.code
                                                    }
                                                    onSelect={() =>
                                                        updateRule(
                                                            row.original.ruleId,
                                                            { value: asn.code }
                                                        )
                                                    }
                                                >
                                                    <Check
                                                        className={`mr-2 h-4 w-4 ${row.original.value === asn.code ? "opacity-100" : "opacity-0"}`}
                                                    />
                                                    {asn.name} ({asn.code})
                                                </CommandItem>
                                            ))}
                                        </CommandGroup>
                                    </CommandList>
                                </Command>
                                <div className="border-t p-2">
                                    <Input
                                        placeholder="Enter custom ASN (e.g., AS15169)"
                                        defaultValue={
                                            !MAJOR_ASNS.find(
                                                (asn) =>
                                                    asn.code ===
                                                    row.original.value
                                            )
                                                ? row.original.value
                                                : ""
                                        }
                                        onKeyDown={(e) => {
                                            if (e.key === "Enter") {
                                                const value =
                                                    e.currentTarget.value
                                                        .toUpperCase()
                                                        .replace(/^AS/, "");
                                                if (/^\d+$/.test(value)) {
                                                    updateRule(
                                                        row.original.ruleId,
                                                        { value: "AS" + value }
                                                    );
                                                }
                                            }
                                        }}
                                        className="text-sm"
                                    />
                                </div>
                            </PopoverContent>
                        </Popover>
                    ) : row.original.match === "REGION" ? (
                        <Popover>
                            <PopoverTrigger asChild>
                                <Button
                                    variant="outline"
                                    role="combobox"
                                    disabled={
                                        readonly || isRuleLocked(row.original)
                                    }
                                    className="w-full min-w-0 justify-between"
                                >
                                    {(() => {
                                        const regionName = getRegionNameById(
                                            row.original.value
                                        );
                                        if (!regionName) {
                                            return t("selectRegion");
                                        }
                                        return `${t(regionName)} (${row.original.value})`;
                                    })()}
                                    <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                                </Button>
                            </PopoverTrigger>
                            <PopoverContent className="min-w-50 p-0">
                                <Command>
                                    <CommandInput
                                        placeholder={t("searchRegions")}
                                    />
                                    <CommandList>
                                        <CommandEmpty>
                                            {t("noRegionFound")}
                                        </CommandEmpty>
                                        {REGIONS.map((continent) => (
                                            <CommandGroup
                                                key={continent.id}
                                                heading={t(continent.name)}
                                            >
                                                <CommandItem
                                                    value={continent.id}
                                                    keywords={[
                                                        t(continent.name),
                                                        continent.id
                                                    ]}
                                                    onSelect={() =>
                                                        updateRule(
                                                            row.original.ruleId,
                                                            {
                                                                value: continent.id
                                                            }
                                                        )
                                                    }
                                                >
                                                    <Check
                                                        className={`mr-2 h-4 w-4 ${
                                                            row.original
                                                                .value ===
                                                            continent.id
                                                                ? "opacity-100"
                                                                : "opacity-0"
                                                        }`}
                                                    />
                                                    {t(continent.name)} (
                                                    {continent.id})
                                                </CommandItem>
                                                {continent.includes.map(
                                                    (subregion) => (
                                                        <CommandItem
                                                            key={subregion.id}
                                                            value={subregion.id}
                                                            keywords={[
                                                                t(
                                                                    subregion.name
                                                                ),
                                                                subregion.id
                                                            ]}
                                                            onSelect={() =>
                                                                updateRule(
                                                                    row.original
                                                                        .ruleId,
                                                                    {
                                                                        value: subregion.id
                                                                    }
                                                                )
                                                            }
                                                        >
                                                            <Check
                                                                className={`mr-2 h-4 w-4 ${
                                                                    row.original
                                                                        .value ===
                                                                    subregion.id
                                                                        ? "opacity-100"
                                                                        : "opacity-0"
                                                                }`}
                                                            />
                                                            {t(subregion.name)}{" "}
                                                            ({subregion.id})
                                                        </CommandItem>
                                                    )
                                                )}
                                            </CommandGroup>
                                        ))}
                                    </CommandList>
                                </Command>
                            </PopoverContent>
                        </Popover>
                    ) : (
                        <Input
                            defaultValue={row.original.value}
                            className="w-full min-w-0"
                            disabled={readonly || isRuleLocked(row.original)}
                            onBlur={(e) => {
                                const validated = validatePolicyRuleValue(
                                    t,
                                    row.original.match,
                                    e.target.value
                                );
                                if (!validated.success) {
                                    toast({
                                        variant: "destructive",
                                        ...validated.toast
                                    });
                                    return;
                                }
                                updateRule(row.original.ruleId, {
                                    value: validated.data
                                });
                            }}
                        />
                    );
                }
            },
            {
                accessorKey: "enabled",
                header: () => <span className="p-3">{t("enabled")}</span>,
                cell: ({ row }) => (
                    <div className="flex items-center w-full">
                        <Switch
                            defaultChecked={row.original.enabled}
                            disabled={readonly || isRuleLocked(row.original)}
                            onCheckedChange={(val) =>
                                updateRule(row.original.ruleId, {
                                    enabled: val
                                })
                            }
                        />
                    </div>
                )
            },
            {
                id: "actions",
                header: () => null,
                cell: ({ row }) => (
                    <div className="flex items-center justify-end space-x-2">
                        {isRuleLocked(row.original) ? (
                            <LockIcon className="h-4 w-4 text-muted-foreground" />
                        ) : (
                            <Button
                                variant="outline"
                                disabled={readonly}
                                onClick={() => removeRule(row.original.ruleId)}
                            >
                                {t("delete")}
                            </Button>
                        )}
                    </div>
                )
            }
        ],
        [
            t,
            RuleAction,
            RuleMatch,
            isMaxmindAvailable,
            isMaxmindAsnAvailable,
            includeRegionMatch,
            updateRule,
            onRulesChange,
            removeRule,
            readonly,
            rules,
            resourceOverlayMode,
            displayPriorities,
            resourceRuleCount,
            markUpdatedOnReorder,
            isRuleDraggable,
            isRuleLocked,
            handleDragStart,
            handleDragEnd
        ]
    );

    const table = useReactTable({
        data: sortedRules,
        columns,
        getCoreRowModel: getCoreRowModel(),
        getPaginationRowModel: getPaginationRowModel(),
        getSortedRowModel: getSortedRowModel(),
        getFilteredRowModel: getFilteredRowModel(),
        state: { pagination: { pageIndex: 0, pageSize: 1000 } }
    });

    return (
        <Table>
            <TableHeader>
                {table.getHeaderGroups().map((headerGroup) => (
                    <TableRow key={headerGroup.id}>
                        {headerGroup.headers.map((header) => {
                            const columnId = header.column.id;
                            return (
                                <TableHead
                                    key={header.id}
                                    className={getColumnClassName(columnId)}
                                >
                                    {header.isPlaceholder
                                        ? null
                                        : flexRender(
                                              header.column.columnDef.header,
                                              header.getContext()
                                          )}
                                </TableHead>
                            );
                        })}
                    </TableRow>
                ))}
            </TableHeader>
            <TableBody>
                {table.getRowModel().rows?.length ? (
                    table.getRowModel().rows.map((row) => {
                        const rule = row.original;
                        return (
                            <TableRow
                                key={row.id}
                                onDragOver={(e) => {
                                    e.preventDefault();
                                    if (
                                        draggedRuleId !== null &&
                                        draggedRuleId !== rule.ruleId
                                    ) {
                                        setDragOverRuleId(rule.ruleId);
                                    }
                                }}
                                onDrop={(e) => {
                                    e.preventDefault();
                                    if (
                                        draggedRuleId !== null &&
                                        draggedRuleId !== rule.ruleId &&
                                        isRuleDraggable(rule)
                                    ) {
                                        handleReorder(
                                            draggedRuleId,
                                            rule.ruleId
                                        );
                                    }
                                    setDraggedRuleId(null);
                                    setDragOverRuleId(null);
                                }}
                                className={cn(
                                    draggedRuleId === rule.ruleId &&
                                        "opacity-50",
                                    dragOverRuleId === rule.ruleId &&
                                        "border-t border-primary"
                                )}
                            >
                                {row.getVisibleCells().map((cell) => {
                                    const columnId = cell.column.id;
                                    return (
                                        <TableCell
                                            key={cell.id}
                                            className={getColumnClassName(
                                                columnId
                                            )}
                                        >
                                            {flexRender(
                                                cell.column.columnDef.cell,
                                                cell.getContext()
                                            )}
                                        </TableCell>
                                    );
                                })}
                            </TableRow>
                        );
                    })
                ) : (
                    <DataTableEmptyState
                        colSpan={columns.length}
                        message={t("rulesNoOne")}
                        action={emptyStateAction}
                    />
                )}
            </TableBody>
        </Table>
    );
}
