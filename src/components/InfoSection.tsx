"use client";

import { cn } from "@app/lib/cn";

export function InfoSections({
    children,
    cols
}: {
    children: React.ReactNode;
    cols?: number;
}) {
    return (
        <div
            className={`grid md:grid-cols-[var(--columns)] md:gap-4 gap-2 md:items-start grid-cols-1`}
            style={{
                // @ts-expect-error dynamic props don't work with tailwind, but we can set the
                // value of a CSS variable at runtime and tailwind will just reuse that value
                "--columns": `repeat(${cols || 1}, minmax(0, 1fr))`
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
    return <div className={cn("space-y-1", className)}>{children}</div>;
}

export function InfoSectionTitle({
    children,
    className
}: {
    children: React.ReactNode;
    className?: string;
}) {
    return <div className={cn("font-semibold", className)}>{children}</div>;
}

export function InfoSectionContent({
    children,
    className
}: {
    children: React.ReactNode;
    className?: string;
}) {
    return <div className={cn("break-words", className)}>{children}</div>;
}
