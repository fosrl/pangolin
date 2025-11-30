"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";
import { Button } from "@app/components/ui/button";
import { useTranslations } from "next-intl";
import { toast } from "@app/hooks/useToast";

export default function RefreshButton() {
    const router = useRouter();
    const [isRefreshing, setIsRefreshing] = useState(false);
    const t = useTranslations();

    const refreshData = async () => {
        setIsRefreshing(true);
        try {
            await new Promise((resolve) => setTimeout(resolve, 200));
            router.refresh();
        } catch {
            toast({
                title: t("error"),
                description: t("refreshError"),
                variant: "destructive"
            });
        } finally {
            setIsRefreshing(false);
        }
    };

    return (
        <Button
            variant="outline"
            onClick={refreshData}
            disabled={isRefreshing}
        >
            <RefreshCw
                className={`mr-2 h-4 w-4 ${isRefreshing ? "animate-spin" : ""}`}
            />
            {t("refresh", { fallback: "Refresh" })}
        </Button>
    );
}
