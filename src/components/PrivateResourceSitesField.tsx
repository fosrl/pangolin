"use client";

import {
    MultiSitesSelector,
    formatMultiSitesSelectorLabel
} from "@app/components/multi-site-selector";
import { SitesSelector } from "@app/components/site-selector";
import type { Selectedsite } from "@app/components/site-selector";
import { Button } from "@app/components/ui/button";
import {
    FormControl,
    FormField,
    FormItem,
    FormLabel,
    FormMessage
} from "@app/components/ui/form";
import { cn } from "@app/lib/cn";
import {
    Popover,
    PopoverContent,
    PopoverTrigger
} from "@app/components/ui/popover";
import { ChevronsUpDown } from "lucide-react";
import { useTranslations } from "next-intl";
import type { Control, FieldPath, FieldValues } from "react-hook-form";
import { PrivateResourceMultiSiteRoutingHelp } from "@app/components/PrivateResourceMultiSiteRoutingHelp";

type PrivateResourceSitesFieldProps<T extends FieldValues> = {
    control: Control<T>;
    orgId: string;
    selectedSites: Selectedsite[];
    onSelectedSitesChange: (sites: Selectedsite[]) => void;
    siteIdsFieldName?: FieldPath<T>;
    singleSite?: boolean;
};

export function PrivateResourceSitesField<T extends FieldValues>({
    control,
    orgId,
    selectedSites,
    onSelectedSitesChange,
    siteIdsFieldName = "siteIds" as FieldPath<T>,
    singleSite = false
}: PrivateResourceSitesFieldProps<T>) {
    const t = useTranslations();

    return (
        <FormField
            control={control}
            name={siteIdsFieldName}
            render={({ field }) => (
                <FormItem className="flex flex-col">
                    <FormLabel>{t("sites")}</FormLabel>
                    {singleSite ? (
                        <Popover>
                            <PopoverTrigger asChild>
                                <FormControl>
                                    <Button
                                        variant="outline"
                                        role="combobox"
                                        className={cn(
                                            "w-full justify-between",
                                            selectedSites.length === 0 &&
                                                "text-muted-foreground"
                                        )}
                                    >
                                        <span className="truncate text-left">
                                            {selectedSites[0]?.name ??
                                                t("selectSite")}
                                        </span>
                                        <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                                    </Button>
                                </FormControl>
                            </PopoverTrigger>
                            <PopoverContent className="w-full p-0">
                                <SitesSelector
                                    orgId={orgId}
                                    selectedSite={selectedSites[0] ?? null}
                                    filterTypes={["newt"]}
                                    onSelectSite={(site) => {
                                        onSelectedSitesChange([site]);
                                        field.onChange([site.siteId]);
                                    }}
                                />
                            </PopoverContent>
                        </Popover>
                    ) : (
                        <Popover>
                            <PopoverTrigger asChild>
                                <FormControl>
                                    <Button
                                        variant="outline"
                                        role="combobox"
                                        className={cn(
                                            "w-full justify-between",
                                            selectedSites.length === 0 &&
                                                "text-muted-foreground"
                                        )}
                                    >
                                        <span className="truncate text-left">
                                            {formatMultiSitesSelectorLabel(
                                                selectedSites,
                                                t
                                            )}
                                        </span>
                                        <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                                    </Button>
                                </FormControl>
                            </PopoverTrigger>
                            <PopoverContent className="w-full p-0">
                                <MultiSitesSelector
                                    orgId={orgId}
                                    selectedSites={selectedSites}
                                    filterTypes={["newt"]}
                                    onSelectionChange={(sites) => {
                                        onSelectedSitesChange(sites);
                                        field.onChange(
                                            sites.map((s) => s.siteId)
                                        );
                                    }}
                                />
                            </PopoverContent>
                        </Popover>
                    )}
                    <FormMessage />
                    {!singleSite && selectedSites.length > 1 ? (
                        <PrivateResourceMultiSiteRoutingHelp />
                    ) : null}
                </FormItem>
            )}
        />
    );
}
