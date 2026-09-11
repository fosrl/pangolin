"use client";

import { TableCell, TableRow } from "@/components/ui/table";
import { useTranslations } from "next-intl";
import { type ReactNode } from "react";

const PLACEHOLDER_ROW_COUNT = 5;

type DataTableEmptyStateProps = {
    colSpan: number;
    action?: ReactNode;
    message?: string;
};

export function DataTableEmptyState({
    colSpan,
    action,
    message
}: DataTableEmptyStateProps) {
    const t = useTranslations();

    return (
        <TableRow className="hidden sm:table-row hover:bg-transparent data-[state=selected]:bg-transparent">
            <TableCell colSpan={colSpan} className="p-0">
                <div className="relative w-full overflow-hidden min-h-[12.5rem]">
                    <div
                        className="pointer-events-none absolute inset-0 flex flex-col justify-start opacity-50"
                        aria-hidden
                    >
                        {Array.from({ length: PLACEHOLDER_ROW_COUNT }).map(
                            (_, i) => (
                                <div
                                    key={i}
                                    className="flex h-10 shrink-0 items-center border-b border-border/60 px-4 last:border-b-0"
                                >
                                    <div className="h-3.5 w-full rounded bg-muted/60" />
                                </div>
                            )
                        )}
                    </div>
                    <div className="relative flex w-full flex-col items-center justify-center px-4 min-h-[12.5rem] gap-4 py-8">
                        <p className="text-sm text-muted-foreground">
                            {message ?? t("noResults")}
                        </p>
                        {action ? (
                            <div className="bg-background">{action}</div>
                        ) : null}
                    </div>
                </div>
            </TableCell>
        </TableRow>
    );
}
