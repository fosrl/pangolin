"use client";

import React, { useState } from "react";
import Link from "next/link";
import { useParams, usePathname } from "next/navigation";
import { cn } from "@app/lib/cn";
import { Badge } from "@app/components/ui/badge";
import { useLicenseStatusContext } from "@app/hooks/useLicenseStatusContext";
import { useTranslations } from "next-intl";

export type TabItem = {
    title: string;
    href: string;
    /** When set, active tab detection uses this path instead of `href` (link target unchanged). */
    activePrefix?: string;
    icon?: React.ReactNode;
    showProfessional?: boolean;
    exact?: boolean;
};

interface HorizontalTabsProps {
    children: React.ReactNode;
    items: TabItem[];
    disabled?: boolean;
    clientSide?: boolean;
    defaultTab?: number;
}

export function HorizontalTabs({
    children,
    items,
    disabled = false,
    clientSide = false,
    defaultTab = 0
}: HorizontalTabsProps) {
    const pathname = usePathname();
    const params = useParams();
    const { licenseStatus, isUnlocked } = useLicenseStatusContext();
    const t = useTranslations();
    const [activeClientTab, setActiveClientTab] = useState(defaultTab);

    function hydrateHref(href: string) {
        return href
            .replace("{orgId}", params.orgId as string)
            .replace("{resourceId}", params.resourceId as string)
            .replace("{niceId}", params.niceId as string)
            .replace("{userId}", params.userId as string)
            .replace("{clientId}", params.clientId as string)
            .replace("{apiKeyId}", params.apiKeyId as string)
            .replace("{providerId}", params.providerId as string)
            .replace("{remoteExitNodeId}", params.remoteExitNodeId as string);
    }

    // Client-side mode: render tabs as buttons with state management
    if (clientSide) {
        const childrenArray = React.Children.toArray(children);
        const activeChild = childrenArray[activeClientTab] || null;

        return (
            <div className="space-y-3">
                <div className="relative">
                    <div className="overflow-x-auto scrollbar-hide">
                        <div className="flex space-x-4 border-b min-w-max">
                            {items.map((item, index) => {
                                const isActive = activeClientTab === index;
                                const isProfessional =
                                    item.showProfessional && !isUnlocked();
                                const isDisabled =
                                    disabled ||
                                    (isProfessional && !isUnlocked());

                                return (
                                    <button
                                        key={index}
                                        type="button"
                                        onClick={() => {
                                            if (!isDisabled) {
                                                setActiveClientTab(index);
                                            }
                                        }}
                                        className={cn(
                                            "px-4 py-2 text-sm font-medium transition-colors whitespace-nowrap relative",
                                            isActive
                                                ? "text-primary after:absolute after:bottom-0 after:left-0 after:right-0 after:h-0.75 after:bg-primary after:rounded-full"
                                                : "text-muted-foreground hover:text-foreground",
                                            isDisabled && "cursor-not-allowed"
                                        )}
                                        disabled={isDisabled}
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
                                                    {t("licenseBadge")}
                                                </Badge>
                                            )}
                                        </div>
                                    </button>
                                );
                            })}
                        </div>
                    </div>
                </div>
                <div className="space-y-6">{activeChild}</div>
            </div>
        );
    }

    // Server-side mode: original behavior with routing
    const activeIndex: number | null = (() => {
        if (pathname.includes("create")) return null;
        let best: number | null = null;
        let bestLen = -1;
        for (let i = 0; i < items.length; i++) {
            const item = items[i];
            const matchBase = hydrateHref(item.activePrefix ?? item.href);
            const matched = item.exact
                ? pathname === matchBase
                : pathname === matchBase ||
                  pathname.startsWith(`${matchBase}/`);
            if (matched && matchBase.length > bestLen) {
                bestLen = matchBase.length;
                best = i;
            }
        }
        return best;
    })();

    return (
        <div className="space-y-3">
            <div className="relative">
                <div className="overflow-x-auto scrollbar-hide">
                    <div className="flex space-x-4 border-b min-w-max">
                        {items.map((item, index) => {
                            const hydratedHref = hydrateHref(item.href);
                            const isActive = activeIndex === index;

                            const isProfessional =
                                item.showProfessional && !isUnlocked();
                            const isDisabled =
                                disabled || (isProfessional && !isUnlocked());

                            return (
                                <Link
                                    key={`${hydratedHref}-${index}`}
                                    href={isProfessional ? "#" : hydratedHref}
                                    className={cn(
                                        "px-4 py-2 text-sm font-medium transition-colors whitespace-nowrap relative",
                                        isActive
                                            ? "text-primary after:absolute after:bottom-0 after:left-0 after:right-0 after:h-0.75 after:bg-primary after:rounded-full"
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
                                                {t("licenseBadge")}
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
