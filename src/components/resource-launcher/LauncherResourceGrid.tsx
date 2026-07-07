"use client";

import type { LauncherResource } from "@server/routers/launcher/types";
import { LauncherResourceCard } from "./LauncherResourceCard";

type LauncherResourceGridProps = {
    resources: LauncherResource[];
    showLabels: boolean;
    onResourceSelect?: (resource: LauncherResource) => void;
};

export function LauncherResourceGrid({
    resources,
    showLabels,
    onResourceSelect
}: LauncherResourceGridProps) {
    return (
        <div className="grid w-full grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 [&>*]:min-w-0">
            {resources.map((resource) => (
                <LauncherResourceCard
                    key={resource.launcherResourceKey}
                    resource={resource}
                    showLabels={showLabels}
                    onSelect={
                        onResourceSelect
                            ? () => onResourceSelect(resource)
                            : undefined
                    }
                />
            ))}
        </div>
    );
}
