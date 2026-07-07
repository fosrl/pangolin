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
                <div className="relative min-h-[11rem] w-full overflow-hidden">
                    <div
                        className="absolute inset-0 flex flex-col justify-start"
                        aria-hidden
                    >
                        {Array.from({ length: PLACEHOLDER_ROW_COUNT }).map(
                            (_, i) => (
                                <div key={i} className="h-10 shrink-0" />
                            )
                        )}
                    </div>
                    <div className="relative flex min-h-[11rem] w-full flex-col items-center justify-center gap-4 px-4 py-8">
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
