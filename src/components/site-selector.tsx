import { orgQueries } from "@app/lib/queries";
import type { ListSitesResponse } from "@server/routers/site";
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
import { cn } from "@app/lib/cn";
import { CheckIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useDebounce } from "use-debounce";

export type Selectedsite = Pick<
    ListSitesResponse["sites"][number],
    "name" | "siteId" | "type"
> & {
    /** When omitted, no online/offline indicator is shown. */
    online?: ListSitesResponse["sites"][number]["online"];
};

type SiteOnlineStatusProps = {
    type: Selectedsite["type"];
    online: Selectedsite["online"];
};

/** Dot-only indicator matching `SitesTable` colors (newt/wireguard only; nothing for local or missing status). */
export function SiteOnlineStatus({ type, online }: SiteOnlineStatusProps) {
    const t = useTranslations();

    if (type !== "newt" && type !== "wireguard") {
        return null;
    }
    if (typeof online !== "boolean") {
        return null;
    }
    return (
        <span
            className="shrink-0 flex items-center"
            role="img"
            aria-label={online ? t("online") : t("offline")}
        >
            <div
                className={
                    online
                        ? "w-2 h-2 bg-green-500 rounded-full"
                        : "w-2 h-2 bg-neutral-500 rounded-full"
                }
            />
        </span>
    );
}

export type SitesSelectorProps = {
    orgId: string;
    selectedSite?: Selectedsite | null;
    onSelectSite: (selected: Selectedsite) => void;
    filterTypes?: string[];
};

export function SitesSelector({
    orgId,
    selectedSite,
    onSelectSite,
    filterTypes
}: SitesSelectorProps) {
    const t = useTranslations();
    const [siteSearchQuery, setSiteSearchQuery] = useState("");
    const [debouncedQuery] = useDebounce(siteSearchQuery, 150);

    const { data: sites = [] } = useQuery(
        orgQueries.sites({
            orgId,
            query: debouncedQuery,
            perPage: 10
        })
    );

    // always include the selected site in the list of sites shown
    const sitesShown = useMemo(() => {
        const allSites: Array<Selectedsite> = filterTypes
            ? sites.filter((s) => filterTypes.includes(s.type))
            : [...sites];
        if (
            debouncedQuery.trim().length === 0 &&
            selectedSite &&
            !allSites.find((site) => site.siteId === selectedSite?.siteId)
        ) {
            allSites.unshift(selectedSite);
        }
        return allSites;
    }, [debouncedQuery, sites, selectedSite, filterTypes]);

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
                    {sitesShown.map((site) => (
                        <CommandItem
                            key={site.siteId}
                            value={`${site.siteId}:${site.name}`}
                            onSelect={() => {
                                onSelectSite(site);
                            }}
                        >
                            <CheckIcon
                                className={cn(
                                    "mr-2 h-4 w-4",
                                    site.siteId === selectedSite?.siteId
                                        ? "opacity-100"
                                        : "opacity-0"
                                )}
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
