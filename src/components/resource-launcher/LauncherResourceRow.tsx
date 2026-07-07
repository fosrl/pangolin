"use client";

import { cn } from "@app/lib/cn";
import type { LauncherResource } from "@server/routers/launcher/types";
import { LauncherLabelsRow } from "./LauncherLabelsRow";
import { LauncherResourceAccess } from "./LauncherResourceAccess";
import { LauncherResourceIcon } from "./LauncherResourceIcon";
import { getLauncherResourceSelectProps } from "./useLauncherResourceAction";

type LauncherResourceRowProps = {
    resource: LauncherResource;
    showLabels: boolean;
    isLast?: boolean;
    onSelect?: () => void;
};

export function LauncherResourceRow({
    resource,
    showLabels,
    isLast = false,
    onSelect
}: LauncherResourceRowProps) {
    const hasTags = showLabels && resource.labels.length > 0;
    const clickProps = onSelect
        ? getLauncherResourceSelectProps(onSelect)
        : null;

    return (
        <div
            className={cn(
                "flex items-center gap-2.5 p-4 max-md:min-w-max max-md:whitespace-nowrap",
                isLast ? undefined : "border-b border-border",
                clickProps?.className
            )}
            onClick={clickProps?.onClick}
            onKeyDown={clickProps?.onKeyDown}
            role={clickProps?.role}
            tabIndex={clickProps?.tabIndex}
        >
            <LauncherResourceIcon
                iconUrl={resource.iconUrl}
                name={resource.name}
                variant="list"
            />

            <span className="shrink-0 text-sm font-semibold text-foreground">
                {resource.name}
            </span>

            <LauncherResourceAccess
                accessDisplay={resource.accessDisplay}
                accessCopyValue={resource.accessCopyValue}
                accessUrl={resource.accessUrl}
                variant="list"
            />

            {hasTags ? (
                <div className="flex min-w-0 max-w-md shrink items-center justify-end gap-1 max-md:shrink-0 max-md:max-w-none md:ml-auto">
                    <LauncherLabelsRow
                        labels={resource.labels}
                        variant="single-row"
                        className="w-auto shrink-0 justify-end"
                    />
                </div>
            ) : null}
        </div>
    );
}
