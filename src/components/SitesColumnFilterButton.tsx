import { useMemo, useState } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover";
import { cn } from "@app/lib/cn";
import { dataTableFilterPopoverContentClassName } from "@app/lib/dataTableFilterPopover";
import { CheckIcon, Funnel } from "lucide-react";
import { SiteOnlineStatus, type Selectedsite } from "./site-selector";
import { Button } from "./ui/button";
import { useTranslations } from "next-intl";
import { Badge } from "./ui/badge";
import { orgQueries } from "@app/lib/queries";
import { useQuery } from "@tanstack/react-query";
import { useDebounce } from "use-debounce";
import {
    Command,
    CommandEmpty,
    CommandGroup,
    CommandInput,
    CommandItem,
    CommandList
} from "./ui/command";

export type SitesColumnFilterButtonProps = {
    selectedSiteId: number | null;
    onValueChange: (value: number | undefined) => void;
    orgId: string;
};

export function SitesColumnFilterButton({
    selectedSiteId,
    onValueChange,
    orgId
}: SitesColumnFilterButtonProps) {
    const [open, setOpen] = useState(false);

    const t = useTranslations();

    const [siteSearchQuery, setSiteSearchQuery] = useState("");
    const [debouncedQuery] = useDebounce(siteSearchQuery, 150);

    const { data: sites = [] } = useQuery(
        orgQueries.sites({
            orgId,
            query: debouncedQuery,
            perPage: 500
        })
    );

    const selectedSite = useMemo(() => {
        let selected = undefined;
        if (selectedSiteId) {
            selected = sites.find((site) => site.siteId === selectedSiteId) ?? {
                siteId: Number(selectedSiteId),
                name: t("standaloneHcFilterSiteIdFallback", {
                    id: Number(selectedSiteId)
                }),
                type: "newt"
            };
        }

        return selected;
    }, [selectedSiteId, sites]);

    // always include the selected site in the list of sites shown
    const sitesShown = useMemo(() => {
        const allSites: Array<Selectedsite> = [...sites];
        if (
            debouncedQuery.trim().length === 0 &&
            selectedSite &&
            !allSites.find((site) => site.siteId === selectedSite?.siteId)
        ) {
            allSites.unshift(selectedSite);
        }
        return allSites;
    }, [debouncedQuery, sites, selectedSite]);

    return (
        <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
                <Button
                    type="button"
                    variant="ghost"
                    role="combobox"
                    className={cn(
                        "justify-between text-sm h-8 px-2 w-full p-3",
                        selectedSite && "text-muted-foreground"
                    )}
                >
                    <div className="flex items-center gap-2 min-w-0">
                        {t("sites")}
                        <Funnel className="size-4 flex-none" />
                        {selectedSite && (
                            <Badge
                                className="truncate max-w-40"
                                variant="secondary"
                            >
                                {selectedSite.name}
                            </Badge>
                        )}
                    </div>
                </Button>
            </PopoverTrigger>
            <PopoverContent
                className={dataTableFilterPopoverContentClassName}
                align="start"
            >
                <Command shouldFilter={false}>
                    <CommandInput
                        placeholder={t("siteSearch")}
                        value={siteSearchQuery}
                        onValueChange={(v) => setSiteSearchQuery(v)}
                    />
                    <CommandList>
                        <CommandEmpty>{t("siteNotFound")}</CommandEmpty>
                        <CommandGroup>
                            {selectedSite && (
                                <CommandItem
                                    onSelect={() => {
                                        onValueChange(undefined);
                                    }}
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
                                        onValueChange(site.siteId);
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
            </PopoverContent>
        </Popover>
    );
}
