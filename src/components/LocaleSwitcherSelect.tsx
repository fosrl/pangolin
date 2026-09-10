"use client";

import {
    DropdownMenuItem,
    DropdownMenuSub,
    DropdownMenuSubContent,
    DropdownMenuSubTrigger
} from "@app/components/ui/dropdown-menu";
import { Check, Languages } from "lucide-react";
import { useTransition } from "react";
import { Locale } from "@/i18n/config";
import { setUserLocale } from "@/services/locale";
import { createApiClient } from "@app/lib/api";
import { useEnvContext } from "@app/hooks/useEnvContext";
import { cn } from "@app/lib/cn";

type Props = {
    defaultValue: string;
    items: Array<{ value: string; label: string }>;
    label: string;
};

export default function LocaleSwitcherSelect({
    defaultValue,
    items,
    label
}: Props) {
    const [isPending, startTransition] = useTransition();
    const api = createApiClient(useEnvContext());

    function onChange(value: string) {
        const locale = value as Locale;
        startTransition(() => {
            setUserLocale(locale);
        });
        // Persist locale to the database (fire-and-forget)
        api.post("/user/locale", { locale }).catch(() => {
            // Silently ignore errors - cookie is already set as fallback
        });
    }

    const selected = items.find((item) => item.value === defaultValue);

    return (
        <DropdownMenuSub>
            <DropdownMenuSubTrigger
                className={cn(
                    "[&_svg:not([class*='text-'])]:text-muted-foreground",
                    isPending && "pointer-events-none"
                )}
                aria-label={label}
            >
                <Languages className="mr-2 h-4 w-4" />
                <span>{selected?.label ?? label}</span>
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent className="min-w-[8rem]">
                {items.map((item) => (
                    <DropdownMenuItem
                        key={item.value}
                        onClick={() => onChange(item.value)}
                        className="flex items-center gap-2"
                    >
                        {item.value === defaultValue && (
                            <Check className="h-4 w-4" />
                        )}
                        <span>{item.label}</span>
                    </DropdownMenuItem>
                ))}
            </DropdownMenuSubContent>
        </DropdownMenuSub>
    );
}
