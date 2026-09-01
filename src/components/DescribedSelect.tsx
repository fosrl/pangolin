"use client";

import { Button } from "@app/components/ui/button";
import {
    Command,
    CommandEmpty,
    CommandGroup,
    CommandInput,
    CommandItem,
    CommandList
} from "@app/components/ui/command";
import {
    Popover,
    PopoverContent,
    PopoverTrigger
} from "@app/components/ui/popover";
import { cn } from "@app/lib/cn";
import { CheckIcon, ChevronsUpDown } from "lucide-react";
import { useState } from "react";

export type DescribedSelectOption<TValue extends string> = {
    value: TValue;
    title: string;
    description: string;
};

type DescribedSelectProps<TValue extends string> = {
    options: ReadonlyArray<DescribedSelectOption<TValue>>;
    value: TValue;
    onChange: (value: TValue) => void;
    searchPlaceholder: string;
    emptyMessage: string;
    placeholder?: string;
    disabled?: boolean;
    className?: string;
};

export function DescribedSelect<TValue extends string>({
    options,
    value,
    onChange,
    searchPlaceholder,
    emptyMessage,
    placeholder,
    disabled,
    className
}: DescribedSelectProps<TValue>) {
    const [open, setOpen] = useState(false);
    const selected = options.find((option) => option.value === value);

    return (
        <div className={cn("w-full", className)}>
            <Popover open={open} onOpenChange={setOpen}>
                <PopoverTrigger asChild>
                    <Button
                        type="button"
                        variant="outline"
                        role="combobox"
                        aria-expanded={open}
                        disabled={disabled}
                        className={cn(
                            "h-9 w-full justify-between font-normal",
                            !selected && "text-muted-foreground"
                        )}
                    >
                        <span className="truncate text-left">
                            {selected?.title ?? placeholder}
                        </span>
                        <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                    </Button>
                </PopoverTrigger>
                <PopoverContent
                    className="w-[var(--radix-popover-trigger-width)] p-0"
                    align="start"
                >
                    <Command>
                        <CommandInput placeholder={searchPlaceholder} />
                        <CommandList>
                            <CommandEmpty>{emptyMessage}</CommandEmpty>
                            <CommandGroup>
                                {options.map((option) => (
                                    <CommandItem
                                        key={option.value}
                                        value={`${option.value} ${option.title} ${option.description}`}
                                        onSelect={() => {
                                            onChange(option.value);
                                            setOpen(false);
                                        }}
                                    >
                                        <CheckIcon
                                            className={cn(
                                                "mr-2 h-4 w-4 shrink-0",
                                                option.value === value
                                                    ? "opacity-100"
                                                    : "opacity-0"
                                            )}
                                        />
                                        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                                            <span className="truncate">
                                                {option.title}
                                            </span>
                                            <span className="text-muted-foreground text-xs leading-snug">
                                                {option.description}
                                            </span>
                                        </div>
                                    </CommandItem>
                                ))}
                            </CommandGroup>
                        </CommandList>
                    </Command>
                </PopoverContent>
            </Popover>
        </div>
    );
}
