"use client";

import { useState } from "react";
import { Badge, badgeVariants } from "@app/components/ui/badge";
import {
    Popover,
    PopoverContent,
    PopoverTrigger
} from "@app/components/ui/popover";
import { cn } from "@app/lib/cn";
import { useTranslations } from "next-intl";

const MAX_ROLE_BADGES = 3;

export default function UserRoleBadges({
    roleLabels,
    isOwner
}: {
    roleLabels: string[];
    isOwner?: boolean;
}) {
    const t = useTranslations();
    const visible = roleLabels.slice(0, MAX_ROLE_BADGES);
    const overflow = roleLabels.slice(MAX_ROLE_BADGES);

    return (
        <div className="flex flex-wrap items-center gap-1">
            {isOwner && (
                <Badge variant="secondary">{t("accessRoleOwner")}</Badge>
            )}
            {visible.map((label, i) => (
                <Badge key={`${label}-${i}`} variant="secondary">
                    {label}
                </Badge>
            ))}
            {overflow.length > 0 && <OverflowRolesPopover labels={overflow} />}
        </div>
    );
}

function OverflowRolesPopover({ labels }: { labels: string[] }) {
    const [open, setOpen] = useState(false);

    return (
        <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
                <button
                    type="button"
                    className={cn(
                        badgeVariants({ variant: "secondary" }),
                        "border-dashed"
                    )}
                    onMouseEnter={() => setOpen(true)}
                    onMouseLeave={() => setOpen(false)}
                >
                    +{labels.length}
                </button>
            </PopoverTrigger>
            <PopoverContent
                align="start"
                side="top"
                className="w-auto max-w-xs p-2"
                onMouseEnter={() => setOpen(true)}
                onMouseLeave={() => setOpen(false)}
            >
                <ul className="space-y-1 text-sm">
                    {labels.map((label, i) => (
                        <li key={`${label}-${i}`}>{label}</li>
                    ))}
                </ul>
            </PopoverContent>
        </Popover>
    );
}
