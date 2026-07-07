import type { Ref } from "react";
import {
    Command,
    CommandEmpty,
    CommandGroup,
    CommandInput,
    CommandItem,
    CommandList
} from "../ui/command";
import { cn } from "@app/lib/cn";
import { CheckIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { Checkbox } from "../ui/checkbox";

export type TagValue = {
    text: string;
    id: string;
    isAdmin?: boolean;
    color?: string;
};

export type MultiSelectTagsProps<T extends TagValue> = {
    emptyPlaceholder?: string;
    searchPlaceholder?: string;
    searchQuery?: string;
    options: Array<T>;
    value: Array<T>;
    onChange: (newValue: Array<T>) => void;
    onSearch: (query: string) => void;
    ref?: Ref<HTMLButtonElement>;
    disabled?: boolean;
    lockedIds?: Set<string>;
};

export function MultiSelectContent<T extends TagValue>({
    emptyPlaceholder,
    searchPlaceholder,
    searchQuery,
    value,
    options,
    onSearch,
    onChange,
    lockedIds
}: MultiSelectTagsProps<T>) {
    const t = useTranslations();
    const selectedValues = new Set(value.map((v) => v.id));
    return (
        <Command shouldFilter={false}>
            <CommandInput
                placeholder={searchPlaceholder ?? t("search")}
                value={searchQuery}
                onValueChange={onSearch}
            />
            <CommandList>
                <CommandEmpty className="text-muted-foreground">
                    {emptyPlaceholder ?? t("noResults")}
                </CommandEmpty>
                <CommandGroup>
                    {options.map((option) => {
                        const isLocked = lockedIds?.has(option.id);
                        return (
                            <CommandItem
                                value={option.id}
                                key={option.id}
                                disabled={isLocked}
                                onSelect={() => {
                                    if (isLocked) return;
                                    let newValues = [];
                                    if (selectedValues.has(option.id)) {
                                        newValues = value.filter(
                                            (v) => v.id !== option.id
                                        );
                                    } else {
                                        newValues = [...value, option];
                                    }
                                    onChange(newValues);
                                }}
                            >
                                <Checkbox
                                    className="pointer-events-none shrink-0"
                                    checked={selectedValues.has(option.id)}
                                    aria-hidden
                                    tabIndex={-1}
                                />
                                {option.color && (
                                    <span
                                        className="size-2 rounded-full flex-none"
                                        style={{
                                            backgroundColor: option.color
                                        }}
                                    />
                                )}
                                {`${option.text}`}
                            </CommandItem>
                        );
                    })}
                </CommandGroup>
            </CommandList>
        </Command>
    );
}
