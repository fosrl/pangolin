"use client";

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
import { ListUserOrgsResponse } from "@server/routers/org";
import { Check, ChevronDown, ChevronsUpDown } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@app/components/ui/button";

type LauncherOrgSelectorProps = {
    orgId?: string;
    orgs?: ListUserOrgsResponse["orgs"];
};

export function LauncherOrgSelector({ orgId, orgs }: LauncherOrgSelectorProps) {
    const [open, setOpen] = useState(false);
    const router = useRouter();
    const pathname = usePathname();
    const t = useTranslations();

    const selectedOrg = orgs?.find((org) => org.orgId === orgId);

    const sortedOrgs = useMemo(() => {
        if (!orgs?.length) {
            return orgs ?? [];
        }
        return [...orgs].sort((a, b) => {
            const aPrimary = Boolean(a.isPrimaryOrg);
            const bPrimary = Boolean(b.isPrimaryOrg);
            if (aPrimary && !bPrimary) {
                return -1;
            }
            if (!aPrimary && bPrimary) {
                return 1;
            }
            return 0;
        });
    }, [orgs]);

    return (
        <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
                <Button
                    className="inline-flex items-center gap-1 p-0"
                    variant="text"
                    size="sm"
                >
                    <span className="truncate max-w-[200px]">
                        {selectedOrg?.name ?? t("noneSelected")}
                    </span>
                    <ChevronDown className="size-4 shrink-0" />
                </Button>
            </PopoverTrigger>
            <PopoverContent className="w-[320px] p-0" align="start">
                <Command className="rounded-lg border-0">
                    <CommandInput placeholder={t("searchPlaceholder")} />
                    <CommandList className="max-h-[280px]">
                        <CommandEmpty>{t("orgNotFound2")}</CommandEmpty>
                        <CommandGroup heading={t("orgs")}>
                            {sortedOrgs.map((org) => (
                                <CommandItem
                                    key={org.orgId}
                                    onSelect={() => {
                                        setOpen(false);
                                        const newPath = pathname.includes(
                                            "/settings/"
                                        )
                                            ? pathname.replace(
                                                  /^\/[^/]+/,
                                                  `/${org.orgId}`
                                              )
                                            : `/${org.orgId}`;
                                        router.push(newPath);
                                    }}
                                >
                                    <div className="flex flex-col flex-1 min-w-0">
                                        <span className="font-medium truncate text-sm">
                                            {org.name}
                                        </span>
                                        <span className="text-xs text-muted-foreground font-mono truncate">
                                            {org.orgId}
                                        </span>
                                    </div>
                                    <Check
                                        className={cn(
                                            "h-4 w-4 text-primary shrink-0",
                                            orgId === org.orgId
                                                ? "opacity-100"
                                                : "opacity-0"
                                        )}
                                    />
                                </CommandItem>
                            ))}
                        </CommandGroup>
                    </CommandList>
                </Command>
            </PopoverContent>
        </Popover>
    );
}
