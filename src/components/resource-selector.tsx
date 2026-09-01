import { orgQueries } from "@app/lib/queries";
import { useQuery } from "@tanstack/react-query";
import {
    Command,
    CommandEmpty,
    CommandGroup,
    CommandInput,
    CommandItem,
    CommandList
} from "./ui/command";
import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { CheckIcon } from "lucide-react";
import { cn } from "@app/lib/cn";
import type { ListResourcesResponse } from "@server/routers/resource";
import { useDebounce } from "use-debounce";

export type SelectedResource = Pick<
    ListResourcesResponse["resources"][number],
    "name" | "resourceId" | "fullDomain" | "niceId" | "ssl" | "wildcard"
>;

export type ResourceSelectorProps = {
    orgId: string;
    selectedResource?: SelectedResource | null;
    onSelectResource: (resource: SelectedResource) => void;
    excludeWildcard?: boolean;
    showClear?: boolean;
    onClear?: () => void;
    protocol?: string;
};

export function ResourceSelector({
    orgId,
    selectedResource,
    onSelectResource,
    excludeWildcard = false,
    showClear = false,
    onClear,
    protocol
}: ResourceSelectorProps) {
    const t = useTranslations();
    const [resourceSearchQuery, setResourceSearchQuery] = useState("");

    const [debouncedSearchQuery] = useDebounce(resourceSearchQuery, 150);

    const { data: resources = [] } = useQuery(
        orgQueries.proxyResources({
            orgId: orgId,
            query: debouncedSearchQuery,
            perPage: 10,
            protocol
        })
    );

    // always include the selected resource in the list of resources shown
    const resourcesShown = useMemo(() => {
        const allResources: Array<SelectedResource> = excludeWildcard
            ? resources.filter((r) => !r.wildcard)
            : [...resources];
        if (
            debouncedSearchQuery.trim().length === 0 &&
            selectedResource &&
            !(excludeWildcard && selectedResource.wildcard) &&
            !allResources.find(
                (resource) =>
                    resource.resourceId === selectedResource?.resourceId
            )
        ) {
            allResources.unshift(selectedResource);
        }
        return allResources;
    }, [debouncedSearchQuery, resources, selectedResource, excludeWildcard]);

    return (
        <Command shouldFilter={false}>
            <CommandInput
                placeholder={t("resourceSearch")}
                value={resourceSearchQuery}
                onValueChange={setResourceSearchQuery}
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
                    {resourcesShown.map((r) => (
                        <CommandItem
                            value={`${r.name}:${r.resourceId}`}
                            key={r.resourceId}
                            onSelect={() => {
                                onSelectResource(r);
                            }}
                        >
                            <CheckIcon
                                className={cn(
                                    "mr-2 h-4 w-4",
                                    r.resourceId ===
                                        selectedResource?.resourceId
                                        ? "opacity-100"
                                        : "opacity-0"
                                )}
                            />
                            {`${r.name}`}
                        </CommandItem>
                    ))}
                </CommandGroup>
            </CommandList>
        </Command>
    );
}
