"use client";

import { TableCell, TableRow } from "@/components/ui/table";
import { useTranslations } from "next-intl";
import { type ReactNode } from "react";

const PLACEHOLDER_ROW_COUNT = 5;
const COMPACT_PLACEHOLDER_ROW_COUNT = 2;

type DataTableEmptyStateProps = {
    colSpan: number;
    action?: ReactNode;
    message?: string;
    compact?: boolean;
};

export function DataTableEmptyState({
    colSpan,
    action,
    message,
    compact = false
}: DataTableEmptyStateProps) {
    const t = useTranslations();
    const placeholderRows = compact
        ? COMPACT_PLACEHOLDER_ROW_COUNT
        : PLACEHOLDER_ROW_COUNT;
    const minHeightClass = compact ? "min-h-20" : "min-h-[12.5rem]";

    return (
        <TableRow className="hidden sm:table-row hover:bg-transparent data-[state=selected]:bg-transparent">
            <TableCell colSpan={colSpan} className="p-0">
                <div
                    className={`relative w-full overflow-hidden ${minHeightClass}`}
                >
                    <div
                        className="pointer-events-none absolute inset-0 flex flex-col justify-start opacity-50"
                        aria-hidden
                    >
                        {Array.from({ length: placeholderRows }).map((_, i) => (
                            <div
                                key={i}
                                className="flex h-10 shrink-0 items-center border-b border-border/60 px-4 last:border-b-0"
                            >
                                <div className="h-3.5 w-full rounded bg-muted/60" />
                            </div>
                        ))}
                    </div>
                    <div
                        className={`relative flex w-full flex-col items-center justify-center px-4 ${
                            compact
                                ? "min-h-20 gap-3 py-4"
                                : "min-h-[12.5rem] gap-4 py-8"
                        }`}
                    >
                        <p className="text-sm text-muted-foreground">
                            {message ?? t("noResults")}
                        </p>
                        {action}
                    </div>
                </div>
            </TableCell>
        </TableRow>
    );
}
