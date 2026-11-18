"use client";

import { Badge } from "@app/components/ui/badge";
import { Button } from "@app/components/ui/button";
import {
    Popover,
    PopoverContent,
    PopoverTrigger
} from "@app/components/ui/popover";
import { cn } from "@app/lib/cn";
import { dataTableFilterPopoverContentClassName } from "@app/lib/dataTableFilterPopover";
import { Funnel } from "lucide-react";
import type { ReactNode } from "react";

// Column header filter that opens a searchable picker for a single entity
// (a resource, user, domain, ...), showing the current pick as a badge.
export type ColumnEntityFilterProps = {
    label: string;
    open: boolean;
    onOpenChange: (open: boolean) => void;
    selectedName?: string | null;
    clearLabel: string;
    onClear: () => void;
    children: ReactNode;
};

export function ColumnEntityFilter({
    label,
    open,
    onOpenChange,
    selectedName,
    clearLabel,
    onClear,
    children
}: ColumnEntityFilterProps) {
    return (
        <Popover open={open} onOpenChange={onOpenChange}>
            <PopoverTrigger asChild>
                <Button
                    type="button"
                    variant="ghost"
                    role="combobox"
                    className={cn(
                        "justify-between text-sm h-8 px-2 w-full p-3",
                        !selectedName && "text-muted-foreground"
                    )}
                >
                    <div className="flex items-center gap-2 min-w-0">
                        {label}
                        <Funnel className="size-4 flex-none" />
                        {selectedName && (
                            <Badge
                                className="truncate max-w-[10rem]"
                                variant="secondary"
                            >
                                {selectedName}
                            </Badge>
                        )}
                    </div>
                </Button>
            </PopoverTrigger>
            <PopoverContent
                className={dataTableFilterPopoverContentClassName}
                align="start"
            >
                <div className="border-b p-1">
                    <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-8 w-full justify-start font-normal"
                        onClick={onClear}
                    >
                        {clearLabel}
                    </Button>
                </div>
                {children}
            </PopoverContent>
        </Popover>
    );
}
