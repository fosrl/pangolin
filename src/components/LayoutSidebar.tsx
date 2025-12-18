"use client";

import type { SidebarNavSection } from "@app/app/navigation";
import { OrgSelector } from "@app/components/OrgSelector";
import { SidebarNav } from "@app/components/SidebarNav";
import SupporterStatus from "@app/components/SupporterStatus";
import {
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger
} from "@app/components/ui/tooltip";
import { useEnvContext } from "@app/hooks/useEnvContext";
import { useLicenseStatusContext } from "@app/hooks/useLicenseStatusContext";
import { useUserContext } from "@app/hooks/useUserContext";
import { cn } from "@app/lib/cn";
import { build } from "@server/build";
import { ListUserOrgsResponse } from "@server/routers/org";
import { ExternalLink, Server } from "lucide-react";
import { useTranslations } from "next-intl";
import dynamic from "next/dynamic";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { FaGithub } from "react-icons/fa";
import SidebarLicenseButton from "./SidebarLicenseButton";
import { SidebarSupportButton } from "./SidebarSupportButton";
import { is } from "drizzle-orm";

const ProductUpdates = dynamic(() => import("./ProductUpdates"), {
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
    const t = useTranslations();

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

    return (
        <div
            className={cn(
                "hidden md:flex border-r bg-card flex-col h-full shrink-0 relative",
                isSidebarCollapsed ? "w-16" : "w-64"
            )}
        >
            <div className="p-4 shrink-0">
                <OrgSelector
                    orgId={orgId}
                    orgs={orgs}
                    isCollapsed={isSidebarCollapsed}
                />
            </div>
            <div className="flex-1 overflow-y-auto">
                <div className="px-2 pt-1">
                    {!isAdminPage && user.serverAdmin && (
                        <div className="pb-4">
                            <Link
                                href="/admin"
                                className={cn(
                                    "flex items-center transition-colors text-muted-foreground hover:text-foreground text-sm w-full hover:bg-secondary/80 dark:hover:bg-secondary/50 rounded-md",
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
                                        "shrink-0",
                                        !isSidebarCollapsed && "mr-2"
                                    )}
                                >
                                    <Server className="h-4 w-4" />
                                </span>
                                {!isSidebarCollapsed && (
                                    <span>{t("serverAdmin")}</span>
                                )}
                            </Link>
                        </div>
                    )}
                    <SidebarNav
                        sections={navItems}
                        isCollapsed={isSidebarCollapsed}
                    />
                </div>
            </div>

            <div className="p-4 pt-1 flex flex-col shrink-0">
                {canShowProductUpdates && (
                    <div className="mb-3">
                        <ProductUpdates isCollapsed={isSidebarCollapsed} />
                    </div>
                )}

                {build === "enterprise" && (
                    <div className="mb-3">
                        <SidebarLicenseButton
                            isCollapsed={isSidebarCollapsed}
                        />
                    </div>
                )}
                {build === "oss" && (
                    <div className="mb-3">
                        <SupporterStatus isCollapsed={isSidebarCollapsed} />
                    </div>
                )}
                {build === "saas" && (
                    <div className="mb-3">
                        <SidebarSupportButton
                            isCollapsed={isSidebarCollapsed}
                        />
                    </div>
                )}
                {!isSidebarCollapsed && (
                    <div className="space-y-2">
                        {loadFooterLinks() ? (
                            <>
                                {loadFooterLinks()!.map((link, index) => (
                                    <div
                                        key={index}
                                        className="whitespace-nowrap"
                                    >
                                        {link.href ? (
                                            <div className="text-xs text-muted-foreground text-center">
                                                <Link
                                                    href={link.href}
                                                    target="_blank"
                                                    rel="noopener noreferrer"
                                                    className="flex items-center justify-center gap-1"
                                                >
                                                    {link.text}
                                                    <ExternalLink size={12} />
                                                </Link>
                                            </div>
                                        ) : (
                                            <div className="text-xs text-muted-foreground text-center">
                                                {link.text}
                                            </div>
                                        )}
                                    </div>
                                ))}
                            </>
                        ) : (
                            <>
                                <div className="text-xs text-muted-foreground text-center">
                                    <Link
                                        href="https://github.com/fosrl/pangolin"
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="flex items-center justify-center gap-1"
                                    >
                                        {build === "oss"
                                            ? t("communityEdition")
                                            : build === "enterprise"
                                              ? t("enterpriseEdition")
                                              : "Pangolin Cloud"}
                                        <FaGithub size={12} />
                                    </Link>
                                </div>
                                {build === "enterprise" &&
                                isUnlocked() &&
                                licenseStatus?.tier === "personal" ? (
                                    <div className="text-xs text-muted-foreground text-center">
                                        {t("personalUseOnly")}
                                    </div>
                                ) : null}
                                {build === "enterprise" && !isUnlocked() ? (
                                    <div className="text-xs text-muted-foreground text-center">
                                        {t("unlicensed")}
                                    </div>
                                ) : null}
                                {env?.app?.version && (
                                    <div className="text-xs text-muted-foreground text-center">
                                        <Link
                                            href={`https://github.com/fosrl/pangolin/releases/tag/${env.app.version}`}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="flex items-center justify-center gap-1"
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
