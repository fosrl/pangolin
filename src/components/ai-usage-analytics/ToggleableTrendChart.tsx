"use client";

import { useState } from "react";
import { cn } from "@app/lib/cn";
import { useTranslations } from "next-intl";
import {
    BarChart3,
    LineChart as LineChartIcon,
    LoaderIcon
} from "lucide-react";
import {
    Bar,
    BarChart,
    CartesianGrid,
    Line,
    LineChart,
    XAxis,
    YAxis
} from "recharts";
import { Button } from "@app/components/ui/button";
import {
    ChartContainer,
    ChartLegend,
    ChartLegendContent,
    ChartTooltip,
    ChartTooltipContent,
    type ChartConfig
} from "@app/components/ui/chart";

export type TrendSeries = {
    key: string;
    label: string;
    color: string;
};

export interface TrendChartRow {
    day: string;
    [seriesKey: string]: number | string;
}

type ToggleableTrendChartProps = {
    title: string;
    data: TrendChartRow[];
    series: TrendSeries[];
    isLoading?: boolean;
    valueFormatter?: (value: number) => string;
    className?: string;
};

const compactFormatter = new Intl.NumberFormat(undefined, {
    maximumFractionDigits: 1,
    notation: "compact",
    compactDisplay: "short"
});

export function ToggleableTrendChart(props: ToggleableTrendChartProps) {
    const t = useTranslations();
    const [chartType, setChartType] = useState<"bar" | "line">("bar");

    const valueFormatter = props.valueFormatter ?? compactFormatter.format;

    const chartConfig = props.series.reduce((acc, s) => {
        acc[s.key] = { label: s.label, color: s.color };
        return acc;
    }, {} as ChartConfig);

    const hasData = props.data.length > 0;

    return (
        <div
            className={cn(
                "relative flex min-w-0 flex-col gap-2",
                props.className
            )}
        >
            <div className="flex items-center justify-between gap-2">
                <h3 className="font-semibold">{props.title}</h3>
                <div className="flex gap-1">
                    <Button
                        type="button"
                        size="sm"
                        variant={chartType === "bar" ? "secondary" : "ghost"}
                        onClick={() => setChartType("bar")}
                        className="gap-1.5 px-2"
                    >
                        <BarChart3 className="size-3.5" />
                    </Button>
                    <Button
                        type="button"
                        size="sm"
                        variant={chartType === "line" ? "secondary" : "ghost"}
                        onClick={() => setChartType("line")}
                        className="gap-1.5 px-2"
                    >
                        <LineChartIcon className="size-3.5" />
                    </Button>
                </div>
            </div>

            {!hasData ? (
                <div className="flex h-64 w-full items-center justify-center text-muted-foreground gap-2">
                    {props.isLoading ? (
                        <>
                            <LoaderIcon className="size-4 animate-spin" />
                            {t("aiUsageLoading")}
                        </>
                    ) : (
                        t("aiUsageNoData")
                    )}
                </div>
            ) : (
                <ChartContainer
                    config={chartConfig}
                    className="aspect-auto min-h-50 h-64 w-full min-w-0 overflow-hidden"
                >
                    {chartType === "bar" ? (
                        <BarChart accessibilityLayer data={props.data}>
                            <ChartLegend
                                content={
                                    <ChartLegendContent className="flex-wrap" />
                                }
                            />
                            <ChartTooltip
                                content={
                                    <ChartTooltipContent
                                        indicator="dot"
                                        labelFormatter={(_value, payload) =>
                                            formatDay(
                                                payload?.[0]?.payload?.day
                                            )
                                        }
                                        valueFormatter={valueFormatter}
                                    />
                                }
                            />
                            <CartesianGrid vertical={false} />
                            <YAxis
                                tickLine={false}
                                axisLine={false}
                                tickFormatter={valueFormatter}
                            />
                            <XAxis
                                dataKey="day"
                                tickLine={false}
                                tickMargin={10}
                                axisLine={false}
                                tickFormatter={formatDay}
                            />
                            {props.series.map((s) => (
                                <Bar
                                    key={s.key}
                                    dataKey={s.key}
                                    stackId="stack"
                                    fill={s.color}
                                    radius={2}
                                    isAnimationActive={false}
                                />
                            ))}
                        </BarChart>
                    ) : (
                        <LineChart accessibilityLayer data={props.data}>
                            <ChartLegend
                                content={
                                    <ChartLegendContent className="flex-wrap" />
                                }
                            />
                            <ChartTooltip
                                content={
                                    <ChartTooltipContent
                                        indicator="line"
                                        labelFormatter={(_value, payload) =>
                                            formatDay(
                                                payload?.[0]?.payload?.day
                                            )
                                        }
                                        valueFormatter={valueFormatter}
                                    />
                                }
                            />
                            <CartesianGrid vertical={false} />
                            <YAxis
                                tickLine={false}
                                axisLine={false}
                                tickFormatter={valueFormatter}
                            />
                            <XAxis
                                dataKey="day"
                                tickLine={false}
                                tickMargin={10}
                                axisLine={false}
                                tickFormatter={formatDay}
                            />
                            {props.series.map((s) => (
                                <Line
                                    key={s.key}
                                    dataKey={s.key}
                                    stroke={s.color}
                                    strokeWidth={2}
                                    fill="transparent"
                                    isAnimationActive={false}
                                    dot={false}
                                />
                            ))}
                        </LineChart>
                    )}
                </ChartContainer>
            )}
        </div>
    );
}

function formatDay(value: unknown) {
    if (typeof value !== "string") return "";
    const date = new Date(value);
    if (isNaN(date.getTime())) return value;
    return date.toLocaleDateString(undefined, { dateStyle: "medium" });
}
