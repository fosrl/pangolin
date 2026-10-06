"use client";

import { isSafeUrlForLink } from "@app/lib/launcherResourceAccess";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { LauncherCopyIcon } from "./LauncherCopyIcon";

type LauncherResourceAccessProps = {
    accessDisplay: string;
    accessCopyValue: string;
    accessUrl?: string | null;
    mode?: string;
    variant: "grid" | "list";
};

export function LauncherResourceAccess({
    accessDisplay,
    accessCopyValue,
    accessUrl,
    mode,
    variant
}: LauncherResourceAccessProps) {
    const t = useTranslations();
    const isExitNode = mode === "gateway";
    const display = isExitNode
        ? t("resourceLauncherAllInternetTraffic")
        : accessDisplay;

    if (!display) {
        return null;
    }

    const href = accessUrl ?? undefined;
    const canLink = !isExitNode && href && isSafeUrlForLink(href);
    const copyValue = canLink ? href : accessCopyValue;
    const showCopy = !isExitNode && Boolean(copyValue);

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
                        {display}
                    </Link>
                ) : (
                    <span className="min-w-0 truncate text-sm text-muted-foreground max-md:overflow-visible max-md:whitespace-nowrap">
                        {display}
                    </span>
                )}
                {showCopy ? <LauncherCopyIcon text={copyValue} /> : null}
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
                    {display}
                </Link>
            ) : (
                <span className="min-w-0 flex-1 truncate text-sm text-muted-foreground">
                    {display}
                </span>
            )}
            {showCopy ? <LauncherCopyIcon text={copyValue} /> : null}
        </div>
    );
}
