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
import { useEnvContext } from "@app/hooks/useEnvContext";
import { useUserContext } from "@app/hooks/useUserContext";
import { cn } from "@app/lib/cn";
import { build } from "@server/build";
import { ListUserOrgsResponse } from "@server/routers/org";
import { CheckIcon, Plus } from "lucide-react";
import { useTranslations } from "next-intl";
import { usePathname, useRouter } from "next/navigation";
import { useMemo, useState, type ReactNode } from "react";

export type OrgPickerProps = {
    orgId?: string;
    orgs?: ListUserOrgsResponse["orgs"];
    contentClassName?: string;
    sideOffset?: number;
    children: ReactNode;
};

export function OrgPicker({
    orgId,
    orgs,
    contentClassName,
    sideOffset = 0,
    children
}: OrgPickerProps) {
    const [open, setOpen] = useState(false);
    const router = useRouter();
    const pathname = usePathname();
    const t = useTranslations();
    const { env } = useEnvContext();
    const { user } = useUserContext();

    let canCreateOrg = !env.flags.disableUserCreateOrg || user.serverAdmin;
    if (build === "saas" && user.type !== "internal") {
        canCreateOrg = false;
    }

    const sortedOrgs = useMemo(() => {
        if (!orgs?.length) {
            return orgs ?? [];
        }
        return [...orgs].sort((a, b) => {
            const aPrimary = Boolean(a.isPrimaryOrg);
            const bPrimary = Boolean(b.isPrimaryOrg);
            if (aPrimary && !bPrimary) return -1;
            if (!aPrimary && bPrimary) return 1;
            return 0;
        });
    }, [orgs]);

    function selectOrg(nextOrgId: string) {
        setOpen(false);
        const newPath = pathname.includes("/settings/")
            ? pathname.replace(/^\/[^/]+/, `/${nextOrgId}`)
            : `/${nextOrgId}`;
        router.push(newPath);
    }

    return (
        <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>{children}</PopoverTrigger>
            <PopoverContent
                className={cn("p-0", contentClassName)}
                align="start"
                sideOffset={sideOffset}
            >
                <Command>
                    <CommandInput placeholder={t("searchPlaceholder")} />
                    <CommandList>
                        <CommandEmpty>{t("orgNotFound2")}</CommandEmpty>
                        <CommandGroup>
                            {sortedOrgs.map((org) => (
                                <CommandItem
                                    key={org.orgId}
                                    value={`${org.orgId} ${org.name}`}
                                    onSelect={() => selectOrg(org.orgId)}
                                >
                                    <CheckIcon
                                        className={cn(
                                            "mr-2 h-4 w-4 shrink-0",
                                            orgId === org.orgId
                                                ? "opacity-100"
                                                : "opacity-0"
                                        )}
                                    />
                                    <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                                        <span className="truncate">
                                            {org.name}
                                        </span>
                                        <span className="text-muted-foreground text-xs leading-snug">
                                            {org.orgId}
                                            {org.isPrimaryOrg
                                                ? ` · ${t("primary")}`
                                                : ""}
                                        </span>
                                    </div>
                                </CommandItem>
                            ))}
                        </CommandGroup>
                    </CommandList>
                </Command>
                {canCreateOrg && (
                    <div className="border-t p-1">
                        <Button
                            variant="ghost"
                            size="sm"
                            className="w-full justify-start font-normal"
                            onClick={() => {
                                setOpen(false);
                                router.push("/setup");
                            }}
                        >
                            <Plus className="h-4 w-4 mr-3" />
                            {t("setupNewOrg")}
                        </Button>
                    </div>
                )}
            </PopoverContent>
        </Popover>
    );
}
