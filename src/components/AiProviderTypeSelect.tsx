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
import { aiProviderTypeValues } from "@app/lib/aiProviderFormSchema";
import type { AiProviderType } from "@app/lib/aiProviderDefaults";
import { CheckIcon, ChevronsUpDown } from "lucide-react";
import { useTranslations } from "next-intl";
import { useMemo, useState } from "react";

export const aiProviderTypeLabelMap = {
    openai: "aiProviderTypeOpenai",
    anthropic: "aiProviderTypeAnthropic",
    googleGemini: "aiProviderTypeGoogleGemini",
    vertexAi: "aiProviderTypeVertexAi",
    bedrock: "aiProviderTypeBedrock",
    microsoftFoundry: "aiProviderTypeMicrosoftFoundry",
    openRouter: "aiProviderTypeOpenRouter",
    vercelAiGateway: "aiProviderTypeVercelAiGateway",
    custom: "aiProviderTypeCustom"
} as const;

const typeDescriptionMap = {
    openai: "aiProviderTypeOpenaiDescription",
    anthropic: "aiProviderTypeAnthropicDescription",
    googleGemini: "aiProviderTypeGoogleGeminiDescription",
    vertexAi: "aiProviderTypeVertexAiDescription",
    bedrock: "aiProviderTypeBedrockDescription",
    microsoftFoundry: "aiProviderTypeMicrosoftFoundryDescription",
    openRouter: "aiProviderTypeOpenRouterDescription",
    vercelAiGateway: "aiProviderTypeVercelAiGatewayDescription",
    custom: "aiProviderTypeCustomDescription"
} as const;

type AiProviderTypeSelectProps = {
    value: AiProviderType;
    onChange: (value: AiProviderType) => void;
    disabled?: boolean;
    className?: string;
};

export function AiProviderTypeSelect({
    value,
    onChange,
    disabled,
    className
}: AiProviderTypeSelectProps) {
    const t = useTranslations();
    const [open, setOpen] = useState(false);

    const options = useMemo(
        () =>
            aiProviderTypeValues.map((type) => ({
                type,
                title: t(aiProviderTypeLabelMap[type]),
                description: t(typeDescriptionMap[type])
            })),
        [t]
    );

    const selected = options.find((option) => option.type === value);

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
                    <CommandInput placeholder={t("aiProviderTypeSearch")} />
                    <CommandList>
                        <CommandEmpty>
                            {t("aiProviderTypeNotFound")}
                        </CommandEmpty>
                        <CommandGroup>
                            {options.map((option) => (
                                <CommandItem
                                    key={option.type}
                                    value={`${option.type} ${option.title} ${option.description}`}
                                    onSelect={() => {
                                        onChange(option.type);
                                        setOpen(false);
                                    }}
                                >
                                    <CheckIcon
                                        className={cn(
                                            "mr-2 h-4 w-4 shrink-0",
                                            option.type === value
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
