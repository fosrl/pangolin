"use client";

import type { LauncherResource } from "@server/routers/launcher/types";
import { LauncherResourceRow } from "./LauncherResourceRow";

type LauncherResourceListProps = {
    resources: LauncherResource[];
    showLabels: boolean;
    onResourceSelect?: (resource: LauncherResource) => void;
};

export function LauncherResourceList({
    resources,
    showLabels,
    onResourceSelect
}: LauncherResourceListProps) {
    return (
        <div className="w-full max-md:overflow-x-auto max-md:overflow-y-hidden">
            <div className="flex w-full flex-col max-md:w-max">
                {resources.map((resource, index) => (
                    <LauncherResourceRow
                        key={resource.launcherResourceKey}
                        resource={resource}
                        showLabels={showLabels}
                        isLast={index === resources.length - 1}
                        onSelect={
                            onResourceSelect
                                ? () => onResourceSelect(resource)
                                : undefined
                        }
                    />
                ))}
            </div>
        </div>
    );
}
