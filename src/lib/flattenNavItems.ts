import type { ReactNode } from "react";
import type {
    SidebarNavItem,
    SidebarNavSection
} from "@app/components/SidebarNav";

export type FlatNavItem = {
    title: string;
    href: string;
    icon?: ReactNode;
    sectionHeading: string;
};

function flattenItems(
    items: SidebarNavItem[],
    sectionHeading: string,
    result: FlatNavItem[]
) {
    for (const item of items) {
        if (item.href) {
            result.push({
                title: item.title,
                href: item.href,
                icon: item.icon,
                sectionHeading
            });
        }
        if (item.items?.length) {
            flattenItems(item.items, sectionHeading, result);
        }
    }
}

export function flattenNavSections(
    sections: SidebarNavSection[]
): FlatNavItem[] {
    const result: FlatNavItem[] = [];
    for (const section of sections) {
        flattenItems(section.items, section.heading, result);
    }
    return result;
}
