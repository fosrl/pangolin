"use client";

import {
    Command,
    CommandEmpty,
    CommandGroup,
    CommandInput,
    CommandItem,
    CommandList
} from "@app/components/ui/command";
import { launcherQueries, orgQueries } from "@app/lib/queries";
import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useMemo, useState } from "react";
import { useDebounce } from "use-debounce";
import { Checkbox } from "./ui/checkbox";

export type LabelFilterOption = {
    labelId: number;
    name: string;
    color: string;
};

type LabelsFilterSelectorProps = {
    orgId: string;
    isSelected: (label: LabelFilterOption) => boolean;
    onToggle: (label: LabelFilterOption) => void;
    selectedLabels?: LabelFilterOption[];
    onClear?: () => void;
    showClear?: boolean;
    scope?: "org" | "launcher";
};

export function LabelsFilterSelector({
    orgId,
    isSelected,
    onToggle,
    selectedLabels = [],
    onClear,
    showClear = false,
    scope = "org"
}: LabelsFilterSelectorProps) {
    const t = useTranslations();
    const [labelSearchQuery, setlabelsSearchQuery] = useState("");
    const [debouncedQuery] = useDebounce(labelSearchQuery, 150);

    const orgLabelsQuery = useQuery({
        ...orgQueries.labels({
            orgId,
            query: debouncedQuery,
            perPage: 500
        }),
        enabled: scope === "org"
    });
    const launcherLabelsQuery = useQuery({
        ...launcherQueries.labels({
            orgId,
            query: debouncedQuery,
            perPage: 20
        }),
        enabled: scope === "launcher"
    });
    const labels =
        scope === "launcher"
            ? (launcherLabelsQuery.data ?? [])
            : (orgLabelsQuery.data ?? []);

    const labelsShown = useMemo(() => {
        const base = [...labels];
        if (debouncedQuery.trim().length === 0 && selectedLabels.length > 0) {
            const selectedNotInBase = selectedLabels.filter(
                (selected) =>
                    !base.some((label) => label.labelId === selected.labelId)
            );
            return [...selectedNotInBase, ...base];
        }
        return base;
    }, [debouncedQuery, labels, selectedLabels]);

    return (
        <Command shouldFilter={false}>
            <CommandInput
                placeholder={t("labelSearch")}
                value={labelSearchQuery}
                onValueChange={setlabelsSearchQuery}
            />
            <CommandList>
                <CommandEmpty>{t("labelsNotFound")}</CommandEmpty>
                <CommandGroup>
                    {showClear && onClear && (
                        <CommandItem
                            onSelect={onClear}
                            className="text-muted-foreground"
                        >
                            {t("accessFilterClear")}
                        </CommandItem>
                    )}
                    {labelsShown.map((label) => (
                        <CommandItem
                            key={label.labelId}
                            value={label.name}
                            onSelect={() => {
                                onToggle(label);
                            }}
                            className="flex items-center gap-2"
                        >
                            <Checkbox
                                className="pointer-events-none shrink-0"
                                checked={isSelected(label)}
                                aria-hidden
                                tabIndex={-1}
                            />
                            <div
                                className="size-2 rounded-full bg-(--color) flex-none"
                                style={{
                                    // @ts-expect-error css color
                                    "--color": label.color
                                }}
                            />
                            {label.name}
                        </CommandItem>
                    ))}
                </CommandGroup>
            </CommandList>
        </Command>
    );
}
