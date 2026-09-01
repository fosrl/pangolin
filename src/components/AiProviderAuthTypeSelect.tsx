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
import {
    AI_PROVIDER_AUTH_TYPES,
    type AiProviderAuthType
} from "@app/lib/aiProviderDefaults";
import { CheckIcon, ChevronsUpDown } from "lucide-react";
import { useTranslations } from "next-intl";
import { useMemo, useState } from "react";

const authLabelMap = {
    bearer: "aiProviderAuthTypeBearer",
    "x-api-key": "aiProviderAuthTypeXApiKey",
    "x-goog-api-key": "aiProviderAuthTypeXGoogApiKey",
    hec: "aiProviderAuthTypeHec",
    "cf-aig-authorization": "aiProviderAuthTypeCfAigAuthorization",
    none: "aiProviderAuthTypeNone",
    passthrough: "aiProviderAuthTypePassthrough"
} as const;

const authDescriptionMap = {
    bearer: "aiProviderAuthTypeBearerDescription",
    "x-api-key": "aiProviderAuthTypeXApiKeyDescription",
    "x-goog-api-key": "aiProviderAuthTypeXGoogApiKeyDescription",
    hec: "aiProviderAuthTypeHecDescription",
    "cf-aig-authorization": "aiProviderAuthTypeCfAigAuthorizationDescription",
    none: "aiProviderAuthTypeNoneDescription",
    passthrough: "aiProviderAuthTypePassthroughDescription"
} as const;

type AiProviderAuthTypeSelectProps = {
    value: AiProviderAuthType;
    onChange: (value: AiProviderAuthType) => void;
    disabled?: boolean;
    className?: string;
};

export function AiProviderAuthTypeSelect({
    value,
    onChange,
    disabled,
    className
}: AiProviderAuthTypeSelectProps) {
    const t = useTranslations();
    const [open, setOpen] = useState(false);

    const options = useMemo(
        () =>
            AI_PROVIDER_AUTH_TYPES.map((authType) => ({
                authType,
                title: t(authLabelMap[authType]),
                description: t(authDescriptionMap[authType])
            })),
        [t]
    );

    const selected = options.find((option) => option.authType === value);

    return (
        <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
                <Button
                    type="button"
                    variant="outline"
                    role="combobox"
                    aria-expanded={open}
                    disabled={disabled}
                    className={cn(
                        "w-full justify-between",
                        !selected && "text-muted-foreground",
                        className
                    )}
                >
                    <span className="truncate text-left">
                        {selected?.title ?? t("noneSelected")}
                    </span>
                    <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                </Button>
            </PopoverTrigger>
            <PopoverContent
                className="w-[var(--radix-popover-trigger-width)] p-0"
                align="start"
            >
                <Command>
                    <CommandInput placeholder={t("aiProviderAuthTypeSearch")} />
                    <CommandList>
                        <CommandEmpty>
                            {t("aiProviderAuthTypeNotFound")}
                        </CommandEmpty>
                        <CommandGroup>
                            {options.map((option) => (
                                <CommandItem
                                    key={option.authType}
                                    value={`${option.authType} ${option.title} ${option.description}`}
                                    onSelect={() => {
                                        onChange(option.authType);
                                        setOpen(false);
                                    }}
                                >
                                    <CheckIcon
                                        className={cn(
                                            "mr-2 h-4 w-4 shrink-0",
                                            option.authType === value
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
    );
}
