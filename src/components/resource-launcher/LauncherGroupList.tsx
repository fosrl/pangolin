"use client";

import type { LauncherActiveViewId } from "@app/lib/launcherLocalStorage";
import { launcherQueries } from "@app/lib/queries";
import type {
    LauncherGroup,
    LauncherResource,
    LauncherViewConfig
} from "@server/routers/launcher/types";
import { useInfiniteQuery } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { useEffect, useMemo, useRef } from "react";
import { LauncherEmptyState } from "./LauncherEmptyState";
import { LauncherGroupSection } from "./LauncherGroupSection";

type LauncherGroupListProps = {
    orgId: string;
    activeViewId: LauncherActiveViewId;
    config: LauncherViewConfig;
    initialGroups: LauncherGroup[];
    groupsPagination: {
        total: number;
        page: number;
        pageSize: number;
    };
    onClearFilters?: () => void;
    onResourceSelect?: (resource: LauncherResource) => void;
};

function hasActiveLauncherFilters(config: LauncherViewConfig): boolean {
    return (
        config.query.trim().length > 0 ||
        config.siteIds.length > 0 ||
        config.labelIds.length > 0
    );
}

export function LauncherGroupList({
    orgId,
    activeViewId,
    config,
    initialGroups,
    groupsPagination,
    onClearFilters,
    onResourceSelect
}: LauncherGroupListProps) {
    const loadMoreRef = useRef<HTMLDivElement | null>(null);

    const groupFilters = useMemo(
        () => ({
            query: config.query,
            groupBy: config.groupBy,
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
            ...launcherQueries.groups(orgId, groupFilters),
            ...(initialGroups.length > 0
                ? {
                      initialData: {
                          pages: [
                              {
                                  groups: initialGroups,
                                  pagination: groupsPagination
                              }
                          ],
                          pageParams: [1]
                      },
                      refetchOnMount: false as const
                  }
                : {})
        });

    const groups = data?.pages.flatMap((page) => page.groups) ?? [];

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

    if (groups.length === 0) {
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
            {groups.map((group) => (
                <LauncherGroupSection
                    key={group.groupKey}
                    orgId={orgId}
                    activeViewId={activeViewId}
                    group={group}
                    config={config}
                    onResourceSelect={onResourceSelect}
                />
            ))}
            <div ref={loadMoreRef} className="h-4" />
            {isFetchingNextPage ? (
                <div className="flex justify-center py-2">
                    <Loader2 className="size-4 animate-spin text-muted-foreground" />
                </div>
            ) : null}
        </div>
    );
}
