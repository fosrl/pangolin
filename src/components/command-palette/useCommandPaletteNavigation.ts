"use client";

import type { CommandBarNavSection } from "@app/app/navigation";
import { flattenNavSections } from "@app/lib/flattenNavItems";
import {
    hydrateNavHref,
    navHrefParamsFromRoute
} from "@app/lib/hydrateNavHref";
import { useTranslations } from "next-intl";
import { useParams } from "next/navigation";
import { useMemo } from "react";

export type NavigationCommand = {
    id: string;
    title: string;
    href: string;
    icon?: React.ReactNode;
    sectionHeading: string;
};

export type NavigationCommandGroup = {
    heading: string;
    items: NavigationCommand[];
};

export function useCommandPaletteNavigation(
    navItems: CommandBarNavSection[]
): NavigationCommandGroup[] {
    const params = useParams();
    const t = useTranslations();

    return useMemo(() => {
        const hrefParams = navHrefParamsFromRoute(params);
        const flat = flattenNavSections(navItems);
        const groups = new Map<string, NavigationCommand[]>();

        for (const item of flat) {
            const href = hydrateNavHref(item.href, hrefParams);
            if (!href) continue;

            const groupItems = groups.get(item.sectionHeading) ?? [];
            groupItems.push({
                id: `nav-${item.sectionHeading}-${item.title}-${href}`,
                title: t(item.title),
                href,
                icon: item.icon,
                sectionHeading: item.sectionHeading
            });
            groups.set(item.sectionHeading, groupItems);
        }

        return Array.from(groups.entries()).map(([heading, items]) => ({
            heading: t(heading),
            items
        }));
    }, [navItems, params, t]);
}
