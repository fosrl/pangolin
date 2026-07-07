"use client";

import { cn } from "@app/lib/cn";

type LauncherResourceIconProps = {
    iconUrl?: string | null;
    name: string;
    className?: string;
    variant?: "grid" | "list";
};

export function LauncherResourceIcon({
    iconUrl,
    name,
    className,
    variant = "grid"
}: LauncherResourceIconProps) {
    const dimension = variant === "list" ? "size-5" : "size-10";

    if (iconUrl) {
        return (
            <img
                src={iconUrl}
                alt={name}
                className={cn(dimension, "shrink-0 object-cover", className)}
            />
        );
    }

    if (variant === "list") {
        return (
            <div
                className={cn(
                    dimension,
                    "flex shrink-0 items-center justify-center text-muted-foreground",
                    className
                )}
            >
                <span className="text-sm font-semibold">-</span>
            </div>
        );
    }

    return null;
}
