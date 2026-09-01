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
    const minHeightClass = compact ? "min-h-[4.5rem]" : "min-h-[11rem]";

    return (
        <TableRow className="hidden sm:table-row hover:bg-transparent data-[state=selected]:bg-transparent">
            <TableCell colSpan={colSpan} className="p-0">
                <div
                    className={`relative w-full overflow-hidden ${minHeightClass}`}
                >
                    <div
                        className="absolute inset-0 flex flex-col justify-start"
                        aria-hidden
                    >
                        {Array.from({ length: placeholderRows }).map((_, i) => (
                            <div key={i} className="h-10 shrink-0" />
                        ))}
                    </div>
                    <div
                        className={`relative flex w-full flex-col items-center justify-center px-4 ${
                            compact
                                ? "min-h-[4.5rem] gap-3 py-4"
                                : "min-h-[11rem] gap-4 py-8"
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
