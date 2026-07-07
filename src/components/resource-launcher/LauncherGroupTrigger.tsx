"use client";

import { CollapsibleTrigger } from "@app/components/ui/collapsible";
import type { LauncherGroup } from "@server/routers/launcher/types";
import { ChevronDown, ChevronLeft } from "lucide-react";

type LauncherGroupTriggerProps = {
    group: LauncherGroup;
    title: string;
    isOpen: boolean;
};

function LauncherGroupStatusDot({ group }: { group: LauncherGroup }) {
    if (group.groupType === "label") {
        return (
            <span
                className="size-2 shrink-0 rounded-full"
                style={{ backgroundColor: group.labelColor }}
            />
        );
    }

    if (group.groupType === "site") {
        if (
            (group.siteType === "newt" || group.siteType === "wireguard") &&
            typeof group.siteOnline === "boolean"
        ) {
            return (
                <span
                    className={
                        group.siteOnline
                            ? "size-2 shrink-0 rounded-full bg-green-500"
                            : "size-2 shrink-0 rounded-full bg-neutral-500"
                    }
                />
            );
        }

        return <span className="size-2 shrink-0 rounded-full bg-neutral-500" />;
    }

    return null;
}

export function LauncherGroupTrigger({
    group,
    title,
    isOpen
}: LauncherGroupTriggerProps) {
    return (
        <CollapsibleTrigger className="flex w-full items-center gap-2.5 rounded-md bg-accent px-4 py-2.5 text-left transition-colors cursor-pointer">
            {group.groupType === "site" || group.groupType === "label" ? (
                <LauncherGroupStatusDot group={group} />
            ) : null}
            <span className="flex min-w-0 items-center gap-2.5 text-sm font-semibold text-foreground">
                <span className="truncate">
                    {title} ({group.itemCount})
                </span>
                {isOpen ? (
                    <ChevronDown className="size-4 shrink-0 text-muted-foreground" />
                ) : (
                    <ChevronLeft className="size-4 shrink-0 text-muted-foreground" />
                )}
            </span>
        </CollapsibleTrigger>
    );
}
