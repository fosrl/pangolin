"use client";

import { cn } from "@app/lib/cn";
import type { LauncherResource } from "@server/routers/launcher/types";
import { LauncherLabelsRow } from "./LauncherLabelsRow";
import { LauncherResourceAccess } from "./LauncherResourceAccess";
import { LauncherResourceIcon } from "./LauncherResourceIcon";
import { getLauncherResourceSelectProps } from "./useLauncherResourceAction";

type LauncherResourceCardProps = {
    resource: LauncherResource;
    showLabels: boolean;
    onSelect?: () => void;
};

export function LauncherResourceCard({
    resource,
    showLabels,
    onSelect
}: LauncherResourceCardProps) {
    const hasIcon = Boolean(resource.iconUrl);
    const clickProps = onSelect
        ? getLauncherResourceSelectProps(onSelect)
        : null;

    return (
        <div
            className={cn(
                "flex min-w-0 flex-col gap-2.5 overflow-hidden rounded-xl border border-border bg-background p-4",
                clickProps?.className
            )}
            onClick={clickProps?.onClick}
            onKeyDown={clickProps?.onKeyDown}
            role={clickProps?.role}
            tabIndex={clickProps?.tabIndex}
        >
            <div
                className={cn(
                    "flex w-full items-center",
                    hasIcon ? "gap-5" : "gap-0"
                )}
            >
                {hasIcon ? (
                    <LauncherResourceIcon
                        iconUrl={resource.iconUrl}
                        name={resource.name}
                        variant="grid"
                    />
                ) : null}

                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <div className="truncate text-sm font-semibold text-foreground">
                        {resource.name}
                    </div>
                    <LauncherResourceAccess
                        accessDisplay={resource.accessDisplay}
                        accessCopyValue={resource.accessCopyValue}
                        accessUrl={resource.accessUrl}
                        variant="grid"
                    />
                </div>
            </div>

            {showLabels && resource.labels.length > 0 ? (
                <LauncherLabelsRow labels={resource.labels} />
            ) : null}
        </div>
    );
}
