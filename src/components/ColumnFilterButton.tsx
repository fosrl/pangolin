import { useState } from "react";
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
import { CheckIcon, ChevronDownIcon, Funnel } from "lucide-react";
import { cn } from "@app/lib/cn";
import { dataTableFilterPopoverContentClassName } from "@app/lib/dataTableFilterPopover";
import { Badge } from "./ui/badge";
import { useTranslations } from "next-intl";

interface FilterOption {
    value: string;
    label: string;
}

interface ColumnFilterButtonProps {
    options: FilterOption[];
    selectedValue?: string;
    onValueChange: (value: string | undefined) => void;
    searchPlaceholder?: string;
    emptyMessage?: string;
    className?: string;
    label: string;
}

export function ColumnFilterButton({
    options,
    selectedValue,
    onValueChange,
    searchPlaceholder = "Search...",
    emptyMessage = "No options found",
    className,
    label
}: ColumnFilterButtonProps) {
    const [open, setOpen] = useState(false);

    const selectedOption = options.find(
        (option) => option.value === selectedValue
    );

    const t = useTranslations();

    return (
        <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
                <Button
                    variant="ghost"
                    role="combobox"
                    aria-expanded={open}
                    className={cn(
                        "justify-between text-sm h-8 px-2",
                        !selectedValue && "text-muted-foreground",
                        className
                    )}
                >
                    <div className="flex items-center gap-2">
                        {label}

                        <Funnel className="size-4 flex-none" />

                        {selectedOption && (
                            <Badge className="truncate" variant="secondary">
                                {selectedOption.label}
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
                            {/* Clear filter option */}
                            {selectedValue && (
                                <CommandItem
                                    onSelect={() => {
                                        onValueChange(undefined);
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
                                        onValueChange(
                                            selectedValue === option.value
                                                ? undefined
                                                : option.value
                                        );
                                        setOpen(false);
                                    }}
                                    className="break-all"
                                >
                                    <CheckIcon
                                        className={cn(
                                            "mr-2 h-4 w-4",
                                            selectedValue === option.value
                                                ? "opacity-100"
                                                : "opacity-0"
                                        )}
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
