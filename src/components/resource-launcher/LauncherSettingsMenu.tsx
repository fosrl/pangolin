"use client";

import { Button } from "@app/components/ui/button";
import { Label } from "@app/components/ui/label";
import {
    Popover,
    PopoverContent,
    PopoverTrigger
} from "@app/components/ui/popover";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue
} from "@app/components/ui/select";
import { Switch } from "@app/components/ui/switch";
import type {
    LauncherScaleCapabilities,
    LauncherViewConfig
} from "@server/routers/launcher/types";
import { useTranslations } from "next-intl";
import { Settings } from "lucide-react";

type LauncherSettingsMenuProps = {
    config: LauncherViewConfig;
    capabilities: LauncherScaleCapabilities;
    isCompactMode: boolean;
    selectedGroupBy: LauncherViewConfig["groupBy"];
    onConfigChange: (patch: Partial<LauncherViewConfig>) => void;
};

export function LauncherSettingsMenu({
    config,
    capabilities,
    isCompactMode,
    selectedGroupBy,
    onConfigChange
}: LauncherSettingsMenuProps) {
    const t = useTranslations();

    return (
        <Popover>
            <PopoverTrigger asChild>
                <Button variant="outline" size="icon" className="shrink-0">
                    <Settings className="size-4" />
                    <span className="sr-only">
                        {t("resourceLauncherSettings")}
                    </span>
                </Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-72">
                <div className="flex flex-col gap-4">
                    <div className="space-y-2">
                        <p className="text-sm font-semibold">
                            {t("resourceLauncherGroupBy")}
                        </p>
                        <Select
                            value={selectedGroupBy}
                            onValueChange={(value) =>
                                onConfigChange({
                                    groupBy:
                                        value as LauncherViewConfig["groupBy"]
                                })
                            }
                        >
                            <SelectTrigger className="w-full">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="none">
                                    {t("resourceLauncherGroupByNone")}
                                </SelectItem>
                                <SelectItem
                                    value="site"
                                    disabled={
                                        !capabilities.allowSiteGrouping ||
                                        (isCompactMode &&
                                            config.siteIds.length === 0)
                                    }
                                >
                                    {t("resourceLauncherGroupBySite")}
                                </SelectItem>
                                <SelectItem
                                    value="label"
                                    disabled={
                                        !capabilities.allowLabelGrouping ||
                                        (isCompactMode &&
                                            config.labelIds.length === 0)
                                    }
                                >
                                    {t("resourceLauncherGroupByLabel")}
                                </SelectItem>
                            </SelectContent>
                        </Select>
                        {isCompactMode ? (
                            <p className="text-xs text-muted-foreground">
                                {t("resourceLauncherCompactGroupingHint")}
                            </p>
                        ) : null}
                        {!isCompactMode && !capabilities.allowSiteGrouping ? (
                            <p className="text-xs text-muted-foreground">
                                {t("resourceLauncherSiteGroupingDisabled")}
                            </p>
                        ) : null}
                        {!isCompactMode && !capabilities.allowLabelGrouping ? (
                            <p className="text-xs text-muted-foreground">
                                {t("resourceLauncherLabelGroupingDisabled")}
                            </p>
                        ) : null}
                    </div>

                    <div className="space-y-2">
                        <p className="text-sm font-semibold">
                            {t("resourceLauncherLayout")}
                        </p>
                        <Select
                            value={config.layout}
                            onValueChange={(value) =>
                                onConfigChange({
                                    layout: value as LauncherViewConfig["layout"]
                                })
                            }
                        >
                            <SelectTrigger className="w-full">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="grid">
                                    {t("resourceLauncherLayoutGrid")}
                                </SelectItem>
                                <SelectItem value="list">
                                    {t("resourceLauncherLayoutList")}
                                </SelectItem>
                            </SelectContent>
                        </Select>
                    </div>

                    <div className="flex flex-col gap-3">
                        <div className="flex items-center justify-between gap-3">
                            <Label
                                htmlFor="show-labels"
                                className="text-sm font-semibold"
                            >
                                {t("resourceLauncherShowLabels")}
                            </Label>
                            <Switch
                                id="show-labels"
                                checked={config.showLabels}
                                onCheckedChange={(checked) =>
                                    onConfigChange({ showLabels: checked })
                                }
                            />
                        </div>
                    </div>
                </div>
            </PopoverContent>
        </Popover>
    );
}
