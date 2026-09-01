"use client";

import { ListUserOrgsResponse } from "@server/routers/org";
import { usePathname } from "next/navigation";
import { useMemo } from "react";

export type OrganizationCommand = {
    id: string;
    orgId: string;
    name: string;
    isPrimaryOrg?: boolean;
    href: string;
};

export function useCommandPaletteOrganizations(
    orgs: ListUserOrgsResponse["orgs"] | undefined
): OrganizationCommand[] {
    const pathname = usePathname();

    return useMemo(() => {
        if (!orgs?.length) return [];

        const sortedOrgs = [...orgs].sort((a, b) => {
            const aPrimary = Boolean(a.isPrimaryOrg);
            const bPrimary = Boolean(b.isPrimaryOrg);
            if (aPrimary && !bPrimary) return -1;
            if (!aPrimary && bPrimary) return 1;
            return 0;
        });

        return sortedOrgs.map((org) => {
            const newPath = pathname.includes("/settings/")
                ? pathname.replace(/^\/[^/]+/, `/${org.orgId}`)
                : `/${org.orgId}`;

            return {
                id: `org-${org.orgId}`,
                orgId: org.orgId,
                name: org.name,
                isPrimaryOrg: org.isPrimaryOrg,
                href: newPath
            };
        });
    }, [orgs, pathname]);
}
