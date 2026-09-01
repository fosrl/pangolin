"use client";

import type {
    CommandBarNavSection,
    SidebarNavSection
} from "@app/app/navigation";
import {
    CommandDialog,
    CommandEmpty,
    CommandGroup,
    CommandInput,
    CommandItem,
    CommandList,
    CommandSeparator
} from "@app/components/ui/command";
import { Button } from "@app/components/ui/button";
import { cn } from "@app/lib/cn";
import { useMediaQuery } from "@app/hooks/useMediaQuery";
import { ListUserOrgsResponse } from "@server/routers/org";
import {
    ChevronRightIcon,
    GlobeIcon,
    GlobeLockIcon,
    LaptopIcon,
    PlugIcon,
    ServerIcon,
    UserIcon,
    X
} from "lucide-react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import React, {
    createContext,
    useCallback,
    useContext,
    useEffect,
    useMemo,
    useState
} from "react";
import { useCanUseCommandPalette } from "./useCanUseCommandPalette";
import { useCommandPaletteActions } from "./useCommandPaletteActions";
import { useCommandPaletteNavigation } from "./useCommandPaletteNavigation";
import { useCommandPaletteSearch } from "./useCommandPaletteSearch";
import { resources } from "@server/db";

type CommandPaletteProps = {
    orgId?: string;
    orgs?: ListUserOrgsResponse["orgs"];
    navItems: CommandBarNavSection[];
};

/**
 * Plan for command bar:
 * - the nav items should be custom items instead of all of the ones in the sidebar
 * - actions should be triggered by using `>` (like in Github)
 *   -> if search starts with `>`, the filter should exclude that char in the filter string
 */

export function CommandPalette({ orgId, orgs, navItems }: CommandPaletteProps) {
    const t = useTranslations();
    const router = useRouter();
    const { open, setOpen } = useCommandPalette();
    const [search, setSearch] = useState("");
    const isDesktop = useMediaQuery("(min-width: 768px)");

    const isActionMode = search.startsWith(">");

    const navigationGroups = useCommandPaletteNavigation(navItems);
    // const organizations = useCommandPaletteOrganizations(orgs);
    const actions = useCommandPaletteActions(orgId, orgs);
    const {
        shouldSearch,
        sites,
        publicResources,
        privateResources,
        users,
        machineClients,
        userDevices,
        isLoading,
        hasResults: hasEntityResults
    } = useCommandPaletteSearch({
        orgId,
        query: search,
        enabled: !isActionMode && open
    });

    const handleOpenChange = useCallback(
        (nextOpen: boolean) => {
            setOpen(nextOpen);
            if (!nextOpen) {
                setSearch("");
            }
        },
        [setOpen]
    );

    const runCommand = useCallback(
        (command: () => void) => {
            setOpen(false);
            setSearch("");
            command();
        },
        [setOpen]
    );

    return (
        <CommandDialog
            open={open}
            onOpenChange={handleOpenChange}
            title={t("commandPaletteTitle")}
            description={t("commandPaletteDescription")}
            className="max-w-2xl **:data-[slot=command-input-wrapper]:h-15"
            commandProps={{
                loop: true,
                filter(value, query) {
                    let search = query;
                    if (query.startsWith(">")) {
                        search = query.substring(1);

                        console.log({
                            search,
                            value
                        });
                    }

                    if (
                        value
                            .toLowerCase()
                            .includes(search.trim().toLowerCase())
                    ) {
                        return 1;
                    }
                    return 0;
                }
            }}
        >
            <CommandInput
                placeholder={t("commandPaletteSearchPlaceholder")}
                value={search}
                onValueChange={setSearch}
                isLoading={!isActionMode && shouldSearch && isLoading}
                trailing={
                    !isDesktop ? (
                        <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="size-8 shrink-0"
                            aria-label={t("close")}
                            onClick={() => handleOpenChange(false)}
                        >
                            <X className="size-4" />
                        </Button>
                    ) : undefined
                }
            />
            <CommandList className="max-h-118 min-h-0  h-(--cmdk-list-height) scroll-pb-4 scroll-pt-2 transition-[height] duration-250 ease-in-out">
                <CommandEmpty>{t("commandPaletteNoResults")}</CommandEmpty>

                <CommandGroup
                    heading={t("commandActionModeInfo")}
                    className="[&_[cmdk-group-heading]]:text-sm"
                />

                {!isActionMode &&
                    navigationGroups.map((group, groupIndex) => (
                        <React.Fragment key={group.heading}>
                            {groupIndex > 0 && <CommandSeparator />}
                            <CommandGroup
                                heading={group.heading}
                                className={cn(
                                    "[&_[cmdk-group-heading]]:py-2 [&_[cmdk-group-heading]]:text-sm pb-2.5",
                                    groupIndex > 0 &&
                                        "[&_[cmdk-group-heading]]:pt-3"
                                )}
                            >
                                {group.items.map((item) => (
                                    <CommandItem
                                        key={item.id}
                                        value={`${item.title} ${group.heading}`}
                                        onSelect={() =>
                                            runCommand(() =>
                                                router.push(item.href)
                                            )
                                        }
                                        className="h-9"
                                    >
                                        {item.icon}
                                        <span>{item.title}</span>
                                    </CommandItem>
                                ))}
                            </CommandGroup>
                        </React.Fragment>
                    ))}

                {/* {organizations.length > 1 && (
                    <>
                        <CommandSeparator />
                        <CommandGroup
                            heading={t("commandPaletteOrganizations")}
                        >
                            {organizations.map((org) => (
                                <CommandItem
                                    key={org.id}
                                    value={`${org.name} ${org.orgId}`}
                                    onSelect={() =>
                                        runCommand(() => router.push(org.href))
                                    }
                                >
                                    <span className="truncate">{org.name}</span>
                                    <span className="text-xs text-muted-foreground font-mono truncate">
                                        {org.orgId}
                                    </span>
                                    {org.isPrimaryOrg && (
                                        <Badge
                                            variant="outline"
                                            className="ml-auto shrink-0 text-[10px] px-1.5 py-0"
                                        >
                                            {t("primary")}
                                        </Badge>
                                    )}
                                </CommandItem>
                            ))}
                        </CommandGroup>
                    </>
                )} */}

                {!isActionMode && shouldSearch && orgId && hasEntityResults && (
                    <CommandGroup
                        heading={t("commandSearchResults")}
                        className={cn(
                            "[&_[cmdk-group-heading]]:py-2 [&_[cmdk-group-heading]]:text-sm pb-2.5"
                        )}
                    >
                        {sites.map((site) => (
                            <CommandItem
                                key={site.id}
                                value={`${site.name} site`}
                                onSelect={() =>
                                    runCommand(() => router.push(site.href))
                                }
                                className="h-9"
                            >
                                <div className="inline-flex items-center gap-1">
                                    <PlugIcon className="size-4 flex-none" />
                                    <span className="text-muted-foreground">
                                        {t("commandSites")}
                                    </span>
                                    <ChevronRightIcon className="size-3.5! flex-none relative p-0! top-px" />
                                    <span className="truncate">
                                        {site.name}
                                    </span>
                                </div>
                            </CommandItem>
                        ))}
                        {publicResources.map((resource) => (
                            <CommandItem
                                key={resource.id}
                                value={`${resource.name} public resource`}
                                onSelect={() =>
                                    runCommand(() => router.push(resource.href))
                                }
                                className="h-9"
                            >
                                <div className="inline-flex items-center gap-1">
                                    <GlobeIcon className="size-4 flex-none" />
                                    <span className="text-muted-foreground">
                                        {t("commandProxyResources")}
                                    </span>
                                    <ChevronRightIcon className="size-3.5! flex-none relative p-0! top-px" />
                                    <span className="truncate">
                                        {resource.name}
                                    </span>
                                </div>
                            </CommandItem>
                        ))}
                        {privateResources.map((resource) => (
                            <CommandItem
                                key={resource.id}
                                value={`${resource.name} private resource`}
                                onSelect={() =>
                                    runCommand(() => router.push(resource.href))
                                }
                                className="h-9"
                            >
                                <div className="inline-flex items-center gap-1">
                                    <GlobeLockIcon className="size-4 flex-none" />
                                    <span className="text-muted-foreground">
                                        {t("commandClientResources")}
                                    </span>
                                    <ChevronRightIcon className="size-3.5! flex-none relative p-0! top-px" />
                                    <span className="truncate">
                                        {resource.name}
                                    </span>
                                </div>
                            </CommandItem>
                        ))}
                        {users.map((user) => (
                            <CommandItem
                                key={user.id}
                                value={`${user.name} ${user.email}`}
                                onSelect={() =>
                                    runCommand(() => router.push(user.href))
                                }
                                className="h-9"
                            >
                                <div className="inline-flex items-center gap-1">
                                    <UserIcon className="size-4 flex-none" />
                                    <span className="text-muted-foreground">
                                        {t("commandUsers")}
                                    </span>
                                    <ChevronRightIcon className="size-3.5! flex-none relative p-0! top-px" />
                                    <div className="inline-flex min-w-0 items-center gap-1">
                                        <span className="truncate">
                                            {user.name}
                                        </span>
                                        <span className="text-muted-foreground">
                                            &middot;
                                        </span>
                                        <span className="truncate text-xs text-muted-foreground">
                                            {user.email}
                                        </span>
                                    </div>
                                </div>
                            </CommandItem>
                        ))}
                        {machineClients.map((client) => (
                            <CommandItem
                                key={client.id}
                                value={`${client.name} client`}
                                onSelect={() =>
                                    runCommand(() => router.push(client.href))
                                }
                                className="h-9"
                            >
                                <div className="inline-flex items-center gap-1">
                                    <ServerIcon className="size-4 flex-none" />
                                    <span className="text-muted-foreground">
                                        {t("commandMachineClients")}
                                    </span>
                                    <ChevronRightIcon className="size-3.5! flex-none relative p-0! top-px" />
                                    <span className="truncate">
                                        {client.name}
                                    </span>
                                </div>
                            </CommandItem>
                        ))}
                        {userDevices.map((device) => (
                            <CommandItem
                                key={device.id}
                                value={`${device.name} user device`}
                                onSelect={() =>
                                    runCommand(() => router.push(device.href))
                                }
                                className="h-9"
                            >
                                <div className="inline-flex items-center gap-1">
                                    <LaptopIcon className="size-4 flex-none" />
                                    <span className="text-muted-foreground">
                                        {t("commandUserDevices")}
                                    </span>
                                    <ChevronRightIcon className="size-3.5! flex-none relative p-0! top-px" />
                                    <span className="truncate">
                                        {device.name}
                                    </span>
                                </div>
                            </CommandItem>
                        ))}
                    </CommandGroup>
                )}

                {isActionMode && actions.length > 0 && (
                    <>
                        <CommandGroup
                            heading={t("commandPaletteActions")}
                            className={cn(
                                "[&_[cmdk-group-heading]]:py-2 [&_[cmdk-group-heading]]:text-sm pb-2.5"
                            )}
                        >
                            {actions.map((action) => (
                                <CommandItem
                                    key={action.id}
                                    value={action.label}
                                    onSelect={() =>
                                        runCommand(() => {
                                            if (action.onSelect) {
                                                action.onSelect();
                                            } else if (action.href) {
                                                router.push(action.href);
                                            }
                                        })
                                    }
                                    className="h-9"
                                >
                                    {action.icon}
                                    <span>{action.label}</span>
                                </CommandItem>
                            ))}
                        </CommandGroup>
                    </>
                )}
            </CommandList>
        </CommandDialog>
    );
}

/*******************************/
/*   COMMAND PALETTE CONTEXT   */
/*******************************/
export type CommandPaletteContextValue = {
    open: boolean;
    setOpen: (open: boolean) => void;
    toggle: () => void;
};

const CommandPaletteContext = createContext<CommandPaletteContextValue | null>(
    null
);

export function useCommandPalette() {
    const context = useContext(CommandPaletteContext);
    if (!context) {
        throw new Error(
            "useCommandPalette must be used within CommandPaletteProvider"
        );
    }
    return context;
}

//*******************************/
/*   COMMAND PALETTE PROVIDER   */
/*******************************/
type CommandPaletteProviderProps = {
    children: React.ReactNode;
    orgId?: string;
    orgs?: ListUserOrgsResponse["orgs"];
    navItems: SidebarNavSection[];
};

function isEditableTarget(target: EventTarget | null) {
    if (!(target instanceof HTMLElement)) return false;
    if (target.isContentEditable) return true;
    const tagName = target.tagName;
    return (
        tagName === "INPUT" || tagName === "TEXTAREA" || tagName === "SELECT"
    );
}

function CommandPaletteProviderInner({
    children,
    orgId,
    orgs,
    navItems
}: CommandPaletteProviderProps) {
    const [open, setOpen] = useState(false);
    const canUseCommandPalette = useCanUseCommandPalette(orgId, orgs);

    const toggle = useCallback(() => {
        setOpen((current) => !current);
    }, []);

    const contextValue = useMemo<CommandPaletteContextValue>(
        () => ({
            open,
            setOpen,
            toggle
        }),
        [open, toggle]
    );

    useEffect(() => {
        if (!canUseCommandPalette) {
            return;
        }

        function onKeyDown(event: KeyboardEvent) {
            if (
                event.key?.toLowerCase() !== "k" ||
                !(event.metaKey || event.ctrlKey)
            ) {
                return;
            }

            if (!open && isEditableTarget(event.target)) {
                return;
            }

            event.preventDefault();
            toggle();
        }

        document.addEventListener("keydown", onKeyDown);
        return () => document.removeEventListener("keydown", onKeyDown);
    }, [canUseCommandPalette, open, toggle]);

    return (
        <CommandPaletteContext value={contextValue}>
            {children}
            {canUseCommandPalette ? (
                <CommandPalette orgId={orgId} orgs={orgs} navItems={navItems} />
            ) : null}
        </CommandPaletteContext>
    );
}

export function CommandPaletteProvider(props: CommandPaletteProviderProps) {
    return <CommandPaletteProviderInner {...props} />;
}
