"use client";

import { Button } from "@app/components/ui/button";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger
} from "@app/components/ui/dropdown-menu";
import { useTranslations } from "next-intl";
import { ChevronDown } from "lucide-react";
import { cn } from "@app/lib/cn";

type LauncherViewTabsProps = {
    activeViewId: number | "default";
    savedViews: Array<{ viewId: number; name: string }>;
    onSelectView: (viewId: number | "default") => void;
};

export function LauncherViewTabs({
    activeViewId,
    savedViews,
    onSelectView
}: LauncherViewTabsProps) {
    const t = useTranslations();

    const viewOptions: Array<{
        value: number | "default";
        label: string;
    }> = [
        { value: "default", label: t("resourceLauncherDefaultView") },
        ...savedViews.map((view) => ({
            value: view.viewId,
            label: view.name
        }))
    ];

    return (
        <div className="flex w-max items-center gap-2">
            {viewOptions.map((option) => {
                const isSelected = activeViewId === option.value;
                return (
                    <Button
                        key={option.value}
                        type="button"
                        variant={
                            isSelected
                                ? "squareOutlinePrimary"
                                : "squareOutline"
                        }
                        className={cn(
                            "shrink-0 min-w-30 shadow-none",
                            isSelected && "bg-primary/10"
                        )}
                        onClick={() => onSelectView(option.value)}
                    >
                        {option.label}
                    </Button>
                );
            })}
        </div>
    );
}

type LauncherSaveViewMenuProps = {
    isDefaultView: boolean;
    isAdmin: boolean;
    isOrgWideView: boolean;
    hasUnsavedChanges: boolean;
    canResetSystemDefault: boolean;
    onSaveToCurrent: () => void;
    onSaveAsNew: () => void;
    onSaveForEveryone: () => void;
    onMakePersonal: () => void;
    onResetView: () => void;
    onResetSystemDefault: () => void;
    onDeleteView: () => void;
};

export function LauncherSaveViewMenu({
    isDefaultView,
    isAdmin,
    isOrgWideView,
    hasUnsavedChanges,
    canResetSystemDefault,
    onSaveToCurrent,
    onSaveAsNew,
    onSaveForEveryone,
    onMakePersonal,
    onResetView,
    onResetSystemDefault,
    onDeleteView
}: LauncherSaveViewMenuProps) {
    const t = useTranslations();
    const canDeleteView = !isDefaultView && (isAdmin || !isOrgWideView);

    return (
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
                <Button variant="outline" className="shrink-0">
                    {hasUnsavedChanges ? (
                        <span className="size-2 rounded-full bg-primary mr-2" />
                    ) : null}
                    {t("resourceLauncherSaveView")}
                    <ChevronDown className="ml-2 size-4" />
                </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
                {hasUnsavedChanges ? (
                    <>
                        <DropdownMenuItem onSelect={onResetView}>
                            {t("resourceLauncherResetView")}
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                    </>
                ) : null}
                {isDefaultView && canResetSystemDefault ? (
                    <>
                        <DropdownMenuItem onSelect={onResetSystemDefault}>
                            {t("resourceLauncherResetSystemDefault")}
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                    </>
                ) : null}
                {isDefaultView && hasUnsavedChanges ? (
                    <>
                        <DropdownMenuItem onSelect={onSaveToCurrent}>
                            {t("resourceLauncherSaveDefaultPersonal")}
                        </DropdownMenuItem>
                        {isAdmin ? (
                            <DropdownMenuItem onSelect={onSaveForEveryone}>
                                {t("resourceLauncherSaveForEveryone")}
                            </DropdownMenuItem>
                        ) : null}
                    </>
                ) : !isDefaultView && (isAdmin || !isOrgWideView) ? (
                    <DropdownMenuItem onSelect={onSaveToCurrent}>
                        {t("resourceLauncherSaveToCurrentView")}
                    </DropdownMenuItem>
                ) : null}
                <DropdownMenuItem onSelect={onSaveAsNew}>
                    {t("resourceLauncherSaveAsNewView")}
                </DropdownMenuItem>
                {isAdmin && !isDefaultView && !isOrgWideView ? (
                    <DropdownMenuItem onSelect={onSaveForEveryone}>
                        {t("resourceLauncherSaveForEveryone")}
                    </DropdownMenuItem>
                ) : null}
                {isAdmin && !isDefaultView && isOrgWideView ? (
                    <DropdownMenuItem onSelect={onMakePersonal}>
                        {t("resourceLauncherMakePersonal")}
                    </DropdownMenuItem>
                ) : null}
                {canDeleteView ? (
                    <>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                            onSelect={onDeleteView}
                            className="text-destructive focus:text-destructive"
                        >
                            {t("resourceLauncherDeleteView")}
                        </DropdownMenuItem>
                    </>
                ) : null}
            </DropdownMenuContent>
        </DropdownMenu>
    );
}
