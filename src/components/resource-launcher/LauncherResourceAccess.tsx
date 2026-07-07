"use client";

import { isSafeUrlForLink } from "@app/lib/launcherResourceAccess";
import Link from "next/link";
import { LauncherCopyIcon } from "./LauncherCopyIcon";

type LauncherResourceAccessProps = {
    accessDisplay: string;
    accessCopyValue: string;
    accessUrl?: string | null;
    variant: "grid" | "list";
};

export function LauncherResourceAccess({
    accessDisplay,
    accessCopyValue,
    accessUrl,
    variant
}: LauncherResourceAccessProps) {
    if (!accessDisplay) {
        return null;
    }

    const href = accessUrl ?? undefined;
    const canLink = href && isSafeUrlForLink(href);
    const copyValue = canLink ? href : accessCopyValue;

    if (variant === "list") {
        return (
            <div className="flex min-w-0 flex-1 items-center gap-2.5 max-md:min-w-[12rem] max-md:shrink-0 max-md:flex-none">
                {canLink ? (
                    <Link
                        href={href}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="min-w-0 truncate text-sm text-muted-foreground hover:underline max-md:overflow-visible max-md:whitespace-nowrap"
                    >
                        {accessDisplay}
                    </Link>
                ) : (
                    <span className="min-w-0 truncate text-sm text-muted-foreground max-md:overflow-visible max-md:whitespace-nowrap">
                        {accessDisplay}
                    </span>
                )}
                <LauncherCopyIcon text={copyValue} />
            </div>
        );
    }

    return (
        <div className="flex w-full min-w-0 items-center gap-2.5">
            {canLink ? (
                <Link
                    href={href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="min-w-0 flex-1 truncate text-sm text-muted-foreground hover:underline"
                >
                    {accessDisplay}
                </Link>
            ) : (
                <span className="min-w-0 flex-1 truncate text-sm text-muted-foreground">
                    {accessDisplay}
                </span>
            )}
            <LauncherCopyIcon text={copyValue} />
        </div>
    );
}
