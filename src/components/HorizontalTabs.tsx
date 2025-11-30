"use client";

import React from "react";
import Link from "next/link";
import { useParams, usePathname } from "next/navigation";
import { cn } from "@app/lib/cn";
import { Badge } from "@app/components/ui/badge";
import { useLicenseStatusContext } from "@app/hooks/useLicenseStatusContext";
import { useTranslations } from "next-intl";

export type HorizontalTabs = Array<{
    title: string;
    href: string;
    icon?: React.ReactNode;
    showProfessional?: boolean;
}>;

interface HorizontalTabsProps {
    children: React.ReactNode;
    items: HorizontalTabs;
    disabled?: boolean;
}

export function HorizontalTabs({
    children,
    items,
    disabled = false
}: HorizontalTabsProps) {
    const pathname = usePathname();
    const params = useParams();
    const { licenseStatus, isUnlocked } = useLicenseStatusContext();
    const t = useTranslations();

    function hydrateHref(href: string) {
        return href
            .replace("{orgId}", params.orgId as string)
            .replace("{resourceId}", params.resourceId as string)
            .replace("{niceId}", params.niceId as string)
            .replace("{userId}", params.userId as string)
            .replace("{clientId}", params.clientId as string)
            .replace("{apiKeyId}", params.apiKeyId as string);
    }

    return (
        <div className="space-y-6">
            <div className="relative">
                <div className="overflow-x-auto scrollbar-hide">
                    <div className="flex space-x-4 border-b min-w-max">
                        {items.map((item) => {
                            const hydratedHref = hydrateHref(item.href);
                            const isActive =
                                pathname.startsWith(hydratedHref) &&
                                !pathname.includes("create");
                            const isProfessional =
                                item.showProfessional && !isUnlocked();
                            const isDisabled =
                                disabled || (isProfessional && !isUnlocked());

                            return (
                                <Link
                                    key={hydratedHref}
                                    href={isProfessional ? "#" : hydratedHref}
                                    className={cn(
                                        "px-4 py-2 text-sm font-medium transition-colors whitespace-nowrap",
                                        isActive
                                            ? "border-b-2 border-primary text-primary"
                                            : "text-muted-foreground hover:text-foreground",
                                        isDisabled && "cursor-not-allowed"
                                    )}
                                    onClick={(e) => {
                                        if (isDisabled) {
                                            e.preventDefault();
                                        }
                                    }}
                                    tabIndex={isDisabled ? -1 : undefined}
                                    aria-disabled={isDisabled}
                                >
                                    <div
                                        className={cn(
                                            "flex items-center space-x-2",
                                            isDisabled && "opacity-60"
                                        )}
                                    >
                                        {item.icon && item.icon}
                                        <span>{item.title}</span>
                                        {isProfessional && (
                                            <Badge
                                                variant="outlinePrimary"
                                                className="ml-2"
                                            >
                                                {t('licenseBadge')}
                                            </Badge>
                                        )}
                                    </div>
                                </Link>
                            );
                        })}
                    </div>
                </div>
            </div>
            <div className="space-y-6">{children}</div>
        </div>
    );
}
