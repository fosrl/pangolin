"use client";

import { cn } from "@app/lib/cn";
import {
    aiUsageAnalyticsFiltersSchema,
    aiUsageAnalyticsQueries,
    type AiUsageAnalyticsFilters
} from "@app/lib/queries";
import { useIsFetching, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckIcon, ChevronsUpDown, RefreshCw, XIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { DateRangePicker, type DateTimeValue } from "./DateTimePicker";
import { Button } from "./ui/button";
import { Card, CardHeader } from "./ui/card";
import {
    Command,
    CommandEmpty,
    CommandGroup,
    CommandInput,
    CommandItem,
    CommandList
} from "./ui/command";
import { Label } from "./ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover";
import { Separator } from "./ui/separator";
import { getSevenDaysAgo } from "@app/lib/getSevenDaysAgo";
import { HorizontalTabs, type TabItem } from "./HorizontalTabs";
import { OverviewTab } from "./ai-usage-analytics/OverviewTab";
import { ProvidersTab } from "./ai-usage-analytics/ProvidersTab";
import { ResourcesTab } from "./ai-usage-analytics/ResourcesTab";
import { RolesTab } from "./ai-usage-analytics/RolesTab";
import { UsersTab } from "./ai-usage-analytics/UsersTab";
import { VirtualApiKeysTab } from "./ai-usage-analytics/VirtualApiKeysTab";
import { formatVirtualApiKeyPreview } from "@app/lib/virtualApiKeyFormat";

export type AiUsageAnalyticsDataProps = {
    orgId: string;
};

const AI_USAGE_ANALYTICS_QUERY_PREFIX = ["AI_USAGE_ANALYTICS"];

export function AiUsageAnalyticsData(props: AiUsageAnalyticsDataProps) {
    const t = useTranslations();
    const searchParams = useSearchParams();
    const path = usePathname();
    const router = useRouter();
    const queryClient = useQueryClient();

    const filters = aiUsageAnalyticsFiltersSchema.parse(
        Object.fromEntries(searchParams.entries())
    );

    const isEmptySearchParams = Object.values(filters).every(
        (v) => v === undefined
    );

    const dateRange = {
        startDate: filters.timeStart
            ? new Date(filters.timeStart)
            : getSevenDaysAgo(),
        endDate: filters.timeEnd ? new Date(filters.timeEnd) : new Date()
    };

    const { data: filterOptions } = useQuery(
        aiUsageAnalyticsQueries.filterOptions({
            orgId: props.orgId,
            filters: {
                timeStart: filters.timeStart,
                timeEnd: filters.timeEnd
            }
        })
    );

    const isFetching =
        useIsFetching({
            queryKey: [...AI_USAGE_ANALYTICS_QUERY_PREFIX, props.orgId]
        }) > 0;

    function setFilter(key: keyof AiUsageAnalyticsFilters, value?: string) {
        const newSearch = new URLSearchParams(searchParams);
        newSearch.delete(key);
        if (value !== undefined) {
            newSearch.set(key, value);
        }
        router.replace(`${path}?${newSearch.toString()}`);
    }

    function handleTimeRangeUpdate(start: DateTimeValue, end: DateTimeValue) {
        const newSearch = new URLSearchParams(searchParams);
        const timeRegex =
            /^(?<hours>\d{1,2})\:(?<minutes>\d{1,2})(\:(?<seconds>\d{1,2}))?$/;

        if (start.date) {
            const startDate = new Date(start.date);
            if (start.time) {
                const time = timeRegex.exec(start.time);
                const groups = time?.groups ?? {};
                startDate.setHours(Number(groups.hours));
                startDate.setMinutes(Number(groups.minutes));
                if (groups.seconds) {
                    startDate.setSeconds(Number(groups.seconds));
                }
            }
            newSearch.set("timeStart", startDate.toISOString());
        }
        if (end.date) {
            const endDate = new Date(end.date);
            if (end.time) {
                const time = timeRegex.exec(end.time);
                const groups = time?.groups ?? {};
                endDate.setHours(Number(groups.hours));
                endDate.setMinutes(Number(groups.minutes));
                if (groups.seconds) {
                    endDate.setSeconds(Number(groups.seconds));
                }
            }
            newSearch.set("timeEnd", endDate.toISOString());
        }
        router.replace(`${path}?${newSearch.toString()}`);
    }

    function getDateTime(date: Date) {
        return `${date.getHours()}:${date.getMinutes()}`;
    }

    const providerOptions = (filterOptions?.providers ?? []).map((p) => ({
        value: String(p.id),
        label: p.name ?? `Provider #${p.id}`
    }));
    const modelOptions = (filterOptions?.models ?? []).map((m) => ({
        value: m,
        label: m
    }));
    const resourceOptions = (filterOptions?.resources ?? []).map((r) => ({
        value: String(r.id),
        label: r.name ?? `Resource #${r.id}`
    }));
    const roleOptions = (filterOptions?.roles ?? []).map((r) => ({
        value: String(r.id),
        label: r.name ?? `Role #${r.id}`
    }));
    const userOptions = (filterOptions?.users ?? []).map((u) => ({
        value: u.id,
        label: u.email ?? u.id
    }));
    const virtualApiKeyOptions = (filterOptions?.virtualApiKeys ?? []).map(
        (k) => ({
            value: k.id,
            label: k.name ?? formatVirtualApiKeyPreview(k.id, k.lastChars)
        })
    );

    const tabs: TabItem[] = [
        { title: t("aiUsageTabOverview"), href: "#" },
        { title: t("aiUsageTabProviders"), href: "#" },
        { title: t("aiUsageTabResources"), href: "#" },
        { title: t("aiUsageRolesTab"), href: "#" },
        { title: t("aiUsageUsersTab"), href: "#" },
        { title: t("aiUsageVirtualApiKeysTab"), href: "#" }
    ];

    return (
        <div className="flex flex-col gap-5">
            <Card>
                <CardHeader className="flex flex-row flex-wrap items-end gap-x-3 gap-y-3 space-y-0">
                    <DateRangePicker
                        startValue={{
                            date: dateRange.startDate,
                            time: dateRange.startDate
                                ? getDateTime(dateRange.startDate)
                                : undefined
                        }}
                        endValue={{
                            date: dateRange.endDate,
                            time: dateRange.endDate
                                ? getDateTime(dateRange.endDate)
                                : undefined
                        }}
                        onRangeChange={handleTimeRangeUpdate}
                        className="flex-wrap gap-2"
                    />

                    <Separator className="w-px h-6 self-end relative bottom-1.5 hidden lg:block" />

                    <FilterSelect
                        id="providerId"
                        label={t("aiUsageFilterProvider")}
                        value={filters.providerId?.toString()}
                        options={providerOptions}
                        placeholder={t("aiUsageFilterAllProviders")}
                        onValueChange={(v) => setFilter("providerId", v)}
                    />
                    <FilterSelect
                        id="model"
                        label={t("aiUsageFilterModel")}
                        value={filters.model}
                        options={modelOptions}
                        placeholder={t("aiUsageFilterAllModels")}
                        onValueChange={(v) => setFilter("model", v)}
                    />
                    <FilterSelect
                        id="resourceId"
                        label={t("aiUsageFilterResource")}
                        value={filters.resourceId?.toString()}
                        options={resourceOptions}
                        placeholder={t("aiUsageFilterAllResources")}
                        onValueChange={(v) => setFilter("resourceId", v)}
                    />
                    <FilterSelect
                        id="roleId"
                        label={t("aiUsageFilterRole")}
                        value={filters.roleId?.toString()}
                        options={roleOptions}
                        placeholder={t("aiUsageFilterAllRoles")}
                        onValueChange={(v) => setFilter("roleId", v)}
                    />
                    <FilterSelect
                        id="userId"
                        label={t("aiUsageFilterUser")}
                        value={filters.userId}
                        options={userOptions}
                        placeholder={t("aiUsageFilterAllUsers")}
                        onValueChange={(v) => setFilter("userId", v)}
                    />
                    <FilterSelect
                        id="virtualApiKeyId"
                        label={t("aiUsageFilterVirtualApiKey")}
                        value={filters.virtualApiKeyId}
                        options={virtualApiKeyOptions}
                        placeholder={t("aiUsageFilterAllVirtualApiKeys")}
                        onValueChange={(v) => setFilter("virtualApiKeyId", v)}
                    />

                    <div className="flex items-center gap-2 ml-auto">
                        {!isEmptySearchParams && (
                            <Button
                                variant="ghost"
                                onClick={() => router.replace(path)}
                                className="gap-2"
                            >
                                <XIcon className="size-4" />
                                {t("aiUsageResetFilters")}
                            </Button>
                        )}

                        <Button
                            variant="outline"
                            onClick={() =>
                                queryClient.invalidateQueries({
                                    queryKey: [
                                        ...AI_USAGE_ANALYTICS_QUERY_PREFIX,
                                        props.orgId
                                    ]
                                })
                            }
                            disabled={isFetching}
                            className="gap-2"
                        >
                            <RefreshCw
                                className={cn(
                                    "size-4",
                                    isFetching && "animate-spin"
                                )}
                            />
                            {t("aiUsageRefresh")}
                        </Button>
                    </div>
                </CardHeader>
            </Card>

            <HorizontalTabs items={tabs} clientSide>
                <OverviewTab orgId={props.orgId} filters={filters} />
                <ProvidersTab orgId={props.orgId} filters={filters} />
                <ResourcesTab orgId={props.orgId} filters={filters} />
                <RolesTab orgId={props.orgId} filters={filters} />
                <UsersTab orgId={props.orgId} filters={filters} />
                <VirtualApiKeysTab orgId={props.orgId} filters={filters} />
            </HorizontalTabs>
        </div>
    );
}

type FilterSelectProps = {
    id: string;
    label: string;
    value?: string;
    options: { value: string; label: string }[];
    placeholder: string;
    onValueChange: (value?: string) => void;
};

function FilterSelect(props: FilterSelectProps) {
    const t = useTranslations();
    const [open, setOpen] = useState(false);
    const selected = props.options.find(
        (option) => option.value === props.value
    );

    return (
        <div className="flex flex-col items-start gap-2 w-44">
            <Label htmlFor={props.id}>{props.label}</Label>
            <Popover open={open} onOpenChange={setOpen}>
                <PopoverTrigger asChild>
                    <Button
                        id={props.id}
                        type="button"
                        variant="outline"
                        role="combobox"
                        aria-expanded={open}
                        className={cn(
                            "w-full justify-between font-normal",
                            !selected && "text-muted-foreground"
                        )}
                    >
                        <span className="truncate text-left">
                            {selected?.label ?? props.placeholder}
                        </span>
                        <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                    </Button>
                </PopoverTrigger>
                <PopoverContent
                    className="w-[var(--radix-popover-trigger-width)] min-w-56 p-0"
                    align="start"
                >
                    <Command>
                        <CommandInput placeholder={t("aiUsageFilterSearch")} />
                        <CommandList>
                            <CommandEmpty>
                                {t("aiUsageFilterNotFound")}
                            </CommandEmpty>
                            <CommandGroup>
                                <CommandItem
                                    value={props.placeholder}
                                    onSelect={() => {
                                        props.onValueChange(undefined);
                                        setOpen(false);
                                    }}
                                >
                                    <CheckIcon
                                        className={cn(
                                            "mr-2 h-4 w-4 shrink-0",
                                            !props.value
                                                ? "opacity-100"
                                                : "opacity-0"
                                        )}
                                    />
                                    {props.placeholder}
                                </CommandItem>
                                {props.options.map((option) => (
                                    <CommandItem
                                        key={option.value}
                                        value={`${option.value} ${option.label}`}
                                        onSelect={() => {
                                            props.onValueChange(
                                                option.value === props.value
                                                    ? undefined
                                                    : option.value
                                            );
                                            setOpen(false);
                                        }}
                                    >
                                        <CheckIcon
                                            className={cn(
                                                "mr-2 h-4 w-4 shrink-0",
                                                option.value === props.value
                                                    ? "opacity-100"
                                                    : "opacity-0"
                                            )}
                                        />
                                        <span className="truncate">
                                            {option.label}
                                        </span>
                                    </CommandItem>
                                ))}
                            </CommandGroup>
                        </CommandList>
                    </Command>
                </PopoverContent>
            </Popover>
        </div>
    );
}
