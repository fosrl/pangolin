"use client";

import React, { useState } from "react";
import { SidebarNav } from "@app/components/SidebarNav";
import { OrgSelector } from "@app/components/OrgSelector";
import { cn } from "@app/lib/cn";
import { ListUserOrgsResponse } from "@server/routers/org";
import SupporterStatus from "@app/components/SupporterStatus";
import { Button } from "@app/components/ui/button";
import { ExternalLink, Menu, Server } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useUserContext } from "@app/hooks/useUserContext";
import { useEnvContext } from "@app/hooks/useEnvContext";
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
}

export function LayoutMobileMenu({
    orgId,
    orgs,
    navItems,
    showSidebar,
    showTopBar
}: LayoutMobileMenuProps) {
    const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
    const pathname = usePathname();
    const isAdminPage = pathname?.startsWith("/admin");
    const { user } = useUserContext();
    const { env } = useEnvContext();
    const t = useTranslations();

    return (
        <div className="shrink-0 md:hidden">
            <div className="h-16 flex items-center px-2">
                <div className="flex items-center gap-4">
                    {showSidebar && (
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
                                    <div className="flex-1 overflow-y-auto">
                                        <div className="p-4">
                                            <OrgSelector
                                                orgId={orgId}
                                                orgs={orgs}
                                            />
                                        </div>
                                        <div className="px-4">
                                            {!isAdminPage &&
                                                user.serverAdmin && (
                                                    <div className="pb-3">
                                                        <Link
                                                            href="/admin"
                                                            className={cn(
                                                                "flex items-center rounded transition-colors text-muted-foreground hover:text-foreground text-sm w-full hover:bg-secondary/50 dark:hover:bg-secondary/20 rounded-md px-3 py-1.5"
                                                            )}
                                                            onClick={() =>
                                                                setIsMobileMenuOpen(
                                                                    false
                                                                )
                                                            }
                                                        >
                                                            <span className="flex-shrink-0 mr-2">
                                                                <Server className="h-4 w-4" />
                                                            </span>
                                                            <span>
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
                                                    setIsMobileMenuOpen(false)
                                                }
                                            />
                                        </div>
                                    </div>
                                    <div className="p-4 space-y-4 border-t shrink-0">
                                        <SupporterStatus />
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
                                    </div>
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
