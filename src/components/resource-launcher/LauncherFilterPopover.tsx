"use client";

import {
    formatMultiSitesSelectorLabel,
    MultiSitesSelector
} from "@app/components/multi-site-selector";
import {
    formatLabelsSelectorLabel,
    LABEL_COLORS,
    type SelectedLabel
} from "@app/components/labels-selector";
import { LabelsFilterSelector } from "@app/components/LabelsFilterSelector";
import { Badge } from "@app/components/ui/badge";
import { Button } from "@app/components/ui/button";
import {
    Popover,
    PopoverContent,
    PopoverTrigger
} from "@app/components/ui/popover";
import { cn } from "@app/lib/cn";
import { launcherQueries } from "@app/lib/queries";
import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { ChevronsUpDown, Funnel } from "lucide-react";
import { useMemo, useState } from "react";
import type { Selectedsite } from "@app/components/site-selector";

type LauncherFilterPopoverProps = {
    orgId: string;
    selectedSites: Selectedsite[];
    selectedLabels: SelectedLabel[];
    onSitesChange: (sites: Selectedsite[]) => void;
    onLabelsChange: (labels: SelectedLabel[]) => void;
};

export function LauncherFilterPopover({
    orgId,
    selectedSites,
    selectedLabels,
    onSitesChange,
    onLabelsChange
}: LauncherFilterPopoverProps) {
    const t = useTranslations();
    const [sitesOpen, setSitesOpen] = useState(false);
    const [labelsOpen, setLabelsOpen] = useState(false);

    const { data: labels = [] } = useQuery(
        launcherQueries.labels({
            orgId,
            perPage: 20
        })
    );

    const { data: sites = [] } = useQuery(
        launcherQueries.sites({
            orgId,
            perPage: 20
        })
    );

    const resolvedSelectedSites: Selectedsite[] = useMemo(
        () =>
            selectedSites.map((selected) => {
                const found = sites.find(
                    (site) => site.siteId === selected.siteId
                );
                return found
                    ? {
                          siteId: found.siteId,
                          name: found.name,
                          type: found.type,
                          online: found.online
                      }
                    : selected;
            }),
        [sites, selectedSites]
    );

    const selectedLabelIds = useMemo(
        () => new Set(selectedLabels.map((label) => label.labelId)),
        [selectedLabels]
    );

    const resolvedSelectedLabels: SelectedLabel[] = useMemo(
        () =>
            selectedLabels.map((selected) => {
                const found = labels.find(
                    (label) => label.labelId === selected.labelId
                );
                return (
                    found ?? {
                        ...selected,
                        color: selected.color || LABEL_COLORS.gray
                    }
                );
            }),
        [labels, selectedLabels]
    );

    const activeFilterCount = selectedSites.length + selectedLabels.length;

    return (
        <Popover modal={false}>
            <PopoverTrigger asChild>
                <Button
                    variant="outline"
                    size="icon"
                    className="relative shrink-0"
                >
                    <Funnel className="size-4" />
                    <span className="sr-only">
                        {activeFilterCount > 0
                            ? t("resourceLauncherFilterWithCount", {
                                  count: activeFilterCount
                              })
                            : t("resourceLauncherFilter")}
                    </span>
                    {activeFilterCount > 0 && (
                        <Badge
                            variant="secondary"
                            className="absolute -top-1 -right-1 flex h-5 min-w-5 items-center justify-center px-1.5 text-xs"
                        >
                            {activeFilterCount > 99 ? "99+" : activeFilterCount}
                        </Badge>
                    )}
                </Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-72">
                <div className="flex flex-col gap-4">
                    <div className="space-y-2">
                        <p className="text-sm font-semibold">{t("sites")}</p>
                        <Popover open={sitesOpen} onOpenChange={setSitesOpen}>
                            <PopoverTrigger asChild>
                                <Button
                                    variant="outline"
                                    role="combobox"
                                    className={cn(
                                        "w-full justify-between font-normal",
                                        selectedSites.length === 0 &&
                                            "text-muted-foreground"
                                    )}
                                >
                                    <span className="truncate text-left">
                                        {formatMultiSitesSelectorLabel(
                                            resolvedSelectedSites,
                                            t
                                        )}
                                    </span>
                                    <ChevronsUpDown className="ml-2 size-4 shrink-0 opacity-50" />
                                </Button>
                            </PopoverTrigger>
                            <PopoverContent
                                className="w-[var(--radix-popover-trigger-width)] p-0"
                                align="start"
                            >
                                <MultiSitesSelector
                                    orgId={orgId}
                                    selectedSites={resolvedSelectedSites}
                                    onSelectionChange={onSitesChange}
                                    scope="launcher"
                                    showClear={selectedSites.length > 0}
                                    onClear={() => {
                                        onSitesChange([]);
                                    }}
                                />
                            </PopoverContent>
                        </Popover>
                    </div>
                    <div className="space-y-2">
                        <p className="text-sm font-semibold">{t("labels")}</p>
                        <Popover open={labelsOpen} onOpenChange={setLabelsOpen}>
                            <PopoverTrigger asChild>
                                <Button
                                    variant="outline"
                                    role="combobox"
                                    className={cn(
                                        "w-full justify-between font-normal",
                                        selectedLabels.length === 0 &&
                                            "text-muted-foreground"
                                    )}
                                >
                                    <span className="truncate text-left">
                                        {formatLabelsSelectorLabel(
                                            resolvedSelectedLabels,
                                            t
                                        )}
                                    </span>
                                    <ChevronsUpDown className="ml-2 size-4 shrink-0 opacity-50" />
                                </Button>
                            </PopoverTrigger>
                            <PopoverContent
                                className="w-[var(--radix-popover-trigger-width)] p-0"
                                align="start"
                            >
                                <LabelsFilterSelector
                                    orgId={orgId}
                                    scope="launcher"
                                    selectedLabels={resolvedSelectedLabels}
                                    isSelected={(label) =>
                                        selectedLabelIds.has(label.labelId)
                                    }
                                    onToggle={(label) => {
                                        if (
                                            selectedLabelIds.has(label.labelId)
                                        ) {
                                            onLabelsChange(
                                                selectedLabels.filter(
                                                    (item) =>
                                                        item.labelId !==
                                                        label.labelId
                                                )
                                            );
                                        } else {
                                            onLabelsChange([
                                                ...selectedLabels,
                                                label
                                            ]);
                                        }
                                    }}
                                    showClear={selectedLabels.length > 0}
                                    onClear={() => {
                                        onLabelsChange([]);
                                    }}
                                />
                            </PopoverContent>
                        </Popover>
                    </div>
                </div>
            </PopoverContent>
        </Popover>
    );
}
