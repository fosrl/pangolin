"use client";

import {
    Tooltip,
    TooltipContent,
    TooltipTrigger
} from "@app/components/ui/tooltip";
import { cn } from "@app/lib/cn";
import { orgQueries } from "@app/lib/queries";
import type { StatusHistoryResponse } from "@server/lib/statusHistory";
import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";

function formatDuration(seconds: number): string {
    if (seconds === 0) return "0s";
    if (seconds < 60) return `${Math.round(seconds)}s`;
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.round(seconds % 60);
    if (h > 0) return `${h}h ${m}m`;
    if (m > 0 && s > 0) return `${m}m ${s}s`;
    return `${m}m`;
}

function formatDate(dateStr: string): string {
    return new Date(dateStr + "T00:00:00").toLocaleDateString([], {
        month: "short",
        day: "numeric"
    });
}

const barColorClass: Record<string, string> = {
    good: "bg-green-500",
    degraded: "bg-yellow-500",
    bad: "bg-red-500",
    no_data: "bg-neutral-200 dark:bg-neutral-700",
    unknown: "bg-neutral-200 dark:bg-neutral-700"
};

type UptimeMiniBarProps = {
    orgId?: string;
    siteId?: number;
    resourceId?: number;
    healthCheckId?: number;
    days?: number;
};

export default function UptimeMiniBarWrapper({
    orgId,
    siteId,
    resourceId,
    healthCheckId,
    days = 30
}: UptimeMiniBarProps) {
    const siteQuery = useQuery({
        ...orgQueries.siteStatusHistory({ siteId: siteId ?? 0, days }),
        enabled: siteId != null
    });

    const hcQuery = useQuery({
        ...orgQueries.healthCheckStatusHistory({
            orgId: orgId ?? "",
            healthCheckId: healthCheckId ?? 0,
            days
        }),
        enabled: healthCheckId != null && siteId == null && resourceId == null
    });

    const resourceQuery = useQuery({
        ...orgQueries.resourceStatusHistory({ resourceId, days }),
        enabled: resourceId != null && siteId == null && healthCheckId == null
    });

    const { data, isLoading } =
        siteId != null
            ? siteQuery
            : resourceId != null
              ? resourceQuery
              : hcQuery;

    return <UptimeMiniBar data={data} isLoading={isLoading} days={days} />;
}

type UptimeMiniBarUIProps = {
    data?: StatusHistoryResponse;
    isLoading?: boolean;
    days?: number;
};

export function UptimeMiniBar({
    data,
    isLoading,
    days = 30
}: UptimeMiniBarUIProps) {
    const t = useTranslations();

    if (isLoading) {
        return (
            <div className="flex items-center gap-2">
                <div
                    className="flex gap-px h-5"
                    style={{ width: `${days * 5}px` }}
                >
                    {Array.from({ length: days }).map((_, i) => (
                        <div
                            key={i}
                            className={cn(
                                "flex-1 rounded-[2px] animate-pulse",
                                barColorClass.no_data
                            )}
                        />
                    ))}
                </div>
                <span
                    className="inline-flex min-w-[7ch] items-center justify-end text-xs text-muted-foreground whitespace-nowrap"
                    aria-busy="true"
                    aria-label={t("loading")}
                >
                    <span className="h-4 w-[5.5ch] max-w-full rounded bg-muted animate-pulse" />
                </span>
            </div>
        );
    }

    if (!data) return null;

    const allNoData = data.days.every(
        (d) => d.status === "no_data" || d.status === "unknown"
    );

    return (
        <div className="flex items-center gap-2">
            <div className="flex gap-px h-5" style={{ width: `${days * 5}px` }}>
                {data.days.map((day, i) => (
                    <Tooltip key={i}>
                        <TooltipTrigger asChild>
                            <div
                                className={cn(
                                    "flex-1 rounded-[2px] cursor-default transition-opacity hover:opacity-75",
                                    barColorClass[day.status]
                                )}
                            />
                        </TooltipTrigger>
                        <TooltipContent side="top" className="p-2 space-y-0.5">
                            <div className="font-semibold text-xs">
                                {formatDate(day.date)}
                            </div>
                            <div className="text-xs text-primary-foreground/80">
                                {day.status === "no_data" ||
                                day.status === "unknown"
                                    ? t("uptimeNoData")
                                    : `${day.uptimePercent.toFixed(1)}% ${t("uptimeSuffix")}`}
                            </div>
                            {day.totalDowntimeSeconds > 0 && (
                                <div className="text-xs text-primary-foreground/70">
                                    {t("uptimeMiniBarDown")}:{" "}
                                    {formatDuration(day.totalDowntimeSeconds)}
                                </div>
                            )}
                        </TooltipContent>
                    </Tooltip>
                ))}
            </div>
            <span className="text-xs text-muted-foreground whitespace-nowrap">
                {allNoData
                    ? t("uptimeNoData")
                    : `${data.overallUptimePercent.toFixed(1)}%`}
            </span>
        </div>
    );
}
