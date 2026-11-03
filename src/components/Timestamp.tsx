"use client";

import {
    Tooltip,
    TooltipContent,
    TooltipTrigger
} from "@app/components/ui/tooltip";
import { cn } from "@app/lib/cn";
import { useFormatter, useNow, useTranslations } from "next-intl";

type TimestampValue = Date | number | string | null | undefined;

type TimestampProps = {
    value: TimestampValue;
    /** Unit of a numeric value. Most of the API uses ms; logs use seconds. */
    unit?: "ms" | "s";
    /** Shown when there is no value */
    fallback?: React.ReactNode;
    className?: string;
    /**
     * "relative" shows "5 minutes ago" and puts the local and UTC time in the
     * tooltip. "absolute" shows the local time and puts the relative and UTC
     * time in the tooltip; use it where the exact time matters, like logs.
     */
    display?: "relative" | "absolute";
};

function toDate(value: TimestampValue, unit: "ms" | "s"): Date | null {
    if (value === null || value === undefined || value === "") {
        return null;
    }
    const date =
        value instanceof Date
            ? value
            : typeof value === "number"
              ? new Date(unit === "s" ? value * 1000 : value)
              : new Date(value);
    return isNaN(date.getTime()) ? null : date;
}

const ABSOLUTE_FORMAT = {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    timeZoneName: "short"
} as const;

function getLocalTimeZone(): string {
    try {
        return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
    } catch {
        return "UTC";
    }
}

/**
 * A time with a dashed underline that shows more detail on hover, like the
 * AWS console. See `display` for what is shown inline vs in the tooltip.
 */
export function Timestamp({
    value,
    unit = "ms",
    fallback = "-",
    className,
    display = "relative"
}: TimestampProps) {
    const format = useFormatter();
    const t = useTranslations();
    // Re-render periodically so the relative text stays current
    const now = useNow({ updateInterval: 30 * 1000 });

    const date = toDate(value, unit);
    if (!date) {
        return <>{fallback}</>;
    }

    const localTimeZone = getLocalTimeZone();
    const relative = format.relativeTime(date, now);
    const local = format.dateTime(date, {
        ...ABSOLUTE_FORMAT,
        timeZone: localTimeZone
    });
    const utc = format.dateTime(date, {
        ...ABSOLUTE_FORMAT,
        timeZone: "UTC"
    });
    const isAbsolute = display === "absolute";

    return (
        <Tooltip>
            <TooltipTrigger asChild>
                <time
                    dateTime={date.toISOString()}
                    // Text depends on when and where (time zone) it renders
                    suppressHydrationWarning
                    className={cn(
                        "cursor-default whitespace-nowrap underline decoration-dashed decoration-muted-foreground/60 underline-offset-4",
                        className
                    )}
                >
                    {isAbsolute ? local : relative}
                </time>
            </TooltipTrigger>
            <TooltipContent side="top">
                <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 py-0.5">
                    {isAbsolute ? (
                        <>
                            <span className="opacity-70">
                                {t("timestampRelative")}
                            </span>
                            <span className="whitespace-nowrap">
                                {relative}
                            </span>
                        </>
                    ) : (
                        <>
                            <span className="opacity-70">
                                {t("timestampLocal")}
                            </span>
                            <span className="whitespace-nowrap">{local}</span>
                        </>
                    )}
                    <span className="opacity-70">{t("timestampUtc")}</span>
                    <span className="whitespace-nowrap">{utc}</span>
                </div>
            </TooltipContent>
        </Tooltip>
    );
}

const TIMESTAMP_PLACEHOLDER = "\u0000timestamp\u0000";

/**
 * Puts a Timestamp inside a translated sentence. Pass the translation
 * function result with TIMESTAMP_PLACEHOLDER as the date value, e.g.
 * `<TimestampInText text={t("lastUsed", { date: TIMESTAMP_PLACEHOLDER })} ... />`
 */
export function TimestampInText({
    text,
    ...props
}: TimestampProps & { text: string }) {
    const [before, ...rest] = text.split(TIMESTAMP_PLACEHOLDER);
    if (rest.length === 0) {
        return <>{text}</>;
    }
    return (
        <>
            {before}
            <Timestamp {...props} />
            {rest.join("")}
        </>
    );
}

export { TIMESTAMP_PLACEHOLDER };

export default Timestamp;
