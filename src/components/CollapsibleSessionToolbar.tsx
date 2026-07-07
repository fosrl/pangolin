"use client";

import { useState, type ReactNode } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { cn } from "@app/lib/cn";
import { useTranslations } from "next-intl";

export default function CollapsibleSessionToolbar({
    children,
    defaultOpen = false
}: {
    children: ReactNode;
    defaultOpen?: boolean;
}) {
    const t = useTranslations();
    const [open, setOpen] = useState(defaultOpen);

    return (
        <div className="pointer-events-none absolute inset-x-0 top-0 z-10">
            <div
                className={cn(
                    "pointer-events-auto absolute inset-x-0 top-0 isolate transition-transform duration-200 ease-out",
                    open ? "translate-y-0" : "-translate-y-full"
                )}
            >
                <div className="relative z-20 flex flex-wrap items-center gap-2 bg-background p-2">
                    {children}
                </div>
                {/* Secondary toggle backdrop kept as a distinct style under
                    the main handle button. */}
                <button
                    type="button"
                    onClick={() => setOpen((v) => !v)}
                    aria-label={
                        open ? t("sessionToolbarHide") : t("sessionToolbarShow")
                    }
                    aria-expanded={open}
                    className="absolute left-1/2 top-full -z-20 h-4 w-72 -translate-x-1/2 -translate-y-2 rounded-md bg-neutral-200 transition-opacity focus:outline-none focus-visible:ring-2 focus-visible:ring-primary dark:bg-neutral-500"
                />
                <button
                    type="button"
                    onClick={() => setOpen((v) => !v)}
                    aria-label={
                        open ? t("sessionToolbarHide") : t("sessionToolbarShow")
                    }
                    aria-expanded={open}
                    className="absolute left-1/2 top-full -z-10 flex h-5 w-6 -translate-x-1/2 items-center justify-center rounded-b-sm bg-primary text-primary-foreground transition-opacity focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                >
                    {open ? (
                        <ChevronUp className="h-3 w-3" />
                    ) : (
                        <ChevronDown className="h-3 w-3" />
                    )}
                </button>
            </div>
        </div>
    );
}
