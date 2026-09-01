"use client";

import {
    SettingsSection,
    SettingsSectionBody,
    SettingsSectionDescription,
    SettingsSectionHeader,
    SettingsSectionTitle
} from "@app/components/Settings";
import { Button } from "@app/components/ui/button";
import { cn } from "@app/lib/cn";
import { launcherQueries } from "@app/lib/queries";
import { useQuery } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useLayoutEffect, useRef, useState } from "react";

const COLLAPSED_ROWS = 5;
const GRID_COLUMNS = 2;

type LauncherInferenceModelsSectionProps = {
    orgId: string;
    params:
        | {
              resourceType: "public";
              resourceId: number;
          }
        | {
              resourceType: "site";
              siteResourceId: number;
          };
};

export function LauncherInferenceModelsSection({
    orgId,
    params
}: LauncherInferenceModelsSectionProps) {
    const t = useTranslations();
    const { data, isPending, isError } = useQuery(
        launcherQueries.aiModels(orgId, params)
    );
    const models = data?.models ?? [];
    const [listExpanded, setListExpanded] = useState(false);
    const [clipHeight, setClipHeight] = useState<number | null>(null);
    const gridRef = useRef<HTMLDivElement>(null);

    const collapsedLimit = GRID_COLUMNS * COLLAPSED_ROWS;
    const hasOverflow = models.length > collapsedLimit;
    const isCollapsed = hasOverflow && !listExpanded;

    useEffect(() => {
        if (!hasOverflow) {
            setListExpanded(false);
        }
    }, [hasOverflow]);

    useLayoutEffect(() => {
        if (!isCollapsed || !gridRef.current) {
            setClipHeight(null);
            return;
        }

        const children = Array.from(gridRef.current.children) as HTMLElement[];
        const lastVisible = children[collapsedLimit - 1];
        if (!lastVisible) {
            setClipHeight(null);
            return;
        }

        const gridTop = gridRef.current.getBoundingClientRect().top;
        const cardBottom = lastVisible.getBoundingClientRect().bottom;
        // Peek slightly into the next row so the fade has content to soften.
        setClipHeight(cardBottom - gridTop + 12);
    }, [isCollapsed, collapsedLimit, models]);

    return (
        <SettingsSection>
            <SettingsSectionHeader>
                <SettingsSectionTitle>
                    {t("resourceLauncherAvailableModels")}
                </SettingsSectionTitle>
                <SettingsSectionDescription>
                    {t("resourceLauncherAvailableModelsDescription")}
                </SettingsSectionDescription>
            </SettingsSectionHeader>
            <SettingsSectionBody>
                {isPending ? (
                    <div className="flex items-center justify-center py-6 text-muted-foreground">
                        <Loader2 className="size-5 animate-spin" />
                    </div>
                ) : null}
                {isError ? (
                    <p className="text-sm text-muted-foreground">
                        {t("resourceLauncherAvailableModelsError")}
                    </p>
                ) : null}
                {!isPending && !isError && models.length === 0 ? (
                    <p className="text-sm text-muted-foreground">
                        {t("resourceLauncherAvailableModelsEmpty")}
                    </p>
                ) : null}
                {!isPending && !isError && models.length > 0 ? (
                    <div>
                        <div className="relative">
                            <div
                                ref={gridRef}
                                className={cn(
                                    "grid grid-cols-2 gap-2",
                                    isCollapsed && "overflow-hidden"
                                )}
                                style={
                                    isCollapsed && clipHeight != null
                                        ? { maxHeight: clipHeight }
                                        : undefined
                                }
                            >
                                {models.map((model) => (
                                    <div
                                        key={model.modelId}
                                        className="flex min-w-0 flex-col gap-0.5 rounded-md border border-input px-2.5 py-2"
                                    >
                                        <span className="block truncate font-mono text-xs font-medium">
                                            {model.modelKey}
                                        </span>
                                        {model.providerName ? (
                                            <span className="block truncate text-xs text-muted-foreground">
                                                {model.providerName}
                                            </span>
                                        ) : null}
                                    </div>
                                ))}
                            </div>
                            {isCollapsed ? (
                                <div className="pointer-events-none absolute inset-x-0 bottom-0 h-14 bg-gradient-to-t from-card from-25% via-card/80 to-transparent" />
                            ) : null}
                        </div>
                        {isCollapsed ? (
                            <div className="relative z-10 flex justify-center pt-2">
                                <Button
                                    type="button"
                                    variant="text"
                                    size="sm"
                                    className="bg-card px-2 text-muted-foreground hover:text-foreground"
                                    onClick={() => setListExpanded(true)}
                                >
                                    {t("aiProviderModelsViewMore", {
                                        count: models.length - collapsedLimit
                                    })}
                                </Button>
                            </div>
                        ) : null}
                        {hasOverflow && listExpanded ? (
                            <div className="flex justify-center pt-1">
                                <Button
                                    type="button"
                                    variant="text"
                                    size="sm"
                                    className="text-muted-foreground hover:text-foreground"
                                    onClick={() => setListExpanded(false)}
                                >
                                    {t("aiProviderModelsViewLess")}
                                </Button>
                            </div>
                        ) : null}
                    </div>
                ) : null}
            </SettingsSectionBody>
        </SettingsSection>
    );
}
