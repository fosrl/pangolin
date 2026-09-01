"use client";

import { useUserContext } from "@app/hooks/useUserContext";
import { ListUserOrgsResponse } from "@server/routers/org";
import { usePathname } from "next/navigation";

export function useCanUseCommandPalette(
    orgId?: string,
    orgs?: ListUserOrgsResponse["orgs"]
) {
    const pathname = usePathname();
    const { user } = useUserContext();

    if (pathname?.startsWith("/admin")) {
        return user.serverAdmin;
    }

    if (!orgId) {
        return false;
    }

    const currentOrg = orgs?.find((org) => org.orgId === orgId);
    return Boolean(currentOrg?.isAdmin || currentOrg?.isOwner);
}
