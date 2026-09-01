"use client";

import { useQuery } from "@tanstack/react-query";
import { orgQueries } from "@app/lib/queries";
import {
    Tooltip,
    TooltipContent,
    TooltipTrigger
} from "@app/components/ui/tooltip";
import { useEnvContext } from "@app/hooks/useEnvContext";
import { createApiClient } from "@app/lib/api";
import { cn } from "@app/lib/cn";
import { useTranslations } from "next-intl";

function formatDuration(seconds: number): string {
    if (seconds === 0) return "0s";
    if (seconds < 60) return `${Math.round(seconds)}s`;
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.round(seconds % 60);
    if (h > 0) return s > 0 ? `${h}h ${m}m ${s}s` : `${h}h ${m}m`;
    if (m > 0 && s > 0) return `${m}m ${s}s`;
    return `${m}m`;
}

function formatDate(dateStr: string): string {
    return new Date(dateStr + "T00:00:00").toLocaleDateString([], {
        month: "short",
        day: "numeric",
        year: "numeric"
    });
}

function formatTime(ts: number): string {
    return new Date(ts * 1000).toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit"
    });
}

const barColorClass: Record<string, string> = {
    good: "bg-green-500",
    degraded: "bg-yellow-500",
    bad: "bg-red-500",
    no_data: "bg-neutral-200 dark:bg-neutral-700",
    unknown: "bg-neutral-200 dark:bg-neutral-700"
};

type UptimeBarProps = {
    orgId?: string;
    siteId?: number;
    resourceId?: number;
    healthCheckId?: number;
    days?: number;
    title?: string;
    className?: string;
};

export default function UptimeBar({
    orgId,
    siteId,
    resourceId,
    healthCheckId,
    days = 90,
    title,
    className
}: UptimeBarProps) {
    const t = useTranslations();
    const api = createApiClient(useEnvContext());

    const siteQuery = useQuery({
        ...orgQueries.siteStatusHistory({ siteId: siteId ?? 0, days }),
        enabled: siteId != null,
        meta: { api }
    });

    const hcQuery = useQuery({
        ...orgQueries.healthCheckStatusHistory({
            orgId: orgId ?? "",
            healthCheckId: healthCheckId ?? 0,
            days
        }),
        enabled: healthCheckId != null && siteId == null && resourceId == null,
        meta: { api }
    });

    const resourceQuery = useQuery({
        ...orgQueries.resourceStatusHistory({ resourceId, days }),
        enabled: resourceId != null && siteId == null && healthCheckId == null,
        meta: { api }
    });

    const { data, isLoading } =
        siteId != null
            ? siteQuery
            : resourceId != null
              ? resourceQuery
              : hcQuery;

    if (isLoading) {
        return (
            <div className={cn("space-y-3", className)}>
                <div className="flex items-center justify-between">
                    {title && (
                        <span className="text-sm font-medium">{title}</span>
                    )}
                    <div
                        className="flex items-center gap-4 text-sm ml-auto"
                        aria-busy="true"
                        aria-label={t("loading")}
                    >
                        <span className="h-4 w-[4.5rem] shrink-0 rounded-md bg-muted animate-pulse" />
                        <span className="h-4 w-[7rem] shrink-0 rounded-md bg-muted animate-pulse" />
                    </div>
                </div>
                <div className="flex gap-0.5 h-8">
                    {Array.from({ length: days }).map((_, i) => (
                        <div
                            key={i}
                            className={cn(
                                "flex-1 rounded-sm animate-pulse",
                                barColorClass.no_data
                            )}
                        />
                    ))}
                </div>
                <div className="flex justify-between text-xs text-muted-foreground">
                    <span>{t("uptimeDaysAgo", { count: days })}</span>
                    <span>{t("uptimeToday")}</span>
                </div>
            </div>
        );
    }

    if (!data) return null;

    const allNoData = data.days.every(
        (d) => d.status === "no_data" || d.status === "unknown"
    );

    return (
        <div className={cn("space-y-3", className)}>
            {/* Header row */}
            <div className="flex items-center justify-between">
                {title && <span className="text-sm font-medium">{title}</span>}
                <div className="flex items-center gap-4 text-sm ml-auto">
                    {!allNoData && (
                        <>
                            <span className="text-muted-foreground">
                                <span className="font-semibold text-foreground">
                                    {data.overallUptimePercent.toFixed(2)}%
                                </span>{" "}
                                {t("uptimeSuffix")}
                            </span>
                            {data.totalDowntimeSeconds > 0 && (
                                <span className="text-muted-foreground">
                                    <span className="font-semibold text-foreground">
                                        {formatDuration(
                                            data.totalDowntimeSeconds
                                        )}
                                    </span>{" "}
                                    {t("uptimeDowntimeSuffix")}
                                </span>
                            )}
                        </>
                    )}
                    {allNoData && (
                        <span className="text-muted-foreground text-xs">
                            {t("uptimeNoDataAvailable")}
                        </span>
                    )}
                </div>
            </div>

            {/* Bar row */}
            <div className="flex gap-0.5 h-8">
                {data.days.map((day, i) => (
                    <Tooltip key={i}>
                        <TooltipTrigger asChild>
                            <div
                                className={cn(
                                    "flex-1 rounded-sm cursor-default transition-opacity hover:opacity-80",
                                    barColorClass[day.status]
                                )}
                            />
                        </TooltipTrigger>
                        <TooltipContent
                            side="top"
                            className="max-w-[220px] p-3 space-y-1"
                        >
                            <div className="font-semibold text-xs">
                                {formatDate(day.date)}
                            </div>
                            {day.status !== "no_data" && day.status !== "unknown" && (
                                <div className="text-xs text-primary-foreground/80">
                                    {t("uptimeTooltipUptimeLabel")}:{" "}
                                    <span className="font-medium text-primary-foreground">
                                        {day.uptimePercent.toFixed(1)}%
                                    </span>
                                </div>
                            )}
                            {day.totalDowntimeSeconds > 0 && (
                                <div className="text-xs text-primary-foreground/80">
                                    {t("uptimeTooltipDowntimeLabel")}:{" "}
                                    <span className="font-medium text-primary-foreground">
                                        {formatDuration(
                                            day.totalDowntimeSeconds
                                        )}
                                    </span>
                                </div>
                            )}
                            {day.downtimeWindows.length > 0 && (
                                <div className="pt-1 space-y-0.5 border-t border-primary-foreground/20">
                                    {day.downtimeWindows.map((w, wi) => (
                                        <div
                                            key={wi}
                                            className="text-xs text-primary-foreground/70"
                                        >
                                            {formatTime(w.start)}
                                            {w.end
                                                ? ` – ${formatTime(w.end)}`
                                                : ` – ${t("uptimeOngoing")}`}{" "}
                                            <span className="capitalize">
                                                ({w.status})
                                            </span>
                                        </div>
                                    ))}
                                </div>
                            )}
                            {(day.status === "no_data" || day.status === "unknown") && (
                                <div className="text-xs text-primary-foreground/60">
                                    {t("uptimeNoMonitoringData")}
                                </div>
                            )}
                        </TooltipContent>
                    </Tooltip>
                ))}
            </div>

            {/* Date labels */}
            <div className="flex justify-between text-xs text-muted-foreground">
                <span>{t("uptimeDaysAgo", { count: days })}</span>
                <span>{t("uptimeToday")}</span>
            </div>
        </div>
    );
}