"use client";

import { cn } from "@app/lib/cn";
import { createContext, useContext } from "react";

type InfoSectionSize = "default" | "sm";

const InfoSectionSizeContext = createContext<InfoSectionSize>("default");

export function InfoSections({
    children,
    cols,
    columnSizing = "content",
    layout = "default",
    size = "default"
}: {
    children: React.ReactNode;
    cols?: number;
    /** content (default): fixed gap, columns hug content, left-aligned; fill: equal-width columns across the row */
    columnSizing?: "fill" | "content";
    /** panel: fixed 2-column grid for narrow containers such as side panels */
    layout?: "default" | "panel";
    /** sm: smaller titles and content, for use under a settings subsection header */
    size?: InfoSectionSize;
}) {
    const n = cols || 1;
    const track =
        columnSizing === "fill" ? "minmax(0, 1fr)" : "minmax(0, max-content)";

    return (
        <InfoSectionSizeContext.Provider value={size}>
            <div
                className={cn(
                    "grid w-full min-w-0 gap-4",
                    layout === "panel"
                        ? "grid-cols-2 items-start"
                        : "grid-cols-2 md:grid-cols-(--columns) md:items-start md:space-x-16",
                    columnSizing === "content" &&
                        (layout === "panel"
                            ? "justify-items-start justify-start"
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
        </InfoSectionSizeContext.Provider>
    );
}

export function InfoSection({
    children,
    className
}: {
    children: React.ReactNode;
    className?: string;
}) {
    const size = useContext(InfoSectionSizeContext);
    return (
        <div
            className={cn(
                "min-w-0 w-full max-w-full",
                size === "sm" ? "space-y-0.5" : "space-y-1",
                className
            )}
        >
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
    const size = useContext(InfoSectionSizeContext);
    return (
        <div
            className={cn(
                "min-w-0 truncate font-semibold",
                size === "sm" && "text-sm",
                className
            )}
        >
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
    const size = useContext(InfoSectionSizeContext);
    return (
        <div
            className={cn(
                "w-full min-w-0 max-w-full overflow-hidden",
                size === "sm" && "text-sm",
                className
            )}
        >
            <div className="w-full min-w-0 max-w-full truncate [&>div.flex]:min-w-0 [&>div.flex]:!whitespace-normal [&>div.flex>span]:truncate [&>div.flex>a]:truncate">
                {children}
            </div>
        </div>
    );
}
