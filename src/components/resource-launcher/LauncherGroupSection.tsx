"use client";

import {
    Collapsible,
    CollapsibleContent
} from "@app/components/ui/collapsible";
import { cn } from "@app/lib/cn";
import {
    readLauncherGroupOpen,
    writeLauncherGroupOpen,
    type LauncherActiveViewId
} from "@app/lib/launcherLocalStorage";
import { launcherQueries } from "@app/lib/queries";
import type {
    LauncherGroup,
    LauncherResource,
    LauncherViewConfig
} from "@server/routers/launcher/types";
import {
    LAUNCHER_NO_SITE_GROUP_KEY,
    LAUNCHER_UNLABELED_GROUP_KEY
} from "@server/routers/launcher/types";
import { useInfiniteQuery } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { LauncherGroupTrigger } from "./LauncherGroupTrigger";
import { LauncherResourceGrid } from "./LauncherResourceGrid";
import { LauncherResourceList } from "./LauncherResourceList";

type LauncherGroupSectionProps = {
    orgId: string;
    activeViewId: LauncherActiveViewId;
    group: LauncherGroup;
    config: LauncherViewConfig;
    initialResources?: LauncherResource[];
    initialResourcesPagination?: {
        total: number;
        page: number;
        pageSize: number;
    };
    defaultOpen?: boolean;
    onResourceSelect?: (resource: LauncherResource) => void;
};

export function LauncherGroupSection({
    orgId,
    activeViewId,
    group,
    config,
    initialResources,
    initialResourcesPagination,
    defaultOpen = true,
    onResourceSelect
}: LauncherGroupSectionProps) {
    const t = useTranslations();
    const loadMoreRef = useRef<HTMLDivElement | null>(null);
    const [isOpen, setIsOpen] = useState(() =>
        readLauncherGroupOpen(
            orgId,
            activeViewId,
            config.groupBy,
            group.groupKey,
            defaultOpen
        )
    );

    useEffect(() => {
        setIsOpen(
            readLauncherGroupOpen(
                orgId,
                activeViewId,
                config.groupBy,
                group.groupKey,
                defaultOpen
            )
        );
    }, [activeViewId, config.groupBy, defaultOpen, group.groupKey, orgId]);

    const handleOpenChange = (open: boolean) => {
        setIsOpen(open);
        writeLauncherGroupOpen(
            orgId,
            activeViewId,
            config.groupBy,
            group.groupKey,
            open
        );
    };

    const hasInitialResources = initialResources !== undefined;

    const { data, fetchNextPage, hasNextPage, isFetchingNextPage, isLoading } =
        useInfiniteQuery({
            ...launcherQueries.resources(orgId, {
                query: config.query,
                groupBy: config.groupBy,
                groupKey: group.groupKey,
                siteIds: config.siteIds,
                labelIds: config.labelIds,
                sort_by: config.sortBy,
                order: config.order,
                pageSize: 20
            }),
            enabled: isOpen,
            refetchOnMount: false,
            ...(hasInitialResources
                ? {
                      initialData: {
                          pages: [
                              {
                                  resources: initialResources,
                                  pagination: initialResourcesPagination ?? {
                                      total: initialResources.length,
                                      page: 1,
                                      pageSize: 20
                                  }
                              }
                          ],
                          pageParams: [1]
                      }
                  }
                : {})
        });

    const resources = data?.pages.flatMap((page) => page.resources) ?? [];
    const showInitialLoader = isLoading && resources.length === 0;

    useEffect(() => {
        const node = loadMoreRef.current;
        if (!node || !hasNextPage || !isOpen) {
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
    }, [fetchNextPage, hasNextPage, isFetchingNextPage, isOpen]);

    const groupTitle =
        group.groupKey === LAUNCHER_UNLABELED_GROUP_KEY
            ? t("resourceLauncherUnlabeled")
            : group.groupKey === LAUNCHER_NO_SITE_GROUP_KEY
              ? t("resourceLauncherNoSite")
              : group.name;

    return (
        <Collapsible
            open={isOpen}
            onOpenChange={handleOpenChange}
            className="flex w-full flex-col gap-2.5"
        >
            <LauncherGroupTrigger
                group={group}
                title={groupTitle}
                isOpen={isOpen}
            />

            <CollapsibleContent className="w-full">
                {showInitialLoader ? (
                    <div className="flex items-center justify-center py-10 text-muted-foreground">
                        <Loader2 className="size-5 animate-spin" />
                    </div>
                ) : resources.length === 0 ? (
                    <p className="py-4 text-sm text-muted-foreground">
                        {t("resourceLauncherNoResourcesInGroup")}
                    </p>
                ) : config.layout === "grid" ? (
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
                <div
                    ref={loadMoreRef}
                    className={cn("h-4", !hasNextPage && "hidden")}
                />
                {isFetchingNextPage ? (
                    <div className="flex justify-center py-2">
                        <Loader2 className="size-4 animate-spin text-muted-foreground" />
                    </div>
                ) : null}
            </CollapsibleContent>
        </Collapsible>
    );
}
