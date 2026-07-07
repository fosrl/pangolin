import React from "react";
import { cn } from "@app/lib/cn";
import { ListUserOrgsResponse } from "@server/routers/org";
import type { SidebarNavSection } from "@app/app/navigation";
import { LayoutSidebar } from "@app/components/LayoutSidebar";
import { LayoutHeader } from "@app/components/LayoutHeader";
import { LayoutMobileMenu } from "@app/components/LayoutMobileMenu";
import { cookies } from "next/headers";

interface LayoutProps {
    children: React.ReactNode;
    orgId?: string;
    orgs?: ListUserOrgsResponse["orgs"];
    navItems?: SidebarNavSection[];
    showSidebar?: boolean;
    showHeader?: boolean;
    showTopBar?: boolean;
    defaultSidebarCollapsed?: boolean;
    launcherMode?: boolean;
    showViewAsAdmin?: boolean;
}

export async function Layout({
    children,
    orgId,
    orgs,
    navItems = [],
    showSidebar = true,
    showHeader = true,
    showTopBar = true,
    defaultSidebarCollapsed = false,
    launcherMode = false,
    showViewAsAdmin = false
}: LayoutProps) {
    const allCookies = await cookies();
    const sidebarStateCookie = allCookies.get("pangolin-sidebar-state")?.value;
    const hasCookiePreference = sidebarStateCookie !== undefined;

    const initialSidebarCollapsed =
        sidebarStateCookie === "collapsed" ||
        (sidebarStateCookie !== "expanded" && defaultSidebarCollapsed);

    return (
        <div className="flex h-screen-safe overflow-hidden">
            {/* Desktop Sidebar */}
            {showSidebar && (
                <LayoutSidebar
                    orgId={orgId}
                    orgs={orgs}
                    navItems={navItems}
                    defaultSidebarCollapsed={initialSidebarCollapsed}
                    hasCookiePreference={hasCookiePreference}
                />
            )}

            {/* Main content area */}
            <div
                className={cn(
                    "flex-1 flex flex-col h-full min-w-0 relative",
                    !showSidebar && "w-full"
                )}
            >
                {/* Mobile header */}
                {showHeader && (
                    <LayoutMobileMenu
                        orgId={orgId}
                        orgs={orgs}
                        navItems={navItems}
                        showSidebar={showSidebar}
                        showTopBar={showTopBar}
                        launcherMode={launcherMode}
                        showViewAsAdmin={showViewAsAdmin}
                    />
                )}

                {/* Desktop header */}
                {showHeader && (
                    <LayoutHeader
                        showTopBar={showTopBar}
                        launcherMode={launcherMode}
                        orgId={orgId}
                        orgs={orgs}
                        showViewAsAdmin={showViewAsAdmin}
                    />
                )}

                {/* Main content */}
                <main className="flex-1 overflow-y-auto p-3 md:p-6 w-full">
                    <div
                        className={cn(
                            "container mx-auto max-w-12xl mb-12",
                            showHeader && "md:pt-14" // Add top padding only on desktop to account for fixed header
                        )}
                    >
                        {children}
                    </div>
                </main>
            </div>
        </div>
    );
}
