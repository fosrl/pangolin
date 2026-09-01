"use client";

import { Button } from "@app/components/ui/button";
import { CommandShortcut } from "@app/components/ui/command";
import { cn } from "@app/lib/cn";
import { Search } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { ListUserOrgsResponse } from "@server/routers/org";
import { useCommandPalette } from "./CommandPalette";
import { useCanUseCommandPalette } from "./useCanUseCommandPalette";

type CommandPaletteTriggerProps = {
    variant?: "header" | "mobile";
    className?: string;
    orgId?: string;
    orgs?: ListUserOrgsResponse["orgs"];
};

function useIsMac() {
    const [isMac, setIsMac] = useState(false);

    useEffect(() => {
        setIsMac(/Mac|iPhone|iPod|iPad/.test(navigator.platform));
    }, []);

    return isMac;
}

export function CommandPaletteTrigger({
    variant = "header",
    className,
    orgId,
    orgs
}: CommandPaletteTriggerProps) {
    const t = useTranslations();
    const { setOpen } = useCommandPalette();
    const isMac = useIsMac();
    const canUseCommandPalette = useCanUseCommandPalette(orgId, orgs);

    if (!canUseCommandPalette) {
        return null;
    }

    if (variant === "mobile") {
        return (
            <Button
                variant="ghost"
                size="icon"
                className={className}
                aria-label={t("commandPaletteTitle")}
                onClick={() => setOpen(true)}
            >
                <Search className="size-5" />
            </Button>
        );
    }

    return (
        <Button
            variant="outline"
            className={cn(
                "relative hidden h-9 w-56 justify-start pl-8 pr-3 text-muted-foreground md:flex lg:w-64",
                className
            )}
            aria-label={t("commandPaletteTitle")}
            onClick={() => setOpen(true)}
        >
            <Search className="absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <span className="flex-1 truncate text-left text-sm font-normal">
                {t("commandPaletteSearchPlaceholder")}
            </span>
            <CommandShortcut>
                {isMac
                    ? t("commandPaletteShortcutMac")
                    : t("commandPaletteShortcutWindows")}
            </CommandShortcut>
        </Button>
    );
}
