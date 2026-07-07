"use client";

import { Button } from "@app/components/ui/button";
import { Switch } from "@app/components/ui/switch";
import { cn } from "@app/lib/cn";
import { useTranslations } from "next-intl";

export type PolicyAuthMethodRowProps = {
    id: string;
    title: string;
    description: string;
    summary: string;
    active: boolean;
    onConfigure: () => void;
    onToggle: (active: boolean) => void;
    disabled?: boolean;
    configureDisabled?: boolean;
};

export function PolicyAuthMethodRow({
    id,
    title,
    description,
    summary,
    active,
    onConfigure,
    onToggle,
    disabled,
    configureDisabled = disabled
}: PolicyAuthMethodRowProps) {
    const t = useTranslations();
    const canEdit = active && !configureDisabled;
    const canEnable = !active && !disabled;
    const isRowInteractive = canEdit || canEnable;

    const handleRowClick = () => {
        if (canEdit) {
            onConfigure();
            return;
        }
        if (canEnable) {
            onToggle(true);
        }
    };

    return (
        <div
            className={cn(
                "flex items-center gap-3 rounded-md border border-input p-3 min-w-0",
                disabled && "opacity-60",
                isRowInteractive && "cursor-pointer hover:bg-muted/50"
            )}
            onClick={isRowInteractive ? handleRowClick : undefined}
            onKeyDown={
                isRowInteractive
                    ? (e) => {
                          if (e.key === "Enter" || e.key === " ") {
                              e.preventDefault();
                              handleRowClick();
                          }
                      }
                    : undefined
            }
            role={isRowInteractive ? "button" : undefined}
            tabIndex={isRowInteractive ? 0 : undefined}
        >
            <div className="flex flex-1 min-w-0 flex-col gap-0.5">
                <div className="flex items-center gap-2">
                    <span className="text-sm font-medium">{title}</span>
                </div>
                <p className="truncate text-sm text-muted-foreground">
                    {active ? summary : description}
                </p>
            </div>
            <div
                className="flex shrink-0 items-center gap-2"
                onClick={(e) => e.stopPropagation()}
                onKeyDown={(e) => e.stopPropagation()}
            >
                {active && (
                    <Button
                        type="button"
                        variant="text"
                        size="sm"
                        className="h-auto px-0"
                        disabled={configureDisabled}
                        onClick={onConfigure}
                    >
                        {t("edit")}
                    </Button>
                )}
                <Switch
                    id={`${id}-toggle`}
                    checked={active}
                    disabled={disabled}
                    onCheckedChange={onToggle}
                />
            </div>
        </div>
    );
}
