"use client";

import {
    Tooltip,
    TooltipContent,
    TooltipTrigger
} from "@app/components/ui/tooltip";
import { durationToMs } from "@app/lib/durationToMs";
import { useFormatter, useNow, useTranslations } from "next-intl";

/** "Last synced: 5 minutes ago", or the full date when it's more than a day old. */
export default function IdpLastSyncedAt({
    lastSyncedAt
}: {
    /** ms since epoch, `null` when the org was never synced. */
    lastSyncedAt: number | null;
}) {
    const t = useTranslations();
    const format = useFormatter();
    // re-render every minute so "x minutes ago" stays current
    let now = useNow({ updateInterval: durationToMs(1, "minutes") });

    if (!lastSyncedAt) {
        return (
            <p className="text-sm text-muted-foreground">
                {t("idpNeverSynced")}
            </p>
        );
    }

    const date = new Date(lastSyncedAt);
    const fullDate = format.dateTime(date, {
        dateStyle: "medium",
        timeStyle: "short"
    });

    // this is to prevent showing dates `in the future`,
    // if a sync was just run, this will say `now` instead of `in 15 seconds`
    // because now is not up to date
    if (now < date) {
        now = new Date();
    }

    const isRelative =
        Math.abs(now.getTime() - lastSyncedAt) < durationToMs(24, "hours");

    return (
        <p className="text-sm text-muted-foreground">
            {t.rich("idpLastSyncedAt", {
                date: isRelative ? format.relativeTime(date, now) : fullDate,
                // the full date on hover when the time is relative
                time: (chunks) =>
                    isRelative ? (
                        <Tooltip>
                            <TooltipTrigger asChild>
                                <time
                                    dateTime={date.toISOString()}
                                    className="cursor-help underline decoration-dotted underline-offset-2"
                                >
                                    {chunks}
                                </time>
                            </TooltipTrigger>
                            <TooltipContent>{fullDate}</TooltipContent>
                        </Tooltip>
                    ) : (
                        <time dateTime={date.toISOString()}>{chunks}</time>
                    )
            })}
        </p>
    );
}
