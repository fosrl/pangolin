import type { LauncherListQuery } from "@server/routers/launcher/types";

export type LauncherQueryFilters = {
    query?: string;
    groupBy?: LauncherListQuery["groupBy"];
    groupKey?: string;
    siteIds?: number[];
    labelIds?: number[];
    sort_by?: LauncherListQuery["sort_by"];
    order?: LauncherListQuery["order"];
    pageSize?: number;
};

export function buildLauncherSearchParams(
    filters: LauncherQueryFilters,
    page: number
) {
    const sp = new URLSearchParams();
    sp.set("page", String(page));
    sp.set("pageSize", String(filters.pageSize ?? 20));
    if (filters.query) {
        sp.set("query", filters.query);
    }
    if (filters.groupBy) {
        sp.set("groupBy", filters.groupBy);
    }
    if (filters.groupKey) {
        sp.set("groupKey", filters.groupKey);
    }
    if (filters.siteIds?.length) {
        sp.set("siteIds", filters.siteIds.join(","));
    }
    if (filters.labelIds?.length) {
        sp.set("labelIds", filters.labelIds.join(","));
    }
    if (filters.sort_by) {
        sp.set("sort_by", filters.sort_by);
    }
    if (filters.order) {
        sp.set("order", filters.order);
    }
    return sp;
}
