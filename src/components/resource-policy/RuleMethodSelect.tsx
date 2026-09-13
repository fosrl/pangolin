"use client";

import { Button } from "@app/components/ui/button";
import {
    Command,
    CommandGroup,
    CommandItem,
    CommandList
} from "@app/components/ui/command";
import {
    Popover,
    PopoverContent,
    PopoverTrigger
} from "@app/components/ui/popover";
import { HTTP_METHODS, parseHttpMethodList } from "@server/lib/validators";
import { Check, ChevronsUpDown } from "lucide-react";

// A METHOD rule stores its methods as a comma-separated list in rule.value,
// e.g. "POST,PUT". Only the common methods are offered here; a value set
// through a blueprint or the API may contain other methods (the WebDAV verbs,
// for instance), so those are kept and shown rather than dropped on edit.
export function RuleMethodSelect({
    value,
    disabled,
    placeholder,
    onChange
}: {
    value: string;
    disabled: boolean;
    placeholder: string;
    onChange: (value: string) => void;
}) {
    const selected = parseHttpMethodList(value);
    const knownMethods: readonly string[] = HTTP_METHODS;
    const options = [
        ...knownMethods,
        ...selected.filter((method) => !knownMethods.includes(method))
    ];

    function toggle(method: string) {
        const next = selected.includes(method)
            ? selected.filter((m) => m !== method)
            : [...selected, method];

        // keep a stable order so the stored value does not churn on every edit
        onChange(options.filter((m) => next.includes(m)).join(","));
    }

    return (
        <Popover>
            <PopoverTrigger asChild>
                <Button
                    variant="outline"
                    role="combobox"
                    disabled={disabled}
                    className="w-full min-w-0 justify-between"
                >
                    <span className="truncate">
                        {selected.length > 0
                            ? selected.join(", ")
                            : placeholder}
                    </span>
                    <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                </Button>
            </PopoverTrigger>
            <PopoverContent className="min-w-50 p-0">
                <Command>
                    <CommandList>
                        <CommandGroup>
                            {options.map((method) => (
                                <CommandItem
                                    key={method}
                                    value={method}
                                    onSelect={() => toggle(method)}
                                >
                                    <Check
                                        className={`mr-2 h-4 w-4 ${
                                            selected.includes(method)
                                                ? "opacity-100"
                                                : "opacity-0"
                                        }`}
                                    />
                                    {method}
                                </CommandItem>
                            ))}
                        </CommandGroup>
                    </CommandList>
                </Command>
            </PopoverContent>
        </Popover>
    );
}
