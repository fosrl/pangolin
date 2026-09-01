import { orgQueries } from "@app/lib/queries";
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
import { type SelectedResource } from "./resource-selector";

export type MultiResourcesSelectorProps = {
    orgId: string;
    selectedResources: SelectedResource[];
    onSelectionChange: (resources: SelectedResource[]) => void;
    excludeWildcard?: boolean;
    onClear?: () => void;
    showClear?: boolean;
    protocol?: string;
};

export function formatMultiResourcesSelectorLabel(
    selectedResources: SelectedResource[],
    t: (key: string, values?: { count: number }) => string,
    emptyLabelKey = "selectResources"
): string {
    if (selectedResources.length === 0) {
        return t(emptyLabelKey);
    }
    if (selectedResources.length === 1) {
        return selectedResources[0]!.name;
    }
    return t("multiResourcesSelectorResourcesCount", {
        count: selectedResources.length
    });
}

export function MultiResourcesSelector({
    orgId,
    selectedResources,
    onSelectionChange,
    excludeWildcard = false,
    onClear,
    showClear = false,
    protocol
}: MultiResourcesSelectorProps) {
    const t = useTranslations();
    const [resourceSearchQuery, setResourceSearchQuery] = useState("");
    const [debouncedQuery] = useDebounce(resourceSearchQuery, 150);

    const { data: resources = [] } = useQuery(
        orgQueries.proxyResources({
            orgId,
            query: debouncedQuery,
            perPage: 10,
            protocol
        })
    );

    const resourcesShown = useMemo(() => {
        const base: SelectedResource[] = excludeWildcard
            ? resources.filter((r) => !r.wildcard)
            : [...resources];
        if (
            debouncedQuery.trim().length === 0 &&
            selectedResources.length > 0
        ) {
            const selectedNotInBase = selectedResources.filter(
                (sel) =>
                    !base.some((r) => r.resourceId === sel.resourceId) &&
                    !(excludeWildcard && sel.wildcard)
            );
            return [...selectedNotInBase, ...base];
        }
        return base;
    }, [debouncedQuery, resources, selectedResources, excludeWildcard]);

    const selectedIds = useMemo(
        () => new Set(selectedResources.map((r) => r.resourceId)),
        [selectedResources]
    );

    const toggleResource = (resource: SelectedResource) => {
        if (selectedIds.has(resource.resourceId)) {
            onSelectionChange(
                selectedResources.filter(
                    (r) => r.resourceId !== resource.resourceId
                )
            );
        } else {
            onSelectionChange([...selectedResources, resource]);
        }
    };

    return (
        <Command shouldFilter={false}>
            <CommandInput
                placeholder={t("resourceSearch")}
                value={resourceSearchQuery}
                onValueChange={(v) => setResourceSearchQuery(v)}
            />
            <CommandList>
                <CommandEmpty>{t("resourcesNotFound")}</CommandEmpty>
                <CommandGroup>
                    {showClear && onClear && (
                        <CommandItem
                            onSelect={onClear}
                            className="text-muted-foreground"
                        >
                            {t("accessFilterClear")}
                        </CommandItem>
                    )}
                    {resourcesShown.map((resource) => (
                        <CommandItem
                            key={resource.resourceId}
                            value={`${resource.resourceId}:${resource.name}`}
                            onSelect={() => {
                                toggleResource(resource);
                            }}
                        >
                            <Checkbox
                                className="pointer-events-none shrink-0"
                                checked={selectedIds.has(resource.resourceId)}
                                onCheckedChange={() => {}}
                                aria-hidden
                                tabIndex={-1}
                            />
                            <span className="min-w-0 flex-1 truncate">
                                {resource.name}
                            </span>
                        </CommandItem>
                    ))}
                </CommandGroup>
            </CommandList>
        </Command>
    );
}
