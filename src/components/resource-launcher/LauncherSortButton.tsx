"use client";

import { Button } from "@app/components/ui/button";
import { useTranslations } from "next-intl";
import { ArrowDown01, ArrowUp10 } from "lucide-react";

type LauncherSortButtonProps = {
    order: "asc" | "desc";
    onToggle: () => void;
};

export function LauncherSortButton({
    order,
    onToggle
}: LauncherSortButtonProps) {
    const t = useTranslations();

    return (
        <Button
            variant="outline"
            size="icon"
            className="shrink-0"
            onClick={onToggle}
            title={
                order === "asc"
                    ? t("resourceLauncherSortAscending")
                    : t("resourceLauncherSortDescending")
            }
        >
            {order === "asc" ? (
                <ArrowDown01 className="size-4" />
            ) : (
                <ArrowUp10 className="size-4" />
            )}
            <span className="sr-only">{t("resourceLauncherSort")}</span>
        </Button>
    );
}
