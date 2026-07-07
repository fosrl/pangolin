"use client";

import type { LauncherActiveViewId } from "@app/lib/launcherLocalStorage";
import { hasActiveLauncherFilters } from "@app/lib/launcherScale";
import { launcherQueries } from "@app/lib/queries";
import type {
    LauncherResource,
    LauncherViewConfig
} from "@server/routers/launcher/types";
import { LAUNCHER_FLAT_GROUP_KEY } from "@server/routers/launcher/types";
import { useInfiniteQuery } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { useEffect, useMemo, useRef } from "react";
import { LauncherEmptyState } from "./LauncherEmptyState";
import { LauncherResourceGrid } from "./LauncherResourceGrid";
import { LauncherResourceList } from "./LauncherResourceList";

type LauncherFlatResourceListProps = {
    orgId: string;
    activeViewId: LauncherActiveViewId;
    config: LauncherViewConfig;
    onClearFilters?: () => void;
    onResourceSelect?: (resource: LauncherResource) => void;
};

export function LauncherFlatResourceList({
    orgId,
    config,
    onClearFilters,
    onResourceSelect
}: LauncherFlatResourceListProps) {
    const loadMoreRef = useRef<HTMLDivElement | null>(null);

    const resourceFilters = useMemo(
        () => ({
            query: config.query,
            groupBy: config.groupBy,
            groupKey: LAUNCHER_FLAT_GROUP_KEY,
            siteIds: config.siteIds,
            labelIds: config.labelIds,
            sort_by: config.sortBy,
            order: config.order,
            pageSize: 20
        }),
        [
            config.groupBy,
            config.labelIds,
            config.order,
            config.query,
            config.siteIds,
            config.sortBy
        ]
    );

    const { data, fetchNextPage, hasNextPage, isFetchingNextPage, isFetching } =
        useInfiniteQuery({
            ...launcherQueries.resources(orgId, resourceFilters)
        });

    const resources = data?.pages.flatMap((page) => page.resources) ?? [];

    useEffect(() => {
        const node = loadMoreRef.current;
        if (!node || !hasNextPage) {
            return;
        }

        const observer = new IntersectionObserver(
            (entries) => {
                if (entries[0]?.isIntersecting && !isFetchingNextPage) {
                    void fetchNextPage();
                }
            },
            { rootMargin: "200px" }
        );

        observer.observe(node);
        return () => observer.disconnect();
    }, [fetchNextPage, hasNextPage, isFetchingNextPage]);

    if (resources.length === 0) {
        if (isFetching) {
            return (
                <div className="flex items-center justify-center py-16 text-muted-foreground">
                    <Loader2 className="size-6 animate-spin" />
                </div>
            );
        }

        return (
            <LauncherEmptyState
                variant={
                    hasActiveLauncherFilters(config) ? "noResults" : "empty"
                }
                layout={config.layout}
                query={config.query}
                onClearFilters={onClearFilters}
            />
        );
    }

    return (
        <div className="flex flex-col gap-2.5">
            {config.layout === "grid" ? (
                <LauncherResourceGrid
                    resources={resources}
                    showLabels={config.showLabels}
                    onResourceSelect={onResourceSelect}
                />
            ) : (
                <LauncherResourceList
                    resources={resources}
                    showLabels={config.showLabels}
                    onResourceSelect={onResourceSelect}
                />
            )}
            <div ref={loadMoreRef} className="h-4" />
            {isFetchingNextPage ? (
                <div className="flex justify-center py-2">
                    <Loader2 className="size-4 animate-spin text-muted-foreground" />
                </div>
            ) : null}
        </div>
    );
}
