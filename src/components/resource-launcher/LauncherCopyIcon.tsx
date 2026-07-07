"use client";

import { cn } from "@app/lib/cn";
import { Check, Copy } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";

type LauncherCopyIconProps = {
    text: string;
    className?: string;
};

export function LauncherCopyIcon({ text, className }: LauncherCopyIconProps) {
    const t = useTranslations();
    const [copied, setCopied] = useState(false);

    if (!text) {
        return null;
    }

    return (
        <button
            type="button"
            className={cn(
                "inline-flex size-4 shrink-0 items-center justify-center text-muted-foreground transition-colors hover:text-foreground",
                className
            )}
            onClick={(event) => {
                event.stopPropagation();
                void navigator.clipboard.writeText(text);
                setCopied(true);
                setTimeout(() => setCopied(false), 2000);
            }}
        >
            {copied ? (
                <Check className="size-4 text-green-500" />
            ) : (
                <Copy className="size-4" />
            )}
            <span className="sr-only">{t("copyText")}</span>
        </button>
    );
}
