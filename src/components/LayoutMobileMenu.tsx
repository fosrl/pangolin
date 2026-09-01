"use client";

import type { SidebarNavSection } from "@app/app/navigation";
import { CommandPaletteTrigger } from "@app/components/command-palette/CommandPaletteTrigger";
import { OrgSelector } from "@app/components/OrgSelector";
import ProfileIcon from "@app/components/ProfileIcon";
import { SidebarNav, type SidebarNavItem } from "@app/components/SidebarNav";
import ThemeSwitcher from "@app/components/ThemeSwitcher";
import { Button } from "@app/components/ui/button";
import {
    Sheet,
    SheetContent,
    SheetDescription,
    SheetTitle,
    SheetTrigger
} from "@app/components/ui/sheet";
import { cn } from "@app/lib/cn";
import { ListUserOrgsResponse } from "@server/routers/org";
import { Menu, Settings } from "lucide-react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { useState } from "react";

interface LayoutMobileMenuProps {
    orgId?: string;
    orgs?: ListUserOrgsResponse["orgs"];
    navItems: SidebarNavSection[];
    launcherNavItems?: SidebarNavItem[];
    showSidebar: boolean;
    showTopBar: boolean;
    launcherMode?: boolean;
    showViewAsAdmin?: boolean;
}

export function LayoutMobileMenu({
    orgId,
    orgs,
    navItems,
    launcherNavItems = [],
    showSidebar,
    showTopBar,
    launcherMode = false,
    showViewAsAdmin = false
}: LayoutMobileMenuProps) {
    const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
    const t = useTranslations();
    const showMobileNav = showSidebar || launcherMode;

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
                                            <div className="px-3">
                                                {orgId
                                                    ? launcherNavItems
                                                          .filter(
                                                              (item) =>
                                                                  item.href
                                                          )
                                                          .map((item) => {
                                                              const href =
                                                                  item.href!.replace(
                                                                      "{orgId}",
                                                                      orgId
                                                                  );
                                                              return (
                                                                  <div
                                                                      key={href}
                                                                      className="mb-1"
                                                                  >
                                                                      <Link
                                                                          href={
                                                                              href
                                                                          }
                                                                          className={
                                                                              mobileNavLinkClassName
                                                                          }
                                                                          onClick={() =>
                                                                              setIsMobileMenuOpen(
                                                                                  false
                                                                              )
                                                                          }
                                                                      >
                                                                          {item.icon ? (
                                                                              <span className="flex-shrink-0 w-5 h-5 flex items-center justify-center text-muted-foreground mr-3">
                                                                                  {
                                                                                      item.icon
                                                                                  }
                                                                              </span>
                                                                          ) : null}
                                                                          <span className="flex-1">
                                                                              {t(
                                                                                  item.title
                                                                              )}
                                                                          </span>
                                                                      </Link>
                                                                  </div>
                                                              );
                                                          })
                                                    : null}
                                                {showViewAsAdmin && orgId ? (
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
                                                ) : null}
                                            </div>
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
                            <CommandPaletteTrigger
                                variant="mobile"
                                orgId={orgId}
                                orgs={orgs}
                            />
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
