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
     * "duration" shows how long until a future time ("2 years", for a column
     * like "Valid Until"); past times fall back to "relative".
     */
    display?: "relative" | "absolute" | "duration";
};

// Same unit thresholds next-intl's relativeTime uses (in seconds)
const DURATION_UNITS = [
    { unit: "second", seconds: 1, below: 60 },
    { unit: "minute", seconds: 60, below: 60 * 60 },
    { unit: "hour", seconds: 60 * 60, below: 60 * 60 * 24 },
    { unit: "day", seconds: 60 * 60 * 24, below: 60 * 60 * 24 * 7 },
    {
        unit: "week",
        seconds: 60 * 60 * 24 * 7,
        below: (60 * 60 * 24 * 365) / 12
    },
    {
        unit: "month",
        seconds: (60 * 60 * 24 * 365) / 12,
        below: 60 * 60 * 24 * 365
    },
    { unit: "year", seconds: 60 * 60 * 24 * 365, below: Infinity }
] as const;

/** The unit and rounded amount for a span of time, e.g. { 2, "year" }. */
function durationParts(ms: number) {
    const seconds = Math.abs(ms) / 1000;
    const { unit, seconds: size } = DURATION_UNITS.find(
        (u) => seconds < u.below
    )!;
    return { value: Math.round(seconds / size), unit };
}

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
    const showDuration =
        display === "duration" && date.getTime() > now.getTime();
    let inline = isAbsolute ? local : relative;
    if (showDuration) {
        const { value, unit } = durationParts(date.getTime() - now.getTime());
        inline = format.number(value, {
            style: "unit",
            unit,
            unitDisplay: "long"
        });
    }

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
                    {inline}
                </time>
            </TooltipTrigger>
            <TooltipContent side="top">
                <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 py-0.5">
                    {isAbsolute || showDuration ? (
                        <>
                            <span className="opacity-70">
                                {t("timestampRelative")}
                            </span>
                            <span className="whitespace-nowrap">
                                {relative}
                            </span>
                        </>
                    ) : null}
                    {isAbsolute ? null : (
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
    textClassName,
    ...props
}: TimestampProps & {
    text: string;
    /** Styles the words around the timestamp, not the timestamp itself */
    textClassName?: string;
}) {
    const [before, ...rest] = text.split(TIMESTAMP_PLACEHOLDER);
    const after = rest.join("");
    if (rest.length === 0) {
        return <span className={textClassName}>{text}</span>;
    }
    return (
        <>
            {before && <span className={textClassName}>{before}</span>}
            <Timestamp {...props} />
            {after && <span className={textClassName}>{after}</span>}
        </>
    );
}

export { TIMESTAMP_PLACEHOLDER };

export default Timestamp;
