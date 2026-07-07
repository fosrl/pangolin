import { internal } from "@app/lib/api";
import type { LauncherActiveViewId } from "@app/lib/launcherLocalStorage";
import { shouldFetchLauncherGroups } from "@app/lib/launcherScale";
import { resolveLauncherStateFromUrl } from "@app/lib/launcherUrlState";
import { buildLauncherSearchParams } from "@app/lib/launcherSearchParams";
import type {
    LauncherGroup,
    LauncherScaleInfo,
    LauncherDefaultViewOverrides,
    LauncherViewConfig,
    LauncherViewRecord,
    ListLauncherGroupsResponse,
    ListLauncherScaleResponse,
    ListLauncherViewsResponse
} from "@server/routers/launcher/types";
import { AxiosResponse } from "axios";

export type LauncherPageData = {
    views: LauncherViewRecord[];
    defaultViewOverrides: LauncherDefaultViewOverrides;
    activeViewId: LauncherActiveViewId;
    config: LauncherViewConfig;
    savedConfig: LauncherViewConfig;
    scale: LauncherScaleInfo;
    groups: LauncherGroup[];
    groupsPagination: {
        total: number;
        page: number;
        pageSize: number;
    };
};

export async function fetchLauncherPageData(
    orgId: string,
    searchParams: URLSearchParams,
    cookieHeader: Awaited<
        ReturnType<typeof import("@app/lib/api/cookies").authCookieHeader>
    >
): Promise<LauncherPageData> {
    let views: LauncherViewRecord[] = [];
    let defaultViewOverrides: LauncherDefaultViewOverrides = {
        personal: null,
        orgWide: null
    };
    try {
        const viewsRes = await internal.get<
            AxiosResponse<ListLauncherViewsResponse>
        >(`/org/${orgId}/launcher/views`, cookieHeader);
        views = viewsRes.data.data.views;
        defaultViewOverrides = viewsRes.data.data.defaultViewOverrides;
    } catch (e) {}

    const { activeViewId, config, savedConfig } = resolveLauncherStateFromUrl(
        searchParams,
        views,
        null,
        defaultViewOverrides
    );

    const scaleFilters = {
        query: config.query,
        groupBy: config.groupBy,
        siteIds: config.siteIds,
        labelIds: config.labelIds,
        sort_by: config.sortBy,
        order: config.order
    };

    let scale: LauncherScaleInfo = {
        mode: "full",
        resourceCount: 0,
        siteGroupCount: 0,
        labelGroupCount: 0,
        capabilities: {
            allowSiteGrouping: true,
            allowLabelGrouping: true,
            requireSearchOrFilter: false
        }
    };

    try {
        const sp = buildLauncherSearchParams(scaleFilters, 1);
        sp.delete("page");
        sp.delete("pageSize");
        const scaleRes = await internal.get<
            AxiosResponse<ListLauncherScaleResponse>
        >(`/org/${orgId}/launcher/scale?${sp.toString()}`, cookieHeader);
        scale = scaleRes.data.data.scale;
    } catch (e) {}

    const groupFilters = {
        query: config.query,
        groupBy: config.groupBy,
        siteIds: config.siteIds,
        labelIds: config.labelIds,
        sort_by: config.sortBy,
        order: config.order,
        pageSize: 20
    };

    let groups: LauncherGroup[] = [];
    let groupsPagination: LauncherPageData["groupsPagination"] = {
        total: 0,
        page: 1,
        pageSize: 20
    };

    if (shouldFetchLauncherGroups(scale, config)) {
        try {
            const sp = buildLauncherSearchParams(groupFilters, 1);
            const groupsRes = await internal.get<
                AxiosResponse<ListLauncherGroupsResponse>
            >(`/org/${orgId}/launcher/groups?${sp.toString()}`, cookieHeader);
            groups = groupsRes.data.data.groups;
            groupsPagination = groupsRes.data.data.pagination;
        } catch (e) {}
    }

    return {
        views,
        defaultViewOverrides,
        activeViewId,
        config,
        savedConfig,
        scale,
        groups,
        groupsPagination
    };
}
