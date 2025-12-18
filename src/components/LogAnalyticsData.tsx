"use client";

import { cn } from "@app/lib/cn";
import {
    logAnalyticsFiltersSchema,
    logQueries,
    resourceQueries
} from "@app/lib/queries";
import { useQuery } from "@tanstack/react-query";
import { LoaderIcon, RefreshCw, XIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { DateRangePicker, type DateTimeValue } from "./DateTimePicker";
import { Button } from "./ui/button";
import { Card, CardContent, CardHeader } from "./ui/card";

import { countryCodeToFlagEmoji } from "@app/lib/countryCodeToFlagEmoji";
import {
    InfoSection,
    InfoSectionContent,
    InfoSections,
    InfoSectionTitle
} from "./InfoSection";
import { Label } from "./ui/label";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue
} from "./ui/select";
import { Separator } from "./ui/separator";
import { WorldMap } from "./WorldMap";

import { CartesianGrid, Line, LineChart, XAxis, YAxis } from "recharts";
import {
    ChartContainer,
    ChartLegend,
    ChartLegendContent,
    ChartTooltip,
    ChartTooltipContent,
    type ChartConfig
} from "./ui/chart";
import {
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger
} from "./ui/tooltip";
import { getSevenDaysAgo } from "@app/lib/getSevenDaysAgo";

export type AnalyticsContentProps = {
    orgId: string;
};

export function LogAnalyticsData(props: AnalyticsContentProps) {
    const searchParams = useSearchParams();
    const path = usePathname();
    const t = useTranslations();

    const filters = logAnalyticsFiltersSchema.parse(
        Object.fromEntries(searchParams.entries())
    );

    const isEmptySearchParams =
        !filters.resourceId && !filters.timeStart && !filters.timeEnd;

    const router = useRouter();

    console.log({ filters });
    const dateRange = {
        startDate: filters.timeStart
            ? new Date(filters.timeStart)
            : getSevenDaysAgo(),
        endDate: filters.timeEnd ? new Date(filters.timeEnd) : new Date()
    };

    const { data: resources = [], isFetching: isFetchingResources } = useQuery(
        resourceQueries.listNamesPerOrg(props.orgId)
    );

    const {
        data: stats,
        isFetching: isFetchingAnalytics,
        refetch: refreshAnalytics,
        isLoading: isLoadingAnalytics // only `true` when there is no data yet
    } = useQuery(
        logQueries.requestAnalytics({
            orgId: props.orgId,
            filters
        })
    );

    const percentBlocked =
        stats && stats.totalRequests > 0
            ? new Intl.NumberFormat(navigator.language, {
                  maximumFractionDigits: 2
              }).format((stats.totalBlocked / stats.totalRequests) * 100)
            : null;
    const totalRequests = stats
        ? new Intl.NumberFormat(navigator.language, {
              maximumFractionDigits: 0
          }).format(stats.totalRequests)
        : null;

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

    return (
        <div className="flex flex-col gap-5">
            <Card className="">
                <CardHeader className="flex flex-col space-y-4 sm:flex-row sm:items-start lg:items-end sm:justify-between sm:space-y-0 pb-4">
                    <div className="flex flex-col lg:flex-row items-start lg:items-end w-full sm:mr-2 gap-2">
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

                        <div className="flex items-end gap-2">
                            <div className="flex flex-col items-start gap-2 w-48">
                                <Label htmlFor="resourceId">
                                    {t("filterByResource")}
                                </Label>
                                <Select
                                    onValueChange={(newValue) => {
                                        const newSearch = new URLSearchParams(
                                            searchParams
                                        );
                                        newSearch.delete("resourceId");
                                        if (newValue !== "all") {
                                            newSearch.set(
                                                "resourceId",
                                                newValue
                                            );
                                        }

                                        router.replace(
                                            `${path}?${newSearch.toString()}`
                                        );
                                    }}
                                    value={
                                        filters.resourceId?.toString() ?? "all"
                                    }
                                >
                                    <SelectTrigger
                                        id="resourceId"
                                        className="w-full"
                                    >
                                        <SelectValue
                                            placeholder={t("selectResource")}
                                        />
                                    </SelectTrigger>
                                    <SelectContent className="w-full">
                                        {resources.map((resource) => (
                                            <SelectItem
                                                key={resource.resourceId}
                                                value={resource.resourceId.toString()}
                                            >
                                                {resource.name}
                                            </SelectItem>
                                        ))}
                                        <SelectItem value="all">
                                            All resources
                                        </SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>

                            {!isEmptySearchParams && (
                                <Button
                                    variant="ghost"
                                    onClick={() => {
                                        router.replace(path);
                                    }}
                                    className="gap-2"
                                >
                                    <XIcon className="size-4" />
                                    {t("resetFilters")}
                                </Button>
                            )}
                        </div>
                    </div>
                    <div className="flex items-start gap-2 sm:justify-end">
                        <Button
                            variant="outline"
                            onClick={() => refreshAnalytics()}
                            disabled={isFetchingAnalytics}
                            className=" relative top-6 lg:static gap-2"
                        >
                            <RefreshCw
                                className={cn(
                                    "size-4",
                                    isFetchingAnalytics && "animate-spin"
                                )}
                            />
                            {t("refresh")}
                        </Button>
                    </div>
                </CardHeader>
            </Card>

            <Card>
                <CardHeader className="flex flex-col gap-4">
                    <InfoSections cols={2}>
                        <InfoSection>
                            <InfoSectionTitle>
                                {t("totalRequests")}
                            </InfoSectionTitle>
                            <InfoSectionContent>
                                {totalRequests ?? "--"}
                            </InfoSectionContent>
                        </InfoSection>
                        <InfoSection>
                            <InfoSectionTitle>
                                {t("totalBlocked")}
                            </InfoSectionTitle>
                            <InfoSectionContent>
                                <span>{stats?.totalBlocked ?? "--"}</span>
                                &nbsp;(
                                <span>{percentBlocked ?? "--"}</span>
                                <span className="text-muted-foreground">%</span>
                                )
                            </InfoSectionContent>
                        </InfoSection>
                    </InfoSections>
                </CardHeader>
            </Card>

            <Card className="w-full h-full flex flex-col gap-8">
                <CardHeader>
                    <h3 className="font-semibold">{t("requestsByDay")}</h3>
                </CardHeader>
                <CardContent>
                    <RequestChart
                        data={stats?.requestsPerDay ?? []}
                        isLoading={isLoadingAnalytics}
                    />
                </CardContent>
            </Card>

            <div className="grid lg:grid-cols-2 gap-5">
                <Card className="w-full h-full">
                    <CardHeader>
                        <h3 className="font-semibold">
                            {t("requestsByCountry")}
                        </h3>
                    </CardHeader>
                    <CardContent>
                        <WorldMap
                            data={stats?.requestsPerCountry ?? []}
                            label={{
                                singular: "request",
                                plural: "requests"
                            }}
                        />
                    </CardContent>
                </Card>

                <Card className="w-full h-full">
                    <CardHeader>
                        <h3 className="font-semibold">{t("topCountries")}</h3>
                    </CardHeader>
                    <CardContent className="flex h-full flex-col gap-4">
                        <TopCountriesList
                            countries={stats?.requestsPerCountry ?? []}
                            total={stats?.totalRequests ?? 0}
                            isLoading={isLoadingAnalytics}
                        />
                    </CardContent>
                </Card>
            </div>
        </div>
    );
}

type RequestChartProps = {
    data: {
        day: string;
        allowedCount: number;
        blockedCount: number;
        totalCount: number;
    }[];
    isLoading: boolean;
};

function RequestChart(props: RequestChartProps) {
    const t = useTranslations();

    const numberFormatter = new Intl.NumberFormat(navigator.language, {
        maximumFractionDigits: 1,
        notation: "compact",
        compactDisplay: "short"
    });

    const chartConfig = {
        day: {
            label: t("requestsByDay")
        },
        blockedCount: {
            label: t("blocked"),
            color: "var(--chart-5)"
        },
        allowedCount: {
            label: t("allowed"),
            color: "var(--chart-2)"
        }
    } satisfies ChartConfig;

    return (
        <ChartContainer
            config={chartConfig}
            className="min-h-[200px] w-full h-80"
        >
            <LineChart accessibilityLayer data={props.data}>
                <ChartLegend content={<ChartLegendContent />} />
                <ChartTooltip
                    content={
                        <ChartTooltipContent
                            indicator="dot"
                            labelFormatter={(value, payload) => {
                                const formattedDate = new Date(
                                    payload[0].payload.day
                                ).toLocaleDateString(navigator.language, {
                                    dateStyle: "medium"
                                });
                                return formattedDate;
                            }}
                        />
                    }
                />

                <CartesianGrid vertical={false} />
                <YAxis
                    tickLine={false}
                    axisLine={false}
                    domain={[
                        0,
                        Math.max(...props.data.map((datum) => datum.totalCount))
                    ]}
                    allowDataOverflow
                    type="number"
                    tickFormatter={(value) => {
                        return numberFormatter.format(value);
                    }}
                />
                <XAxis
                    dataKey="day"
                    tickLine={false}
                    tickMargin={10}
                    axisLine={false}
                    tickFormatter={(value) => {
                        return new Date(value).toLocaleDateString(
                            navigator.language,
                            {
                                dateStyle: "medium"
                            }
                        );
                    }}
                />

                <Line
                    dataKey="allowedCount"
                    stroke="var(--color-allowedCount)"
                    strokeWidth={2}
                    fill="transparent"
                    radius={4}
                    isAnimationActive={false}
                    dot={false}
                />
                <Line
                    dataKey="blockedCount"
                    stroke="var(--color-blockedCount)"
                    strokeWidth={2}
                    fill="transparent"
                    radius={4}
                    isAnimationActive={false}
                    dot={false}
                />
            </LineChart>
        </ChartContainer>
    );
}

type TopCountriesListProps = {
    countries: {
        code: string;
        count: number;
    }[];
    total: number;
    isLoading: boolean;
};

function TopCountriesList(props: TopCountriesListProps) {
    const t = useTranslations();
    const displayNames = new Intl.DisplayNames(navigator.language, {
        type: "region",
        fallback: "code"
    });

    const numberFormatter = new Intl.NumberFormat(navigator.language, {
        maximumFractionDigits: 1,
        notation: "compact",
        compactDisplay: "short"
    });
    const percentFormatter = new Intl.NumberFormat(navigator.language, {
        maximumFractionDigits: 0,
        style: "percent"
    });

    return (
        <div className="h-full flex flex-col gap-2">
            {props.countries.length > 0 && (
                <div className="grid grid-cols-7 text-sm text-muted-foreground font-semibold h-4">
                    <div className="col-span-5">{t("countries")}</div>
                    <div className="text-end">{t("total")}</div>
                    <div className="text-end">%</div>
                </div>
            )}
            {/* `aspect-475/335` is the same aspect ratio as the world map component */}
            <ol className="w-full overflow-auto grid gap-1 aspect-475/335">
                {props.countries.length === 0 && (
                    <div className="flex items-center justify-center size-full text-muted-foreground gap-1">
                        {props.isLoading ? (
                            <>
                                <LoaderIcon className="size-4 animate-spin" />{" "}
                                {t("loading")}
                            </>
                        ) : (
                            t("noData")
                        )}
                    </div>
                )}
                {props.countries.map((country) => {
                    const percent = country.count / props.total;
                    return (
                        <li
                            key={country.code}
                            className="grid grid-cols-7 rounded-xs hover:bg-muted relative items-center text-sm"
                        >
                            <div
                                className={cn(
                                    "absolute bg-[#f36117]/40 top-0 bottom-0 left-0 rounded-xs"
                                )}
                                style={{
                                    width: `${percent * 100}%`
                                }}
                            />
                            <div className="col-span-5 px-2 py-1 relative z-1">
                                <span className="inline-flex gap-2 items-center">
                                    {countryCodeToFlagEmoji(country.code)}{" "}
                                    {displayNames.of(country.code)}
                                </span>
                            </div>
                            <TooltipProvider>
                                <div className="text-end">
                                    <Tooltip>
                                        <TooltipTrigger asChild>
                                            <button className="inline">
                                                {numberFormatter.format(
                                                    country.count
                                                )}
                                            </button>
                                        </TooltipTrigger>
                                        <TooltipContent>
                                            <strong>
                                                {Intl.NumberFormat(
                                                    navigator.language
                                                ).format(country.count)}
                                            </strong>{" "}
                                            {country.count === 1
                                                ? t("request")
                                                : t("requests")}
                                        </TooltipContent>
                                    </Tooltip>
                                </div>

                                <div className="text-end">
                                    {percentFormatter.format(percent)}
                                </div>
                            </TooltipProvider>
                        </li>
                    );
                })}
            </ol>
        </div>
    );
}
