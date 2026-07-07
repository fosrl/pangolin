"use client";

import React, { useState } from "react";
import { SidebarNav } from "@app/components/SidebarNav";
import { OrgSelector } from "@app/components/OrgSelector";
import { cn } from "@app/lib/cn";
import { ListUserOrgsResponse } from "@server/routers/org";
import { Button } from "@app/components/ui/button";
import { Menu, Server, Settings, SquareMousePointer } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useUserContext } from "@app/hooks/useUserContext";
import { useTranslations } from "next-intl";
import ProfileIcon from "@app/components/ProfileIcon";
import ThemeSwitcher from "@app/components/ThemeSwitcher";
import type { SidebarNavSection } from "@app/app/navigation";
import {
    Sheet,
    SheetContent,
    SheetTrigger,
    SheetTitle,
    SheetDescription
} from "@app/components/ui/sheet";
import { Abel } from "next/font/google";

interface LayoutMobileMenuProps {
    orgId?: string;
    orgs?: ListUserOrgsResponse["orgs"];
    navItems: SidebarNavSection[];
    showSidebar: boolean;
    showTopBar: boolean;
    launcherMode?: boolean;
    showViewAsAdmin?: boolean;
}

export function LayoutMobileMenu({
    orgId,
    orgs,
    navItems,
    showSidebar,
    showTopBar,
    launcherMode = false,
    showViewAsAdmin = false
}: LayoutMobileMenuProps) {
    const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
    const pathname = usePathname();
    const isAdminPage = pathname?.startsWith("/admin");
    const { user } = useUserContext();
    const t = useTranslations();
    const showMobileNav = showSidebar || launcherMode;
    const currentOrg = orgs?.find((org) => org.orgId === orgId);
    const isSettingsPage = Boolean(
        orgId && pathname?.includes(`/${orgId}/settings`)
    );
    const canViewResourceLauncher = Boolean(
        currentOrg?.isAdmin || currentOrg?.isOwner
    );

    const mobileNavLinkClassName = cn(
        "flex items-center rounded transition-colors text-muted-foreground hover:text-foreground text-sm w-full hover:bg-secondary/50 dark:hover:bg-secondary/20 rounded-md px-3 py-1.5"
    );

    return (
        <div className="shrink-0 md:hidden sticky top-0 z-50">
            <div className="h-16 flex items-center px-2">
                <div className="flex items-center gap-4">
                    {showMobileNav && (
                        <div>
                            <Sheet
                                open={isMobileMenuOpen}
                                onOpenChange={setIsMobileMenuOpen}
                            >
                                <SheetTrigger asChild>
                                    <Button variant="ghost" size="icon">
                                        <Menu className="h-6 w-6" />
                                    </Button>
                                </SheetTrigger>
                                <SheetContent
                                    side="left"
                                    className="w-64 p-0 flex flex-col h-full"
                                >
                                    <SheetTitle className="sr-only">
                                        {t("navbar")}
                                    </SheetTitle>
                                    <SheetDescription className="sr-only">
                                        {t("navbarDescription")}
                                    </SheetDescription>
                                    {launcherMode ? (
                                        <>
                                            <div className="w-full border-b border-border">
                                                <div className="px-1 shrink-0">
                                                    <OrgSelector
                                                        orgId={orgId}
                                                        orgs={orgs}
                                                    />
                                                </div>
                                            </div>
                                            {showViewAsAdmin && orgId ? (
                                                <div className="px-3">
                                                    <div className="mb-1">
                                                        <Link
                                                            href={`/${orgId}/settings`}
                                                            className={
                                                                mobileNavLinkClassName
                                                            }
                                                            onClick={() =>
                                                                setIsMobileMenuOpen(
                                                                    false
                                                                )
                                                            }
                                                        >
                                                            <span className="flex-shrink-0 w-5 h-5 flex items-center justify-center text-muted-foreground mr-3">
                                                                <Settings className="h-4 w-4" />
                                                            </span>
                                                            <span className="flex-1">
                                                                {t(
                                                                    "resourceLauncherViewAsAdmin"
                                                                )}
                                                            </span>
                                                        </Link>
                                                    </div>
                                                </div>
                                            ) : null}
                                        </>
                                    ) : (
                                        <>
                                            <div className="w-full border-b border-border">
                                                <div className="px-1 shrink-0">
                                                    <OrgSelector
                                                        orgId={orgId}
                                                        orgs={orgs}
                                                    />
                                                </div>
                                            </div>
                                            <div className="flex-1 overflow-y-auto relative">
                                                <div className="px-3">
                                                    {!isAdminPage &&
                                                        isSettingsPage &&
                                                        canViewResourceLauncher &&
                                                        orgId && (
                                                            <div className="mb-1">
                                                                <Link
                                                                    href={`/${orgId}`}
                                                                    className={
                                                                        mobileNavLinkClassName
                                                                    }
                                                                    onClick={() =>
                                                                        setIsMobileMenuOpen(
                                                                            false
                                                                        )
                                                                    }
                                                                >
                                                                    <span className="flex-shrink-0 w-5 h-5 flex items-center justify-center text-muted-foreground mr-3">
                                                                        <SquareMousePointer className="h-4 w-4" />
                                                                    </span>
                                                                    <span className="flex-1">
                                                                        {t(
                                                                            "resourceLauncherTitle"
                                                                        )}
                                                                    </span>
                                                                </Link>
                                                            </div>
                                                        )}
                                                    {!isAdminPage &&
                                                        user.serverAdmin && (
                                                            <div className="mb-1">
                                                                <Link
                                                                    href="/admin"
                                                                    className={
                                                                        mobileNavLinkClassName
                                                                    }
                                                                    onClick={() =>
                                                                        setIsMobileMenuOpen(
                                                                            false
                                                                        )
                                                                    }
                                                                >
                                                                    <span className="flex-shrink-0 w-5 h-5 flex items-center justify-center text-muted-foreground mr-3">
                                                                        <Server className="h-4 w-4" />
                                                                    </span>
                                                                    <span className="flex-1">
                                                                        {t(
                                                                            "serverAdmin"
                                                                        )}
                                                                    </span>
                                                                </Link>
                                                            </div>
                                                        )}
                                                    <SidebarNav
                                                        sections={navItems}
                                                        onItemClick={() =>
                                                            setIsMobileMenuOpen(
                                                                false
                                                            )
                                                        }
                                                    />
                                                </div>
                                                <div className="sticky bottom-0 left-0 right-0 h-8 pointer-events-none bg-gradient-to-t from-card to-transparent" />
                                            </div>
                                        </>
                                    )}
                                </SheetContent>
                            </Sheet>
                        </div>
                    )}
                </div>
                {showTopBar && (
                    <div className="ml-auto flex items-center justify-end">
                        <div className="flex items-center space-x-2">
                            <ThemeSwitcher />
                            <ProfileIcon />
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}

export default LayoutMobileMenu;
