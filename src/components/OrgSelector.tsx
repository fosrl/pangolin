"use client";

import { OrgPicker } from "@app/components/OrgPicker";
import {
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger
} from "@app/components/ui/tooltip";
import { cn } from "@app/lib/cn";
import { ListUserOrgsResponse } from "@server/routers/org";
import { Building2, ChevronsUpDown } from "lucide-react";
import { useTranslations } from "next-intl";

type OrgSelectorProps = {
    orgId?: string;
    orgs?: ListUserOrgsResponse["orgs"];
    isCollapsed?: boolean;
};

export function OrgSelector({
    orgId,
    orgs,
    isCollapsed = false
}: OrgSelectorProps) {
    const t = useTranslations();
    const selectedOrg = orgs?.find((org) => org.orgId === orgId);

    const picker = (
        <OrgPicker
            orgId={orgId}
            orgs={orgs}
            contentClassName={
                isCollapsed
                    ? "w-[320px]"
                    : "w-[var(--radix-popover-trigger-width)]"
            }
        >
            <div
                role="combobox"
                className={cn(
                    "cursor-pointer transition-colors",
                    isCollapsed
                        ? "w-full h-16 flex items-center justify-center hover:bg-sidebar-accent dark:hover:bg-sidebar-accent/50"
                        : "w-full px-5 py-4 hover:bg-sidebar-accent dark:hover:bg-sidebar-accent/50"
                )}
            >
                {isCollapsed ? (
                    <Building2 className="h-4 w-4" />
                ) : (
                    <div className="flex items-center justify-between w-full min-w-0">
                        <div className="flex items-center min-w-0 flex-1">
                            <div className="flex flex-col items-start min-w-0 flex-1 gap-1">
                                <span className="font-semibold">
                                    {t("org")}
                                </span>
                                <span className="text-sm text-muted-foreground truncate w-full text-left">
                                    {selectedOrg?.name || t("noneSelected")}
                                </span>
                            </div>
                        </div>
                        <ChevronsUpDown className="h-4 w-4 shrink-0 opacity-50 ml-2" />
                    </div>
                )}
            </div>
        </OrgPicker>
    );

    if (isCollapsed) {
        return (
            <TooltipProvider>
                <Tooltip>
                    <TooltipTrigger asChild>{picker}</TooltipTrigger>
                    <TooltipContent side="right" sideOffset={8}>
                        <div className="text-center">
                            <p className="font-medium">
                                {selectedOrg?.name || t("noneSelected")}
                            </p>
                            <p className="text-xs text-muted-foreground">
                                {t("org")}
                            </p>
                        </div>
                    </TooltipContent>
                </Tooltip>
            </TooltipProvider>
        );
    }

    return picker;
}
