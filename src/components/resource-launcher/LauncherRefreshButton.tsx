"use client";

import { Button } from "@app/components/ui/button";
import { useTranslations } from "next-intl";
import { RefreshCw } from "lucide-react";

type LauncherRefreshButtonProps = {
    onRefresh: () => void;
    isRefreshing: boolean;
};

export function LauncherRefreshButton({
    onRefresh,
    isRefreshing
}: LauncherRefreshButtonProps) {
    const t = useTranslations();

    return (
        <Button
            variant="outline"
            onClick={onRefresh}
            disabled={isRefreshing}
            className="shrink-0"
        >
            <RefreshCw
                className={`size-4 ${isRefreshing ? "animate-spin" : ""}`}
            />
        </Button>
    );
}
