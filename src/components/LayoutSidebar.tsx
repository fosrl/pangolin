"use client";

import type { SidebarNavSection } from "@app/app/navigation";
import { OrgSelector } from "@app/components/OrgSelector";
import { SidebarNav } from "@app/components/SidebarNav";
import {
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger
} from "@app/components/ui/tooltip";
import { useEnvContext } from "@app/hooks/useEnvContext";
import { useLicenseStatusContext } from "@app/hooks/useLicenseStatusContext";
import { useUserContext } from "@app/hooks/useUserContext";
import { useSubscriptionStatusContext } from "@app/hooks/useSubscriptionStatusContext";
import { cn } from "@app/lib/cn";
import { approvalQueries } from "@app/lib/queries";
import { build } from "@server/build";
import { useQuery } from "@tanstack/react-query";
import { ListUserOrgsResponse } from "@server/routers/org";
import {
    ArrowRight,
    ExternalLink,
    PanelRightOpen,
    Server,
    SquareMousePointer
} from "lucide-react";
import { useTranslations } from "next-intl";
import dynamic from "next/dynamic";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import SidebarLicenseButton from "./SidebarLicenseButton";
import { SidebarSupportButton } from "./SidebarSupportButton";

const ProductUpdates = dynamic(() => import("./ProductUpdates"), {
    ssr: false
});

const ShowTrialCard = dynamic(() => import("./ShowTrialCard"), {
    ssr: false
});

interface LayoutSidebarProps {
    orgId?: string;
    orgs?: ListUserOrgsResponse["orgs"];
    navItems: SidebarNavSection[];
    defaultSidebarCollapsed: boolean;
    hasCookiePreference: boolean;
}

export function LayoutSidebar({
    orgId,
    orgs = [],
    navItems,
    defaultSidebarCollapsed,
    hasCookiePreference
}: LayoutSidebarProps) {
    const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(
        defaultSidebarCollapsed
    );
    const [hasManualToggle, setHasManualToggle] = useState(hasCookiePreference);
    const pathname = usePathname();
    const isAdminPage = pathname?.startsWith("/admin");
    const { user } = useUserContext();
    const { isUnlocked, licenseStatus } = useLicenseStatusContext();
    const { env } = useEnvContext();
    const subscriptionContext = useSubscriptionStatusContext();
    const t = useTranslations();

    // Fetch pending approval count if we have an orgId and it's not an admin page
    const shouldFetchApprovalCount =
        Boolean(orgId) && !isAdminPage && build !== "oss";
    const approvalCountQuery = orgId
        ? approvalQueries.pendingCount(orgId)
        : {
              queryKey: ["APPROVALS", "", "COUNT", "pending"] as const,
              queryFn: async () => 0
          };
    const { data: pendingApprovalCount } = useQuery({
        ...approvalCountQuery,
        enabled: shouldFetchApprovalCount
    });

    // Map notification counts by navigation item title
    const notificationCounts: Record<string, number | undefined> = {};
    if (pendingApprovalCount !== undefined && pendingApprovalCount > 0) {
        notificationCounts["sidebarApprovals"] = pendingApprovalCount;
    }

    const setSidebarStateCookie = (collapsed: boolean) => {
        if (typeof window !== "undefined") {
            const isSecure = window.location.protocol === "https:";
            document.cookie = `pangolin-sidebar-state=${collapsed ? "collapsed" : "expanded"}; path=/; max-age=${60 * 60 * 24 * 30}; samesite=lax${isSecure ? "; secure" : ""}`;
        }
    };

    // Auto-collapse sidebar at 1650px or less, but only if no cookie preference exists
    useEffect(() => {
        if (hasManualToggle) {
            return; // Don't auto-collapse if user has manually toggled
        }

        const handleResize = () => {
            // print inner width
            if (typeof window !== "undefined") {
                const shouldCollapse = window.innerWidth <= 1650;
                setIsSidebarCollapsed(shouldCollapse);
            }
        };

        // Set initial state based on window width
        handleResize();

        window.addEventListener("resize", handleResize);
        return () => window.removeEventListener("resize", handleResize);
    }, [hasManualToggle]);

    function loadFooterLinks(): { text: string; href?: string }[] | undefined {
        if (!isUnlocked()) {
            return undefined;
        }
        if (env.branding.footer) {
            try {
                return JSON.parse(env.branding.footer);
            } catch (e) {
                console.error("Failed to parse BRANDING_FOOTER", e);
            }
        }
    }

    const currentOrg = orgs.find((org) => org.orgId === orgId);
    const canShowProductUpdates =
        user.serverAdmin || Boolean(currentOrg?.isOwner || currentOrg?.isAdmin);

    const showTrial =
        build === "saas" && Boolean(orgId) && subscriptionContext?.isTrial;

    const isSettingsPage = Boolean(
        orgId && pathname?.includes(`/${orgId}/settings`)
    );
    const canViewResourceLauncher = Boolean(
        currentOrg?.isAdmin || currentOrg?.isOwner
    );

    return (
        <div
            className={cn(
                "hidden md:flex border-r bg-sidebar flex-col h-full shrink-0 relative",
                isSidebarCollapsed ? "w-16" : "w-64"
            )}
        >
            <div className="shrink-0">
                <OrgSelector
                    orgId={orgId}
                    orgs={orgs}
                    isCollapsed={isSidebarCollapsed}
                />
            </div>
            <div
                className={cn(
                    "w-full border-b border-border",
                    isSidebarCollapsed && "mb-2"
                )}
            />
            <div className="flex-1 overflow-y-auto relative">
                <div className="px-2 pt-3">
                    {!isAdminPage &&
                        isSettingsPage &&
                        canViewResourceLauncher &&
                        orgId && (
                            <div
                                className={cn(
                                    "shrink-0",
                                    isSidebarCollapsed ? "mb-4" : "mb-1"
                                )}
                            >
                                <Link
                                    href={`/${orgId}`}
                                    className={cn(
                                        "flex items-center transition-colors text-muted-foreground hover:text-foreground text-sm w-full hover:bg-sidebar-accent dark:hover:bg-sidebar-accent/50 rounded-md",
                                        isSidebarCollapsed
                                            ? "px-2 py-2 justify-center"
                                            : "px-3 py-1.5"
                                    )}
                                    title={
                                        isSidebarCollapsed
                                            ? t("resourceLauncherTitle")
                                            : undefined
                                    }
                                >
                                    <span
                                        className={cn(
                                            "flex-shrink-0 w-5 h-5 flex items-center justify-center text-muted-foreground",
                                            !isSidebarCollapsed && "mr-3"
                                        )}
                                    >
                                        <SquareMousePointer className="h-4 w-4" />
                                    </span>
                                    {!isSidebarCollapsed && (
                                        <span className="flex-1">
                                            {t("resourceLauncherTitle")}
                                        </span>
                                    )}
                                </Link>
                            </div>
                        )}
                    {!isAdminPage && user.serverAdmin && (
                        <div
                            className={cn(
                                "shrink-0",
                                isSidebarCollapsed ? "mb-4" : "mb-1"
                            )}
                        >
                            <Link
                                href="/admin"
                                className={cn(
                                    "flex items-center transition-colors text-muted-foreground hover:text-foreground text-sm w-full hover:bg-sidebar-accent dark:hover:bg-sidebar-accent/50 rounded-md",
                                    isSidebarCollapsed
                                        ? "px-2 py-2 justify-center"
                                        : "px-3 py-1.5"
                                )}
                                title={
                                    isSidebarCollapsed
                                        ? t("serverAdmin")
                                        : undefined
                                }
                            >
                                <span
                                    className={cn(
                                        "flex-shrink-0 w-5 h-5 flex items-center justify-center text-muted-foreground",
                                        !isSidebarCollapsed && "mr-3"
                                    )}
                                >
                                    <Server className="h-4 w-4" />
                                </span>
                                {!isSidebarCollapsed && (
                                    <>
                                        <span className="flex-1">
                                            {t("serverAdmin")}
                                        </span>
                                    </>
                                )}
                            </Link>
                        </div>
                    )}
                    <SidebarNav
                        sections={navItems}
                        isCollapsed={isSidebarCollapsed}
                        notificationCounts={notificationCounts}
                    />
                </div>
                {/* Fade gradient at bottom to indicate scrollable content */}
                <div className="sticky bottom-0 left-0 right-0 h-8 pointer-events-none bg-gradient-to-t from-sidebar to-transparent" />
            </div>

            {isSidebarCollapsed && (
                <div className="shrink-0 flex justify-center py-2">
                    <TooltipProvider>
                        <Tooltip>
                            <TooltipTrigger asChild>
                                <button
                                    type="button"
                                    onClick={() => {
                                        setIsSidebarCollapsed(false);
                                        setHasManualToggle(true);
                                        setSidebarStateCookie(false);
                                    }}
                                    className="rounded-md p-2 text-muted-foreground hover:text-foreground hover:bg-sidebar-accent dark:hover:bg-sidebar-accent/50 transition-colors"
                                    aria-label={t("sidebarExpand")}
                                >
                                    <PanelRightOpen className="h-4 w-4" />
                                </button>
                            </TooltipTrigger>
                            <TooltipContent side="right" sideOffset={8}>
                                <p>{t("sidebarExpand")}</p>
                            </TooltipContent>
                        </Tooltip>
                    </TooltipProvider>
                </div>
            )}

            <div
                className={cn(
                    "pt-1 flex flex-col shrink-0 gap-2 w-full border-t border-border",
                    isSidebarCollapsed && "pb-2"
                )}
            >
                {canShowProductUpdates ? (
                    <div className="px-4">
                        <ProductUpdates isCollapsed={isSidebarCollapsed} />
                    </div>
                ) : (
                    <div className="mt-0.2"></div>
                )}

                {showTrial && (
                    <div className="px-4">
                        <ShowTrialCard
                            isCollapsed={isSidebarCollapsed}
                            isOwner={Boolean(currentOrg?.isOwner)}
                        />
                    </div>
                )}

                {build === "enterprise" && (
                    <div className="px-4">
                        <SidebarLicenseButton
                            isCollapsed={isSidebarCollapsed}
                        />
                    </div>
                )}
                {build === "saas" && (
                    <div className="px-4">
                        <SidebarSupportButton
                            isCollapsed={isSidebarCollapsed}
                        />
                    </div>
                )}

                {!isSidebarCollapsed && (
                    <div className="px-4 space-y-2 pb-4">
                        {loadFooterLinks() ? (
                            <>
                                {loadFooterLinks()!.map((link, index) => (
                                    <div
                                        key={index}
                                        className="whitespace-nowrap"
                                    >
                                        {link.href ? (
                                            <div className="text-xs text-muted-foreground text-left">
                                                <Link
                                                    href={link.href}
                                                    target="_blank"
                                                    rel="noopener noreferrer"
                                                    className="flex items-center justify-start gap-1"
                                                >
                                                    {link.text}
                                                    <ExternalLink size={12} />
                                                </Link>
                                            </div>
                                        ) : (
                                            <div className="text-xs text-muted-foreground text-left">
                                                {link.text}
                                            </div>
                                        )}
                                    </div>
                                ))}
                            </>
                        ) : (
                            <>
                                <div className="text-xs text-muted-foreground text-left">
                                    <Link
                                        href="https://github.com/fosrl/pangolin"
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="flex items-center justify-start gap-1"
                                    >
                                        {build === "oss"
                                            ? t("communityEdition")
                                            : build === "enterprise"
                                              ? t("enterpriseEdition")
                                              : "Pangolin Cloud"}
                                    </Link>
                                </div>
                                {build === "enterprise" &&
                                isUnlocked() &&
                                licenseStatus?.tier === "personal" ? (
                                    <div className="text-xs text-muted-foreground text-left">
                                        {t("personalUseOnly")}
                                    </div>
                                ) : null}
                                {build === "enterprise" && !isUnlocked() ? (
                                    <div className="text-xs text-muted-foreground text-left">
                                        {t("unlicensed")}
                                    </div>
                                ) : null}
                                {env?.app?.version && (
                                    <div className="text-xs text-muted-foreground text-left">
                                        <Link
                                            href={`https://github.com/fosrl/pangolin/releases/tag/${env.app.version}`}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="flex items-center justify-start gap-1"
                                        >
                                            v{env.app.version}
                                            <ExternalLink size={12} />
                                        </Link>
                                    </div>
                                )}
                            </>
                        )}
                    </div>
                )}
            </div>

            {/* Collapse button */}
            <TooltipProvider>
                <Tooltip>
                    <TooltipTrigger asChild>
                        <button
                            onClick={() => {
                                const newCollapsedState = !isSidebarCollapsed;
                                setIsSidebarCollapsed(newCollapsedState);
                                setHasManualToggle(true);
                                setSidebarStateCookie(newCollapsedState);
                            }}
                            className="cursor-pointer absolute -right-2.5 top-1/2 transform -translate-y-1/2 w-2 h-8 rounded-full flex items-center justify-center transition-all duration-200 ease-in-out hover:scale-110 group z-1"
                            aria-label={
                                isSidebarCollapsed
                                    ? "Expand sidebar"
                                    : "Collapse sidebar"
                            }
                        >
                            <div className="w-0.5 h-4 bg-current opacity-30 group-hover:opacity-100 transition-opacity duration-200" />
                        </button>
                    </TooltipTrigger>
                    <TooltipContent side="right" sideOffset={8}>
                        <p>
                            {isSidebarCollapsed
                                ? t("sidebarExpand")
                                : t("sidebarCollapse")}
                        </p>
                    </TooltipContent>
                </Tooltip>
            </TooltipProvider>
        </div>
    );
}

export default LayoutSidebar;
