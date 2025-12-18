"use client";

import React from "react";
import Link from "next/link";
import { useParams, usePathname } from "next/navigation";
import { cn } from "@app/lib/cn";
import { useUserContext } from "@app/hooks/useUserContext";
import { Badge } from "@app/components/ui/badge";
import { useLicenseStatusContext } from "@app/hooks/useLicenseStatusContext";
import { useTranslations } from "next-intl";
import {
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger
} from "@app/components/ui/tooltip";
import {
    Collapsible,
    CollapsibleContent,
    CollapsibleTrigger
} from "@app/components/ui/collapsible";
import {
    Popover,
    PopoverContent,
    PopoverTrigger
} from "@app/components/ui/popover";
import { ChevronDown } from "lucide-react";
import { build } from "@server/build";

export type SidebarNavItem = {
    href?: string;
    title: string;
    icon?: React.ReactNode;
    showEE?: boolean;
    isBeta?: boolean;
    items?: SidebarNavItem[];
};

export type SidebarNavSection = {
    heading: string;
    items: SidebarNavItem[];
};

export interface SidebarNavProps extends React.HTMLAttributes<HTMLElement> {
    sections: SidebarNavSection[];
    disabled?: boolean;
    onItemClick?: () => void;
    isCollapsed?: boolean;
}

type CollapsibleNavItemProps = {
    item: SidebarNavItem;
    level: number;
    isChildActive: boolean;
    isDisabled: boolean;
    isCollapsed: boolean;
    renderNavItem: (item: SidebarNavItem, level: number) => React.ReactNode;
    t: (key: string) => string;
    build: string;
    isUnlocked: () => boolean;
};

function CollapsibleNavItem({
    item,
    level,
    isChildActive,
    isDisabled,
    isCollapsed,
    renderNavItem,
    t,
    build,
    isUnlocked
}: CollapsibleNavItemProps) {
    const storageKey = `pangolin-sidebar-expanded-${item.title}`;

    // Get initial state from localStorage or use isChildActive
    const getInitialState = (): boolean => {
        if (typeof window === "undefined") {
            return isChildActive;
        }
        const saved = localStorage.getItem(storageKey);
        if (saved !== null) {
            return saved === "true";
        }
        return isChildActive;
    };

    const [isOpen, setIsOpen] = React.useState(getInitialState);

    // Update open state when child active state changes (but don't override user preference)
    React.useEffect(() => {
        if (isChildActive) {
            setIsOpen(true);
        }
    }, [isChildActive]);

    // Save state to localStorage when it changes
    const handleOpenChange = (open: boolean) => {
        setIsOpen(open);
        if (typeof window !== "undefined") {
            localStorage.setItem(storageKey, String(open));
        }
    };

    return (
        <Collapsible
            key={item.title}
            open={isOpen}
            onOpenChange={handleOpenChange}
            className="group/collapsible"
        >
            <CollapsibleTrigger asChild>
                <button
                    className={cn(
                        "flex items-center w-full rounded transition-colors hover:bg-secondary/80 dark:hover:bg-secondary/50 rounded-md",
                        level === 0 ? "p-3 py-1.5" : "py-1.5",
                        isChildActive
                            ? "text-primary font-medium"
                            : "text-muted-foreground hover:text-foreground",
                        isDisabled && "cursor-not-allowed opacity-60"
                    )}
                    disabled={isDisabled}
                >
                    {item.icon && (
                        <span className="flex-shrink-0 mr-2">{item.icon}</span>
                    )}
                    <div className="flex items-center gap-1.5 flex-1">
                        <span className="text-left">{t(item.title)}</span>
                        {item.isBeta && (
                            <Badge
                                variant="outline"
                                className="text-muted-foreground"
                            >
                                {t("beta")}
                            </Badge>
                        )}
                    </div>
                    <div className="flex items-center gap-1.5">
                        {build === "enterprise" &&
                            item.showEE &&
                            !isUnlocked() && (
                                <Badge variant="outlinePrimary">
                                    {t("licenseBadge")}
                                </Badge>
                            )}
                        <ChevronDown
                            className={cn(
                                "h-4 w-4 transition-transform duration-300 ease-in-out",
                                "group-data-[state=open]/collapsible:rotate-180"
                            )}
                        />
                    </div>
                </button>
            </CollapsibleTrigger>
            <CollapsibleContent>
                <div
                    className={cn(
                        "border-l ml-3 pl-2 mt-1 space-y-1",
                        "border-border"
                    )}
                >
                    {item.items!.map((childItem) =>
                        renderNavItem(childItem, level + 1)
                    )}
                </div>
            </CollapsibleContent>
        </Collapsible>
    );
}

export function SidebarNav({
    className,
    sections,
    disabled = false,
    onItemClick,
    isCollapsed = false,
    ...props
}: SidebarNavProps) {
    const pathname = usePathname();
    const params = useParams();
    const orgId = params.orgId as string;
    const niceId = params.niceId as string;
    const resourceId = params.resourceId as string;
    const userId = params.userId as string;
    const apiKeyId = params.apiKeyId as string;
    const clientId = params.clientId as string;
    const { licenseStatus, isUnlocked } = useLicenseStatusContext();
    const { user } = useUserContext();
    const t = useTranslations();

    function hydrateHref(val?: string): string | undefined {
        if (!val) return undefined;
        return val
            .replace("{orgId}", orgId)
            .replace("{niceId}", niceId)
            .replace("{resourceId}", resourceId)
            .replace("{userId}", userId)
            .replace("{apiKeyId}", apiKeyId)
            .replace("{clientId}", clientId);
    }

    function isItemOrChildActive(item: SidebarNavItem): boolean {
        const hydratedHref = hydrateHref(item.href);
        if (hydratedHref && pathname.startsWith(hydratedHref)) {
            return true;
        }
        if (item.items) {
            return item.items.some((child) => isItemOrChildActive(child));
        }
        return false;
    }

    const renderNavItem = (
        item: SidebarNavItem,
        level: number = 0
    ): React.ReactNode => {
        const hydratedHref = hydrateHref(item.href);
        const hasNestedItems = item.items && item.items.length > 0;
        const isActive = hydratedHref
            ? pathname.startsWith(hydratedHref)
            : false;
        const isChildActive = hasNestedItems
            ? isItemOrChildActive(item)
            : false;
        const isEE = build === "enterprise" && item.showEE && !isUnlocked();
        const isDisabled = disabled || isEE;
        const tooltipText =
            item.showEE && !isUnlocked()
                ? `${t(item.title)} (${t("licenseBadge")})`
                : t(item.title);

        // If item has nested items, render as collapsible
        if (hasNestedItems && !isCollapsed) {
            return (
                <CollapsibleNavItem
                    key={item.title}
                    item={item}
                    level={level}
                    isChildActive={isChildActive}
                    isDisabled={isDisabled || false}
                    isCollapsed={isCollapsed}
                    renderNavItem={renderNavItem}
                    t={t}
                    build={build}
                    isUnlocked={isUnlocked}
                />
            );
        }

        // Regular item without nested items
        const itemContent = hydratedHref ? (
            <Link
                href={isDisabled ? "#" : hydratedHref}
                className={cn(
                    "flex items-center rounded transition-colors hover:bg-secondary/80 dark:hover:bg-secondary/50 rounded-md",
                    isCollapsed ? "px-2 py-2 justify-center" : "px-3 py-1.5",
                    isActive
                        ? "text-primary font-medium"
                        : "text-muted-foreground hover:text-foreground",
                    isDisabled && "cursor-not-allowed opacity-60"
                )}
                onClick={(e) => {
                    if (isDisabled) {
                        e.preventDefault();
                    } else if (onItemClick) {
                        onItemClick();
                    }
                }}
                tabIndex={isDisabled ? -1 : undefined}
                aria-disabled={isDisabled}
            >
                {item.icon && (
                    <span
                        className={cn("flex-shrink-0", !isCollapsed && "mr-2")}
                    >
                        {item.icon}
                    </span>
                )}
                {!isCollapsed && (
                    <>
                        <div className="flex items-center gap-1.5 flex-1">
                            <span>{t(item.title)}</span>
                            {item.isBeta && (
                                <Badge
                                    variant="outline"
                                    className="text-muted-foreground"
                                >
                                    {t("beta")}
                                </Badge>
                            )}
                        </div>
                        {build === "enterprise" &&
                            item.showEE &&
                            !isUnlocked() && (
                                <Badge variant="outlinePrimary">
                                    {t("licenseBadge")}
                                </Badge>
                            )}
                    </>
                )}
            </Link>
        ) : (
            <div
                className={cn(
                    "flex items-center rounded transition-colors px-3 py-1.5",
                    "text-muted-foreground",
                    isDisabled && "cursor-not-allowed opacity-60"
                )}
            >
                {item.icon && (
                    <span className="flex-shrink-0 mr-2">{item.icon}</span>
                )}
                <div className="flex items-center gap-1.5 flex-1">
                    <span>{t(item.title)}</span>
                    {item.isBeta && (
                        <Badge
                            variant="outline"
                            className="text-muted-foreground"
                        >
                            {t("beta")}
                        </Badge>
                    )}
                </div>
                {build === "enterprise" && item.showEE && !isUnlocked() && (
                    <Badge variant="outlinePrimary">{t("licenseBadge")}</Badge>
                )}
            </div>
        );

        if (isCollapsed) {
            // If item has nested items, show both tooltip and popover
            if (hasNestedItems) {
                return (
                    <TooltipProvider key={item.title}>
                        <Tooltip>
                            <Popover>
                                <PopoverTrigger asChild>
                                    <TooltipTrigger asChild>
                                        <button
                                            className={cn(
                                                "flex items-center rounded transition-colors hover:bg-secondary/80 dark:hover:bg-secondary/50 rounded-md px-2 py-2 justify-center w-full",
                                                isChildActive
                                                    ? "text-primary font-medium"
                                                    : "text-muted-foreground hover:text-foreground",
                                                isDisabled &&
                                                    "cursor-not-allowed opacity-60"
                                            )}
                                            disabled={isDisabled}
                                        >
                                            {item.icon && (
                                                <span className="flex-shrink-0">
                                                    {item.icon}
                                                </span>
                                            )}
                                        </button>
                                    </TooltipTrigger>
                                </PopoverTrigger>
                                <TooltipContent side="right" sideOffset={8}>
                                    <p>{tooltipText}</p>
                                </TooltipContent>
                                <PopoverContent
                                    side="right"
                                    align="start"
                                    className="w-56 p-1"
                                >
                                    <div className="space-y-1">
                                        {item.items!.map((childItem) => {
                                            const childHydratedHref =
                                                hydrateHref(childItem.href);
                                            const childIsActive =
                                                childHydratedHref
                                                    ? pathname.startsWith(
                                                          childHydratedHref
                                                      )
                                                    : false;
                                            const childIsEE =
                                                build === "enterprise" &&
                                                childItem.showEE &&
                                                !isUnlocked();
                                            const childIsDisabled =
                                                disabled || childIsEE;

                                            if (!childHydratedHref) {
                                                return null;
                                            }

                                            return (
                                                <Link
                                                    key={childItem.title}
                                                    href={
                                                        childIsDisabled
                                                            ? "#"
                                                            : childHydratedHref
                                                    }
                                                    className={cn(
                                                        "flex items-center rounded transition-colors px-3 py-1.5 text-sm",
                                                        childIsActive
                                                            ? "bg-secondary text-primary font-medium"
                                                            : "text-muted-foreground hover:bg-secondary/50 hover:text-foreground",
                                                        childIsDisabled &&
                                                            "cursor-not-allowed opacity-60"
                                                    )}
                                                    onClick={(e) => {
                                                        if (childIsDisabled) {
                                                            e.preventDefault();
                                                        } else if (
                                                            onItemClick
                                                        ) {
                                                            onItemClick();
                                                        }
                                                    }}
                                                >
                                                    {childItem.icon && (
                                                        <span className="flex-shrink-0 mr-2">
                                                            {childItem.icon}
                                                        </span>
                                                    )}
                                                    <div className="flex items-center gap-1.5 flex-1">
                                                        <span>
                                                            {t(childItem.title)}
                                                        </span>
                                                        {childItem.isBeta && (
                                                            <Badge
                                                                variant="outline"
                                                                className="text-muted-foreground"
                                                            >
                                                                {t("beta")}
                                                            </Badge>
                                                        )}
                                                    </div>
                                                    {build === "enterprise" &&
                                                        childItem.showEE &&
                                                        !isUnlocked() && (
                                                            <Badge variant="outlinePrimary">
                                                                {t(
                                                                    "licenseBadge"
                                                                )}
                                                            </Badge>
                                                        )}
                                                </Link>
                                            );
                                        })}
                                    </div>
                                </PopoverContent>
                            </Popover>
                        </Tooltip>
                    </TooltipProvider>
                );
            }

            // Regular item without nested items - show tooltip
            return (
                <TooltipProvider key={item.title}>
                    <Tooltip>
                        <TooltipTrigger asChild>{itemContent}</TooltipTrigger>
                        <TooltipContent side="right" sideOffset={8}>
                            <p>{tooltipText}</p>
                        </TooltipContent>
                    </Tooltip>
                </TooltipProvider>
            );
        }

        return <React.Fragment key={item.title}>{itemContent}</React.Fragment>;
    };

    return (
        <nav
            className={cn(
                "flex flex-col gap-2 text-sm",
                disabled && "pointer-events-none opacity-60",
                className
            )}
            {...props}
        >
            {sections.map((section) => (
                <div key={section.heading} className="mb-2">
                    {!isCollapsed && (
                        <div className="px-3 py-1 text-xs font-semibold text-muted-foreground/70 uppercase tracking-wide">
                            {t(`${section.heading}`)}
                        </div>
                    )}
                    <div className="flex flex-col gap-1">
                        {section.items.map((item) => renderNavItem(item, 0))}
                    </div>
                </div>
            ))}
        </nav>
    );
}
