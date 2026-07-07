import type {
    LauncherScaleInfo,
    LauncherViewConfig
} from "@server/routers/launcher/types";

export function hasActiveLauncherFilters(config: LauncherViewConfig): boolean {
    return (
        config.query.trim().length > 0 ||
        config.siteIds.length > 0 ||
        config.labelIds.length > 0
    );
}

export function getEffectiveGroupBy(
    scale: LauncherScaleInfo,
    config: LauncherViewConfig
): LauncherViewConfig["groupBy"] {
    if (scale.mode !== "compact") {
        return config.groupBy;
    }

    if (
        config.groupBy === "site" &&
        config.siteIds.length > 0 &&
        scale.capabilities.allowSiteGrouping
    ) {
        return "site";
    }

    if (
        config.groupBy === "label" &&
        config.labelIds.length > 0 &&
        scale.capabilities.allowLabelGrouping
    ) {
        return "label";
    }

    return "none";
}

export function getEffectiveLauncherConfig(
    scale: LauncherScaleInfo,
    config: LauncherViewConfig
): LauncherViewConfig {
    const groupBy = getEffectiveGroupBy(scale, config);
    if (groupBy === config.groupBy) {
        return config;
    }

    return { ...config, groupBy };
}

export function shouldFetchLauncherGroups(
    scale: LauncherScaleInfo,
    config: LauncherViewConfig
): boolean {
    const groupBy = getEffectiveGroupBy(scale, config);

    if (groupBy === "none") {
        return false;
    }

    if (scale.mode === "full") {
        return true;
    }

    return (
        (scale.capabilities.allowSiteGrouping &&
            groupBy === "site" &&
            config.siteIds.length > 0) ||
        (scale.capabilities.allowLabelGrouping &&
            groupBy === "label" &&
            config.labelIds.length > 0)
    );
}

export function shouldShowLauncherGroupList(
    scale: LauncherScaleInfo,
    config: LauncherViewConfig
): boolean {
    return shouldFetchLauncherGroups(scale, config);
}

export function shouldShowSearchFirstGate(
    scale: LauncherScaleInfo,
    config: LauncherViewConfig
): boolean {
    return (
        scale.mode === "compact" &&
        scale.capabilities.requireSearchOrFilter &&
        !hasActiveLauncherFilters(config)
    );
}

export function shouldShowFlatResourceList(
    scale: LauncherScaleInfo,
    config: LauncherViewConfig
): boolean {
    if (shouldShowSearchFirstGate(scale, config)) {
        return false;
    }

    const groupBy = getEffectiveGroupBy(scale, config);

    if (groupBy === "none") {
        return true;
    }

    if (scale.mode === "full") {
        return false;
    }

    return !shouldShowLauncherGroupList(scale, config);
}
