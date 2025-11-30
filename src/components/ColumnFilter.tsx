import { useState } from "react";
import { Button } from "@app/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@app/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@app/components/ui/command";
import { CheckIcon, ChevronDownIcon, Filter } from "lucide-react";
import { cn } from "@app/lib/cn";

interface FilterOption {
    value: string;
    label: string;
}

interface ColumnFilterProps {
    options: FilterOption[];
    selectedValue?: string;
    onValueChange: (value: string | undefined) => void;
    placeholder?: string;
    searchPlaceholder?: string;
    emptyMessage?: string;
    className?: string;
}

export function ColumnFilter({
    options,
    selectedValue,
    onValueChange,
    placeholder,
    searchPlaceholder = "Search...",
    emptyMessage = "No options found",
    className
}: ColumnFilterProps) {
    const [open, setOpen] = useState(false);

    const selectedOption = options.find(option => option.value === selectedValue);

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
                        <Filter className="h-4 w-4" />
                        <span className="truncate">
                            {selectedOption ? selectedOption.label : placeholder}
                        </span>
                    </div>
                    <ChevronDownIcon className="h-4 w-4 shrink-0 opacity-50" />
                </Button>
            </PopoverTrigger>
            <PopoverContent className="p-0 w-[200px]" align="start">
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
                                    Clear filter
                                </CommandItem>
                            )}
                            {options.map((option) => (
                                <CommandItem
                                    key={option.value}
                                    value={option.label}
                                    onSelect={() => {
                                        onValueChange(
                                            selectedValue === option.value ? undefined : option.value
                                        );
                                        setOpen(false);
                                    }}
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