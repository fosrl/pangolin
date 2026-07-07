"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@app/components/ui/button";
import {
    Popover,
    PopoverContent,
    PopoverTrigger
} from "@app/components/ui/popover";
import {
    Command,
    CommandEmpty,
    CommandGroup,
    CommandInput,
    CommandItem,
    CommandList
} from "@app/components/ui/command";
import { CheckIcon, Funnel } from "lucide-react";
import { cn } from "@app/lib/cn";
import { dataTableFilterPopoverContentClassName } from "@app/lib/dataTableFilterPopover";
import { Badge } from "./ui/badge";
import { Checkbox } from "./ui/checkbox";

type FilterOption = {
    value: string;
    label: string;
};

type ColumnMultiFilterButtonProps = {
    options: FilterOption[];
    selectedValues: string[];
    onSelectedValuesChange: (values: string[]) => void;
    searchPlaceholder?: string;
    emptyMessage?: string;
    className?: string;
    label: string;
};

export function ColumnMultiFilterButton({
    options,
    selectedValues,
    onSelectedValuesChange,
    searchPlaceholder = "Search...",
    emptyMessage = "No options found",
    className,
    label
}: ColumnMultiFilterButtonProps) {
    const [open, setOpen] = useState(false);
    const t = useTranslations();

    const selectedSet = useMemo(
        () => new Set(selectedValues),
        [selectedValues]
    );

    const summary = useMemo(() => {
        if (selectedValues.length === 0) {
            return null;
        }
        if (selectedValues.length === 1) {
            return (
                options.find((o) => o.value === selectedValues[0])?.label ??
                selectedValues[0]
            );
        }
        return t("accessUsersRoleFilterCount", {
            count: selectedValues.length
        });
    }, [selectedValues, options, t]);

    function toggle(value: string) {
        const next = selectedSet.has(value)
            ? selectedValues.filter((v) => v !== value)
            : [...selectedValues, value];
        onSelectedValuesChange(next);
    }

    return (
        <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
                <Button
                    variant="ghost"
                    role="combobox"
                    aria-expanded={open}
                    className={cn(
                        "justify-between text-sm h-8 px-2",
                        selectedValues.length === 0 && "text-muted-foreground",
                        className
                    )}
                >
                    <div className="flex items-center gap-2 min-w-0">
                        <span className="shrink-0">{label}</span>
                        <Funnel className="size-4 flex-none shrink-0" />
                        {summary && (
                            <Badge
                                className="truncate max-w-[10rem]"
                                variant="secondary"
                            >
                                {summary}
                            </Badge>
                        )}
                    </div>
                </Button>
            </PopoverTrigger>
            <PopoverContent
                className={dataTableFilterPopoverContentClassName}
                align="start"
            >
                <Command>
                    <CommandInput placeholder={searchPlaceholder} />
                    <CommandList>
                        <CommandEmpty>{emptyMessage}</CommandEmpty>
                        <CommandGroup>
                            {selectedValues.length > 0 && (
                                <CommandItem
                                    onSelect={() => {
                                        onSelectedValuesChange([]);
                                        setOpen(false);
                                    }}
                                    className="text-muted-foreground"
                                >
                                    {t("accessFilterClear")}
                                </CommandItem>
                            )}
                            {options.map((option) => (
                                <CommandItem
                                    key={option.value}
                                    value={option.label}
                                    onSelect={() => {
                                        toggle(option.value);
                                    }}
                                    className="break-all"
                                >
                                    <Checkbox
                                        className="pointer-events-none shrink-0"
                                        checked={selectedSet.has(option.value)}
                                        aria-hidden
                                        tabIndex={-1}
                                    />
                                    {option.label}
                                </CommandItem>
                            ))}
                        </CommandGroup>
                    </CommandList>
                </Command>
            </PopoverContent>
        </Popover>
    );
}
