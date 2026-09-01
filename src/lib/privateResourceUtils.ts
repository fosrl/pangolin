"use client";

import type { Selectedsite } from "@app/components/site-selector";
import type { SiteResourceData } from "@app/lib/privateResourceForm";

export function buildSelectedSitesForResource(
    resource: Pick<SiteResourceData, "siteIds" | "siteNames">
): Selectedsite[] {
    return resource.siteIds.map((siteId, idx) => ({
        name: resource.siteNames[idx] ?? "",
        siteId,
        type: "newt" as const
    }));
}

export function getSshSingleSiteMode(
    authDaemonMode?: string | null,
    pamMode?: string | null
): boolean {
    return (
        authDaemonMode === "native" ||
        (pamMode === "push" && authDaemonMode === "site")
    );
}

export function getSshUseMultiSiteTargetForm(
    isNative: boolean,
    authDaemonMode?: string | null,
    pamMode?: string | null
): boolean {
    if (isNative) {
        return false;
    }

    return authDaemonMode !== "site" || pamMode === "passthrough";
}
