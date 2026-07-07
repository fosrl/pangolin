"use client";

import { cn } from "@app/lib/cn";

export function InfoSections({
    children,
    cols,
    columnSizing = "content",
    layout = "default"
}: {
    children: React.ReactNode;
    cols?: number;
    /** content (default): fixed gap, columns hug content, left-aligned; fill: equal-width columns across the row */
    columnSizing?: "fill" | "content";
    /** panel: 2 columns until xl for narrow containers such as side panels */
    layout?: "default" | "panel";
}) {
    const n = cols || 1;
    const track =
        columnSizing === "fill" ? "minmax(0, 1fr)" : "minmax(0, max-content)";

    return (
        <div
            className={cn(
                "grid w-full min-w-0 gap-4",
                layout === "panel"
                    ? "grid-cols-2 xl:grid-cols-(--columns) xl:items-start xl:space-x-16"
                    : "grid-cols-2 md:grid-cols-(--columns) md:items-start md:space-x-16",
                columnSizing === "content" &&
                    (layout === "panel"
                        ? "xl:justify-items-start xl:justify-start"
                        : "md:justify-items-start md:justify-start")
            )}
            style={{
                // @ts-expect-error dynamic props don't work with tailwind, but we can set the
                // value of a CSS variable at runtime and tailwind will just reuse that value
                "--columns": `repeat(${n}, ${track})`
            }}
        >
            {children}
        </div>
    );
}

export function InfoSection({
    children,
    className
}: {
    children: React.ReactNode;
    className?: string;
}) {
    return (
        <div className={cn("min-w-0 w-full max-w-full space-y-1", className)}>
            {children}
        </div>
    );
}

export function InfoSectionTitle({
    children,
    className
}: {
    children: React.ReactNode;
    className?: string;
}) {
    return (
        <div className={cn("min-w-0 truncate font-semibold", className)}>
            {children}
        </div>
    );
}

export function InfoSectionContent({
    children,
    className
}: {
    children: React.ReactNode;
    className?: string;
}) {
    return (
        <div
            className={cn(
                "w-full min-w-0 max-w-full overflow-hidden",
                className
            )}
        >
            <div className="w-full min-w-0 max-w-full truncate [&>div.flex]:min-w-0 [&>div.flex]:!whitespace-normal [&>div.flex>span]:truncate [&>div.flex>a]:truncate">
                {children}
            </div>
        </div>
    );
}
