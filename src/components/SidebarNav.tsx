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
import { ChevronRight } from "lucide-react";
import { build } from "@server/build";

export type SidebarNavItem = {
    href?: string;
    title: string;
    icon?: React.ReactNode;
    showEE?: boolean;
    isBeta?: boolean;
    items?: SidebarNavItem[];
    exact?: boolean;
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
    notificationCounts?: Record<string, number | undefined>;
}

function isPathActive(
    pathname: string,
    href: string,
    exact?: boolean
): boolean {
    if (exact) {
        return pathname === href;
    }
    return pathname === href || pathname.startsWith(`${href}/`);
}

type CollapsibleNavItemProps = {
    item: SidebarNavItem;
    level: number;
    isActive: boolean;
    isChildActive: boolean;
    isDisabled: boolean;
    isCollapsed: boolean;
    renderNavItem: (item: SidebarNavItem, level: number) => React.ReactNode;
    t: (key: string) => string;
    build: string;
    isUnlocked: () => boolean;
    getNotificationCount: (item: SidebarNavItem) => number | undefined;
};

function CollapsibleNavItem({
    item,
    level,
    isActive,
    isChildActive,
    isDisabled,
    isCollapsed,
    renderNavItem,
    t,
    build,
    isUnlocked,
    getNotificationCount
}: CollapsibleNavItemProps) {
    const notificationCount = getNotificationCount(item);
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
                        "flex items-center w-full rounded-md transition-colors",
                        "px-3 py-1.5",
                        isActive
                            ? "bg-sidebar-accent font-medium"
                            : "text-muted-foreground hover:bg-sidebar-accent dark:hover:bg-sidebar-accent/50 hover:text-foreground",
                        isDisabled && "cursor-not-allowed opacity-60"
                    )}
                    disabled={isDisabled}
                >
                    {item.icon && (
                        <span className="flex-shrink-0 mr-3 w-5 h-5 flex items-center justify-center text-muted-foreground">
                            {item.icon}
                        </span>
                    )}
                    <div className="flex items-center gap-2 flex-1 min-w-0">
                        <span className="text-left truncate">
                            {t(item.title)}
                        </span>
                        {item.isBeta && (
                            <span className="uppercase font-mono text-yellow-600 dark:text-yellow-800 font-black text-xs">
                                {t("beta")}
                            </span>
                        )}
                    </div>
                    <div className="flex items-center gap-1.5 flex-shrink-0 ml-2">
                        {notificationCount !== undefined &&
                            notificationCount > 0 && (
                                <Badge variant="secondary">
                                    {notificationCount > 99
                                        ? "99+"
                                        : notificationCount}
                                </Badge>
                            )}
                        {build === "enterprise" &&
                            item.showEE &&
                            !isUnlocked() && (
                                <Badge variant="outlinePrimary">
                                    {t("licenseBadge")}
                                </Badge>
                            )}
                        <ChevronRight
                            className={cn(
                                "h-4 w-4 transition-transform duration-300 ease-in-out text-muted-foreground",
                                "group-data-[state=open]/collapsible:rotate-90"
                            )}
                        />
                    </div>
                </button>
            </CollapsibleTrigger>
            <CollapsibleContent forceMount>
                <div
                    className={cn(
                        "grid overflow-hidden transition-[grid-template-rows] duration-200 ease-in-out",
                        isOpen ? "grid-rows-[1fr]" : "grid-rows-[0fr]"
                    )}
                >
                    <div className="min-h-0">
                        <div
                            className={cn(
                                "border-l ml-[22px] pl-[9px] mt-0 space-y-0",
                                "border-border"
                            )}
                        >
                            {item.items!.map((childItem) =>
                                renderNavItem(childItem, level + 1)
                            )}
                        </div>
                    </div>
                </div>
            </CollapsibleContent>
        </Collapsible>
    );
}

type CollapsedNavItemWithPopoverProps = {
    item: SidebarNavItem;
    tooltipText: string;
    isActive: boolean;
    isChildActive: boolean;
    isDisabled: boolean;
    hydrateHref: (val?: string) => string | undefined;
    pathname: string;
    build: string;
    isUnlocked: () => boolean;
    disabled: boolean;
    t: (key: string) => string;
    onItemClick?: () => void;
};

const TOOLTIP_SUPPRESS_MS = 400;

function CollapsedNavItemWithPopover({
    item,
    tooltipText,
    isActive,
    isChildActive,
    isDisabled,
    hydrateHref,
    pathname,
    build,
    isUnlocked,
    disabled,
    t,
    onItemClick
}: CollapsedNavItemWithPopoverProps) {
    const [popoverOpen, setPopoverOpen] = React.useState(false);
    const [tooltipOpen, setTooltipOpen] = React.useState(false);
    const suppressTooltipRef = React.useRef(false);

    const handlePopoverOpenChange = React.useCallback((open: boolean) => {
        setPopoverOpen(open);
        if (!open) {
            setTooltipOpen(false);
            suppressTooltipRef.current = true;
            window.setTimeout(() => {
                suppressTooltipRef.current = false;
            }, TOOLTIP_SUPPRESS_MS);
        }
    }, []);

    const handleTooltipOpenChange = React.useCallback((open: boolean) => {
        if (open && suppressTooltipRef.current) return;
        setTooltipOpen(open);
    }, []);

    return (
        <TooltipProvider>
            <Tooltip open={tooltipOpen} onOpenChange={handleTooltipOpenChange}>
                <Popover
                    open={popoverOpen}
                    onOpenChange={handlePopoverOpenChange}
                >
                    <PopoverTrigger asChild>
                        <TooltipTrigger asChild>
                            <button
                                className={cn(
                                    "flex items-center rounded-md transition-colors px-2 py-2 justify-center w-full",
                                    isActive || isChildActive
                                        ? "bg-sidebar-accent font-medium"
                                        : "text-muted-foreground hover:bg-sidebar-accent dark:hover:bg-sidebar-accent/50 hover:text-foreground",
                                    isDisabled &&
                                        "cursor-not-allowed opacity-60"
                                )}
                                disabled={isDisabled}
                            >
                                {item.icon && (
                                    <span className="flex-shrink-0 w-5 h-5 flex items-center justify-center text-muted-foreground">
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
                                const childHydratedHref = hydrateHref(
                                    childItem.href
                                );
                                const childIsActive = childHydratedHref
                                    ? isPathActive(
                                          pathname,
                                          childHydratedHref,
                                          childItem.exact
                                      )
                                    : false;
                                const childIsEE =
                                    build === "enterprise" &&
                                    childItem.showEE &&
                                    !isUnlocked();
                                const childIsDisabled = disabled || childIsEE;

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
                                            "flex items-center rounded-md transition-colors px-3 py-1.5 text-sm",
                                            childIsActive
                                                ? "bg-sidebar-accent font-medium"
                                                : "text-muted-foreground hover:bg-sidebar-accent/50 hover:text-foreground",
                                            childIsDisabled &&
                                                "cursor-not-allowed opacity-60"
                                        )}
                                        onClick={(e) => {
                                            if (childIsDisabled) {
                                                e.preventDefault();
                                            } else {
                                                handlePopoverOpenChange(false);
                                                onItemClick?.();
                                            }
                                        }}
                                    >
                                        <div className="flex items-center gap-2 flex-1 min-w-0">
                                            <span className="truncate">
                                                {t(childItem.title)}
                                            </span>
                                            {childItem.isBeta && (
                                                <span className="uppercase font-mono text-yellow-600 dark:text-yellow-800 font-black text-xs">
                                                    {t("beta")}
                                                </span>
                                            )}
                                        </div>
                                        {build === "enterprise" &&
                                            childItem.showEE &&
                                            !isUnlocked() && (
                                                <Badge
                                                    variant="outlinePrimary"
                                                    className="flex-shrink-0 ml-2"
                                                >
                                                    {t("licenseBadge")}
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

export function SidebarNav({
    className,
    sections,
    disabled = false,
    onItemClick,
    isCollapsed = false,
    notificationCounts,
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

    function getNotificationCount(item: SidebarNavItem): number | undefined {
        if (!notificationCounts) return undefined;
        return notificationCounts[item.title];
    }

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
        if (hydratedHref && isPathActive(pathname, hydratedHref, item.exact)) {
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
            ? isPathActive(pathname, hydratedHref, item.exact)
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
                    isActive={isActive}
                    isChildActive={isChildActive}
                    isDisabled={isDisabled || false}
                    isCollapsed={isCollapsed}
                    renderNavItem={renderNavItem}
                    t={t}
                    build={build}
                    isUnlocked={isUnlocked}
                    getNotificationCount={getNotificationCount}
                />
            );
        }

        const notificationCount = getNotificationCount(item);

        // Regular item without nested items
        const itemContent = hydratedHref ? (
            <Link
                href={isDisabled ? "#" : hydratedHref}
                className={cn(
                    "flex items-center rounded-md transition-colors relative",
                    isCollapsed ? "px-2 py-2 justify-center" : "px-3 py-1.5",
                    isActive
                        ? "bg-sidebar-accent font-medium"
                        : "text-muted-foreground hover:bg-sidebar-accent dark:hover:bg-sidebar-accent/50 hover:text-foreground",
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
                {item.icon && level === 0 && (
                    <span
                        className={cn(
                            "flex-shrink-0 w-5 h-5 flex items-center justify-center",
                            isCollapsed
                                ? "text-muted-foreground"
                                : "text-muted-foreground",
                            !isCollapsed && "mr-3"
                        )}
                    >
                        {item.icon}
                    </span>
                )}
                {!isCollapsed && (
                    <>
                        <div className="flex items-center gap-2 flex-1 min-w-0">
                            <span className="truncate">{t(item.title)}</span>
                            {item.isBeta && (
                                <span className="uppercase font-mono text-yellow-600 dark:text-yellow-800 font-black text-xs">
                                    {t("beta")}
                                </span>
                            )}
                        </div>
                        <div className="flex items-center gap-1.5 flex-shrink-0">
                            {notificationCount !== undefined &&
                                notificationCount > 0 && (
                                    <Badge variant="secondary">
                                        {notificationCount > 99
                                            ? "99+"
                                            : notificationCount}
                                    </Badge>
                                )}
                            {build === "enterprise" &&
                                item.showEE &&
                                !isUnlocked() && (
                                    <Badge
                                        variant="outlinePrimary"
                                        className="flex-shrink-0"
                                    >
                                        {t("licenseBadge")}
                                    </Badge>
                                )}
                        </div>
                    </>
                )}
                {isCollapsed &&
                    notificationCount !== undefined &&
                    notificationCount > 0 && (
                        <Badge
                            variant="secondary"
                            className="absolute -top-1 -right-1 h-5 min-w-5 px-1.5 flex items-center justify-center text-xs"
                        >
                            {notificationCount > 99 ? "99+" : notificationCount}
                        </Badge>
                    )}
            </Link>
        ) : (
            <div
                className={cn(
                    "flex items-center rounded-md transition-colors",
                    "px-3 py-1.5",
                    "text-muted-foreground",
                    isDisabled && "cursor-not-allowed opacity-60"
                )}
            >
                {item.icon && level === 0 && (
                    <span className="flex-shrink-0 mr-3 w-5 h-5 flex items-center justify-center text-muted-foreground">
                        {item.icon}
                    </span>
                )}
                <div className="flex items-center gap-2 flex-1 min-w-0">
                    <span className="truncate">{t(item.title)}</span>
                    {item.isBeta && (
                        <span className="uppercase font-mono text-yellow-600 dark:text-yellow-800 font-black text-xs">
                            {t("beta")}
                        </span>
                    )}
                </div>
                <div className="flex items-center gap-1.5 flex-shrink-0 ml-2">
                    {notificationCount !== undefined &&
                        notificationCount > 0 && (
                            <Badge
                                variant="secondary"
                                className="flex-shrink-0 bg-primary text-primary-foreground"
                            >
                                {notificationCount > 99
                                    ? "99+"
                                    : notificationCount}
                            </Badge>
                        )}
                    {build === "enterprise" && item.showEE && !isUnlocked() && (
                        <Badge
                            variant="outlinePrimary"
                            className="flex-shrink-0"
                        >
                            {t("licenseBadge")}
                        </Badge>
                    )}
                </div>
            </div>
        );

        if (isCollapsed) {
            // If item has nested items, show both tooltip and popover
            if (hasNestedItems) {
                return (
                    <CollapsedNavItemWithPopover
                        key={item.title}
                        item={item}
                        tooltipText={tooltipText}
                        isActive={isActive}
                        isChildActive={isChildActive}
                        isDisabled={!!isDisabled}
                        hydrateHref={hydrateHref}
                        pathname={pathname}
                        build={build}
                        isUnlocked={isUnlocked}
                        disabled={disabled ?? false}
                        t={t}
                        onItemClick={onItemClick}
                    />
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
                "flex flex-col text-sm",
                disabled && "pointer-events-none opacity-60",
                className
            )}
            {...props}
        >
            {sections.map((section, sectionIndex) => (
                <div
                    key={section.heading}
                    className={cn(sectionIndex > 0 && "mt-4")}
                >
                    {!isCollapsed && (
                        <div className="px-3 py-2 text-xs font-medium text-foreground uppercase tracking-wider">
                            {t(`${section.heading}`)}
                        </div>
                    )}
                    <div className="flex flex-col gap-0">
                        {section.items.map((item) => renderNavItem(item, 0))}
                    </div>
                </div>
            ))}
        </nav>
    );
}
