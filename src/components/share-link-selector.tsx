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
import { useDebounce } from "use-debounce";

export type SelectedShareLink = {
    accessTokenId: string;
    title: string;
};

export type ShareLinkSelectorProps = {
    orgId: string;
    selectedShareLink?: SelectedShareLink | null;
    onSelectShareLink: (shareLink: SelectedShareLink | null) => void;
    allowClear?: boolean;
    showClear?: boolean;
    onClear?: () => void;
};

function getShareLinkDisplayName(token: {
    title: string | null;
    resourceName: string | null;
    accessTokenId: string;
}): string {
    return token.title?.trim() || token.resourceName || token.accessTokenId;
}

export function ShareLinkSelector({
    orgId,
    selectedShareLink,
    onSelectShareLink,
    allowClear = true,
    showClear = false,
    onClear
}: ShareLinkSelectorProps) {
    const t = useTranslations();
    const [searchQuery, setSearchQuery] = useState("");
    const [debouncedValue] = useDebounce(searchQuery, 150);

    const { data: accessTokens = [] } = useQuery(
        orgQueries.accessTokens({ orgId, limit: 1000 })
    );

    const shareLinksShown = useMemo(() => {
        const term = debouncedValue.trim().toLowerCase();
        const allLinks: Array<SelectedShareLink> = accessTokens
            .map((token) => ({
                accessTokenId: token.accessTokenId,
                title: getShareLinkDisplayName({
                    title: token.title,
                    resourceName: token.resourceName,
                    accessTokenId: token.accessTokenId
                })
            }))
            .filter(
                (link) =>
                    term.length === 0 ||
                    link.title.toLowerCase().includes(term) ||
                    link.accessTokenId.toLowerCase().includes(term)
            )
            .slice(0, 10);

        if (
            term.length === 0 &&
            selectedShareLink &&
            !allLinks.find(
                (link) => link.accessTokenId === selectedShareLink.accessTokenId
            )
        ) {
            allLinks.unshift(selectedShareLink);
        }

        return allLinks;
    }, [accessTokens, selectedShareLink, debouncedValue]);

    return (
        <Command shouldFilter={false}>
            <CommandInput
                placeholder={t("shareSearch")}
                value={searchQuery}
                onValueChange={setSearchQuery}
            />
            <CommandList>
                <CommandEmpty>{t("shareLinksNotFound")}</CommandEmpty>
                <CommandGroup>
                    {showClear && onClear && (
                        <CommandItem
                            onSelect={onClear}
                            className="text-muted-foreground"
                        >
                            {t("accessFilterClear")}
                        </CommandItem>
                    )}
                    {allowClear && (
                        <CommandItem
                            value="__none__"
                            onSelect={() => {
                                onSelectShareLink(null);
                            }}
                        >
                            <CheckIcon
                                className={cn(
                                    "mr-2 h-4 w-4",
                                    !selectedShareLink
                                        ? "opacity-100"
                                        : "opacity-0"
                                )}
                            />
                            {t("none")}
                        </CommandItem>
                    )}
                    {shareLinksShown.map((link) => (
                        <CommandItem
                            value={`${link.title}:${link.accessTokenId}`}
                            key={link.accessTokenId}
                            onSelect={() => {
                                onSelectShareLink(link);
                            }}
                        >
                            <CheckIcon
                                className={cn(
                                    "mr-2 h-4 w-4",
                                    link.accessTokenId ===
                                        selectedShareLink?.accessTokenId
                                        ? "opacity-100"
                                        : "opacity-0"
                                )}
                            />
                            {link.title}
                        </CommandItem>
                    ))}
                </CommandGroup>
            </CommandList>
        </Command>
    );
}
