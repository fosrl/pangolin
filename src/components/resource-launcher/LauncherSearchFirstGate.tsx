"use client";

import { cn } from "@app/lib/cn";
import { Search } from "lucide-react";
import { useTranslations } from "next-intl";

type LauncherSearchFirstGateProps = {
    layout: "grid" | "list";
};

function GhostResourceGrid() {
    return (
        <div
            className="grid w-full grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 [&>*]:min-w-0"
            aria-hidden
        >
            {Array.from({ length: 4 }).map((_, index) => (
                <div
                    key={index}
                    className="flex min-w-0 flex-col gap-2.5 rounded-xl border border-border/60 bg-muted/20 p-4"
                >
                    <div className="flex items-center gap-5">
                        <div className="size-10 shrink-0 rounded-lg bg-muted/60" />
                        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                            <div className="h-3.5 w-3/5 rounded bg-muted/60" />
                            <div className="h-3 w-2/5 rounded bg-muted/40" />
                        </div>
                    </div>
                </div>
            ))}
        </div>
    );
}

function GhostResourceList() {
    return (
        <div className="flex w-full flex-col" aria-hidden>
            {Array.from({ length: 3 }).map((_, index) => (
                <div
                    key={index}
                    className={cn(
                        "flex items-center gap-4 px-4 py-3",
                        index < 2 && "border-b border-border/60"
                    )}
                >
                    <div className="size-8 shrink-0 rounded-lg bg-muted/60" />
                    <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                        <div className="h-3.5 w-2/5 rounded bg-muted/60" />
                        <div className="h-3 w-1/4 rounded bg-muted/40" />
                    </div>
                </div>
            ))}
        </div>
    );
}

export function LauncherSearchFirstGate({
    layout
}: LauncherSearchFirstGateProps) {
    const t = useTranslations();

    return (
        <div className="relative w-full overflow-hidden rounded-xl border border-dashed border-border">
            <div className="pointer-events-none absolute inset-0 opacity-50">
                {layout === "grid" ? (
                    <GhostResourceGrid />
                ) : (
                    <GhostResourceList />
                )}
            </div>
            <div className="relative flex min-h-56 flex-col items-center justify-center gap-4 px-6 py-12 text-center">
                <div className="flex size-12 items-center justify-center rounded-full bg-muted">
                    <Search className="size-5 text-muted-foreground" />
                </div>
                <div className="max-w-md space-y-1.5">
                    <h3 className="text-base font-semibold text-foreground">
                        {t("resourceLauncherSearchFirstTitle")}
                    </h3>
                    <p className="text-sm text-muted-foreground">
                        {t("resourceLauncherSearchFirstDescription")}
                    </p>
                </div>
            </div>
        </div>
    );
}
