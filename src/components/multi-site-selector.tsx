import { launcherQueries, orgQueries } from "@app/lib/queries";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import {
    Command,
    CommandEmpty,
    CommandGroup,
    CommandInput,
    CommandItem,
    CommandList
} from "./ui/command";
import { Checkbox } from "./ui/checkbox";
import { useTranslations } from "next-intl";
import { useDebounce } from "use-debounce";
import { SiteOnlineStatus, type Selectedsite } from "./site-selector";

export type MultiSitesSelectorProps = {
    orgId: string;
    selectedSites: Selectedsite[];
    onSelectionChange: (sites: Selectedsite[]) => void;
    filterTypes?: string[];
    scope?: "org" | "launcher";
    onClear?: () => void;
    showClear?: boolean;
};

export function formatMultiSitesSelectorLabel(
    selectedSites: Selectedsite[],
    t: (key: string, values?: { count: number }) => string
): string {
    if (selectedSites.length === 0) {
        return t("selectSites");
    }
    if (selectedSites.length === 1) {
        return selectedSites[0]!.name;
    }
    return t("multiSitesSelectorSitesCount", {
        count: selectedSites.length
    });
}

export function MultiSitesSelector({
    orgId,
    selectedSites,
    onSelectionChange,
    filterTypes,
    scope = "org",
    onClear,
    showClear = false
}: MultiSitesSelectorProps) {
    const t = useTranslations();
    const [siteSearchQuery, setSiteSearchQuery] = useState("");
    const [debouncedQuery] = useDebounce(siteSearchQuery, 150);

    const orgSitesQuery = useQuery({
        ...orgQueries.sites({
            orgId,
            query: debouncedQuery,
            perPage: 10
        }),
        enabled: scope === "org"
    });
    const launcherSitesQuery = useQuery({
        ...launcherQueries.sites({
            orgId,
            query: debouncedQuery,
            perPage: 20
        }),
        enabled: scope === "launcher"
    });
    const sites =
        scope === "launcher"
            ? (launcherSitesQuery.data ?? [])
            : (orgSitesQuery.data ?? []);

    const sitesShown = useMemo(() => {
        const base = filterTypes
            ? sites.filter((s) => filterTypes.includes(s.type))
            : [...sites];
        if (debouncedQuery.trim().length === 0 && selectedSites.length > 0) {
            const selectedNotInBase = selectedSites.filter(
                (sel) => !base.some((s) => s.siteId === sel.siteId)
            );
            return [...selectedNotInBase, ...base];
        }
        return base;
    }, [debouncedQuery, sites, selectedSites, filterTypes]);

    const selectedIds = useMemo(
        () => new Set(selectedSites.map((s) => s.siteId)),
        [selectedSites]
    );

    const toggleSite = (site: Selectedsite) => {
        if (selectedIds.has(site.siteId)) {
            onSelectionChange(
                selectedSites.filter((s) => s.siteId !== site.siteId)
            );
        } else {
            onSelectionChange([...selectedSites, site]);
        }
    };

    return (
        <Command shouldFilter={false}>
            <CommandInput
                placeholder={t("siteSearch")}
                value={siteSearchQuery}
                onValueChange={(v) => setSiteSearchQuery(v)}
            />
            <CommandList>
                <CommandEmpty>{t("siteNotFound")}</CommandEmpty>
                <CommandGroup>
                    {showClear && onClear && (
                        <CommandItem
                            onSelect={onClear}
                            className="text-muted-foreground"
                        >
                            {t("accessFilterClear")}
                        </CommandItem>
                    )}
                    {sitesShown.map((site) => (
                        <CommandItem
                            key={site.siteId}
                            value={`${site.siteId}:${site.name}`}
                            onSelect={() => {
                                toggleSite(site);
                            }}
                        >
                            <Checkbox
                                className="pointer-events-none shrink-0"
                                checked={selectedIds.has(site.siteId)}
                                onCheckedChange={() => {}}
                                aria-hidden
                                tabIndex={-1}
                            />
                            <div className="min-w-0 flex-1 flex items-center gap-2">
                                <span className="min-w-0 flex-1 truncate">
                                    {site.name}
                                </span>
                                {site.online != null && (
                                    <SiteOnlineStatus
                                        type={site.type}
                                        online={site.online}
                                    />
                                )}
                            </div>
                        </CommandItem>
                    ))}
                </CommandGroup>
            </CommandList>
        </Command>
    );
}
