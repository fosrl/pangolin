import { regionalCache as cache } from "#dynamic/lib/cache";
import {
    listLauncherGroupsForUser,
    resolveAccessibleIds
} from "./launcherResourceAccess";
import {
    parseIdListParam,
    type LauncherScaleInfo,
    type LauncherScaleQuery
} from "./types";

export const LAUNCHER_FULL_MAX_RESOURCES = 2000;
export const LAUNCHER_FULL_MAX_SITE_GROUPS = 200;
export const LAUNCHER_FULL_MAX_LABEL_GROUPS = 100;
export const LAUNCHER_FILTERED_SITE_GROUPING_MAX = 20;

const LAUNCHER_SCALE_COUNTS_TTL_SEC = 60;

type LauncherScaleCountsCacheEntry = {
    resourceCount: number;
    siteGroupCount: number;
    labelGroupCount: number;
    mode: LauncherScaleInfo["mode"];
};

function launcherScaleCountsCacheKey(
    orgId: string,
    userId: string,
    roleIds: number[]
) {
    const rolesKey = [...roleIds].sort((a, b) => a - b).join(",");
    return `launcher:scale:counts:${orgId}:${userId}:${rolesKey}`;
}

function buildScaleCapabilities(
    counts: LauncherScaleCountsCacheEntry,
    query: LauncherScaleQuery
): LauncherScaleInfo["capabilities"] {
    const siteFilterIds = parseIdListParam(query.siteIds);
    const labelFilterIds = parseIdListParam(query.labelIds);

    return {
        allowSiteGrouping:
            counts.siteGroupCount <= LAUNCHER_FULL_MAX_SITE_GROUPS ||
            (siteFilterIds.length > 0 &&
                siteFilterIds.length <= LAUNCHER_FILTERED_SITE_GROUPING_MAX),
        allowLabelGrouping:
            counts.labelGroupCount <= LAUNCHER_FULL_MAX_LABEL_GROUPS ||
            (labelFilterIds.length > 0 &&
                labelFilterIds.length <= LAUNCHER_FILTERED_SITE_GROUPING_MAX),
        requireSearchOrFilter:
            counts.mode === "compact" &&
            counts.resourceCount > LAUNCHER_FULL_MAX_RESOURCES
    };
}

async function getLauncherScaleCountsForUser(
    orgId: string,
    userId: string,
    userRoleIds: number[]
): Promise<LauncherScaleCountsCacheEntry> {
    const cacheKey = launcherScaleCountsCacheKey(orgId, userId, userRoleIds);
    const cached = await cache.get<LauncherScaleCountsCacheEntry>(cacheKey);
    if (cached) {
        return cached;
    }

    const accessible = await resolveAccessibleIds(orgId, userId, userRoleIds);
    const resourceCount =
        accessible.resourceIds.length + accessible.siteResourceIds.length;

    const baselineQuery = {
        query: "",
        groupBy: "site" as const,
        siteIds: undefined,
        labelIds: undefined,
        sort_by: "name" as const,
        order: "asc" as const,
        page: 1,
        pageSize: 1
    };

    const [{ total: siteGroupCount }, { total: labelGroupCount }] =
        await Promise.all([
            listLauncherGroupsForUser(
                orgId,
                userId,
                userRoleIds,
                baselineQuery
            ),
            listLauncherGroupsForUser(orgId, userId, userRoleIds, {
                ...baselineQuery,
                groupBy: "label"
            })
        ]);

    const mode =
        resourceCount <= LAUNCHER_FULL_MAX_RESOURCES &&
        siteGroupCount <= LAUNCHER_FULL_MAX_SITE_GROUPS
            ? "full"
            : "compact";

    const result: LauncherScaleCountsCacheEntry = {
        resourceCount,
        siteGroupCount,
        labelGroupCount,
        mode
    };

    await cache.set(cacheKey, result, LAUNCHER_SCALE_COUNTS_TTL_SEC);
    return result;
}

export async function getLauncherScaleForUser(
    orgId: string,
    userId: string,
    userRoleIds: number[],
    query: LauncherScaleQuery
): Promise<LauncherScaleInfo> {
    const counts = await getLauncherScaleCountsForUser(
        orgId,
        userId,
        userRoleIds
    );

    return {
        mode: counts.mode,
        resourceCount: counts.resourceCount,
        siteGroupCount: counts.siteGroupCount,
        labelGroupCount: counts.labelGroupCount,
        capabilities: buildScaleCapabilities(counts, query)
    };
}
