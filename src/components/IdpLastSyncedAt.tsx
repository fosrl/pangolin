"use client";

import {
    Tooltip,
    TooltipContent,
    TooltipTrigger
} from "@app/components/ui/tooltip";
import { useFormatter, useNow, useTranslations } from "next-intl";

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

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
    const now = useNow({ updateInterval: 60_000 });

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
    const isRelative = now.getTime() - lastSyncedAt < ONE_DAY_MS;

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
