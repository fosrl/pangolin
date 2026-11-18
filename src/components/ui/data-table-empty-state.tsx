"use client";

import { TableCell, TableRow } from "@/components/ui/table";
import { Inbox } from "lucide-react";
import { useTranslations } from "next-intl";
import { type ReactNode } from "react";

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
        <TableRow className="hidden sm:table-row data-[state=selected]:bg-transparent">
            <TableCell colSpan={colSpan} className="h-auto p-0">
                <div className="flex min-h-40 flex-col items-center justify-center gap-3 px-4 py-10 text-center">
                    <div
                        className="flex size-9 items-center justify-center rounded-md border bg-table-header text-muted-foreground"
                        aria-hidden
                    >
                        <Inbox className="size-4" />
                    </div>
                    <p className="text-sm text-muted-foreground">
                        {message ?? t("noResults")}
                    </p>
                    {action ? <div className="pt-1">{action}</div> : null}
                </div>
            </TableCell>
        </TableRow>
    );
}
