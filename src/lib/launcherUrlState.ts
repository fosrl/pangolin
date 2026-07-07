import type { LauncherActiveViewId } from "@app/lib/launcherLocalStorage";
import {
    defaultLauncherViewConfig,
    getEffectiveDefaultLauncherConfig,
    parseIdListParam,
    type LauncherDefaultViewOverrides,
    type LauncherViewConfig,
    type LauncherViewRecord
} from "@server/routers/launcher/types";
import { z } from "zod";

const launcherUrlBooleanSchema = z
    .enum(["0", "1"])
    .transform((value) => value === "1");

export type LauncherUrlConfigOverrides = Partial<
    Pick<
        LauncherViewConfig,
        | "groupBy"
        | "layout"
        | "order"
        | "showLabels"
        | "siteIds"
        | "labelIds"
        | "query"
    >
>;

export type ParsedLauncherUrlState = {
    viewId: LauncherActiveViewId | null;
    configOverrides: LauncherUrlConfigOverrides;
    hasAnyLauncherParams: boolean;
};

export type ResolvedLauncherState = {
    activeViewId: LauncherActiveViewId;
    config: LauncherViewConfig;
    savedConfig: LauncherViewConfig;
};

const LAUNCHER_CONFIG_PARAM_KEYS = [
    "query",
    "groupBy",
    "layout",
    "order",
    "showLabels",
    "siteIds",
    "labelIds"
] as const;

const LAUNCHER_URL_PARAM_KEYS = [
    "view",
    ...LAUNCHER_CONFIG_PARAM_KEYS
] as const;

export function hasLauncherConfigParams(searchParams: URLSearchParams) {
    return LAUNCHER_CONFIG_PARAM_KEYS.some((key) => searchParams.has(key));
}

export function isLauncherConfigEqual(
    a: LauncherViewConfig,
    b: LauncherViewConfig
) {
    return JSON.stringify(a) === JSON.stringify(b);
}

export function getLauncherUrlBaseConfig(
    viewId: LauncherActiveViewId,
    views: LauncherViewRecord[],
    defaultViewOverrides?: LauncherDefaultViewOverrides
): LauncherViewConfig {
    if (viewId === "default") {
        return defaultViewOverrides
            ? getEffectiveDefaultLauncherConfig(defaultViewOverrides)
            : defaultLauncherViewConfig;
    }

    const savedView = views.find((view) => view.viewId === viewId);
    return savedView?.config ?? defaultLauncherViewConfig;
}

export function resolveLauncherConfig(
    baseConfig: LauncherViewConfig,
    overrides: LauncherUrlConfigOverrides
): LauncherViewConfig {
    return {
        ...baseConfig,
        ...overrides,
        sortBy: "name"
    };
}

function parseViewParam(value: string | null): LauncherActiveViewId | null {
    if (value === null) {
        return null;
    }

    if (value === "default") {
        return "default";
    }

    const parsed = Number.parseInt(value, 10);
    if (!Number.isFinite(parsed)) {
        return "default";
    }

    return parsed;
}

function parseConfigOverrides(
    searchParams: URLSearchParams
): LauncherUrlConfigOverrides {
    const overrides: LauncherUrlConfigOverrides = {};

    const query = searchParams.get("query");
    if (query !== null) {
        overrides.query = query;
    }

    const groupBy = searchParams.get("groupBy");
    if (groupBy === "site" || groupBy === "label" || groupBy === "none") {
        overrides.groupBy = groupBy;
    }

    const layout = searchParams.get("layout");
    if (layout === "grid" || layout === "list") {
        overrides.layout = layout;
    }

    const order = searchParams.get("order");
    if (order === "asc" || order === "desc") {
        overrides.order = order;
    }

    const showLabels = searchParams.get("showLabels");
    if (showLabels !== null) {
        const parsed = launcherUrlBooleanSchema.safeParse(showLabels);
        if (parsed.success) {
            overrides.showLabels = parsed.data;
        }
    }

    const siteIds = searchParams.get("siteIds");
    if (siteIds !== null) {
        overrides.siteIds = parseIdListParam(siteIds);
    }

    const labelIds = searchParams.get("labelIds");
    if (labelIds !== null) {
        overrides.labelIds = parseIdListParam(labelIds);
    }

    return overrides;
}

export function parseLauncherUrlState(
    searchParams: URLSearchParams
): ParsedLauncherUrlState {
    const hasAnyLauncherParams = LAUNCHER_URL_PARAM_KEYS.some((key) =>
        searchParams.has(key)
    );

    return {
        viewId: parseViewParam(searchParams.get("view")),
        configOverrides: parseConfigOverrides(searchParams),
        hasAnyLauncherParams
    };
}

function isValidActiveViewId(
    viewId: LauncherActiveViewId,
    views: LauncherViewRecord[]
) {
    return viewId === "default" || views.some((view) => view.viewId === viewId);
}

export function resolveLauncherStateFromUrl(
    searchParams: URLSearchParams,
    views: LauncherViewRecord[],
    fallbackViewId: LauncherActiveViewId | null,
    defaultViewOverrides?: LauncherDefaultViewOverrides
): ResolvedLauncherState {
    const parsed = parseLauncherUrlState(searchParams);

    let activeViewId: LauncherActiveViewId = "default";

    if (parsed.viewId !== null) {
        activeViewId = isValidActiveViewId(parsed.viewId, views)
            ? parsed.viewId
            : "default";
    } else if (!parsed.hasAnyLauncherParams && fallbackViewId !== null) {
        activeViewId = isValidActiveViewId(fallbackViewId, views)
            ? fallbackViewId
            : "default";
    }

    const savedConfig = getLauncherUrlBaseConfig(
        activeViewId,
        views,
        defaultViewOverrides
    );

    let config: LauncherViewConfig;
    if (hasLauncherConfigParams(searchParams)) {
        config = resolveLauncherConfig(
            getEffectiveDefaultLauncherConfig(
                defaultViewOverrides ?? { personal: null, orgWide: null }
            ),
            parsed.configOverrides
        );
    } else if (activeViewId !== "default") {
        config = savedConfig;
    } else {
        config = getEffectiveDefaultLauncherConfig(
            defaultViewOverrides ?? { personal: null, orgWide: null }
        );
    }

    return {
        activeViewId,
        config,
        savedConfig
    };
}

function idListsEqual(a: number[], b: number[]) {
    if (a.length !== b.length) {
        return false;
    }

    return a.every((value, index) => value === b[index]);
}

export function serializeLauncherUrlState({
    viewId,
    config
}: {
    viewId: LauncherActiveViewId;
    config: LauncherViewConfig;
}): URLSearchParams {
    const baseConfig = defaultLauncherViewConfig;
    const params = new URLSearchParams();

    if (viewId !== "default") {
        params.set("view", String(viewId));
    }

    if (config.query !== baseConfig.query && config.query) {
        params.set("query", config.query);
    } else if (config.query !== baseConfig.query && !config.query) {
        params.set("query", "");
    }

    if (config.groupBy !== baseConfig.groupBy) {
        params.set("groupBy", config.groupBy);
    }

    if (config.layout !== baseConfig.layout) {
        params.set("layout", config.layout);
    }

    if (config.order !== baseConfig.order) {
        params.set("order", config.order);
    }

    if (config.showLabels !== baseConfig.showLabels) {
        params.set("showLabels", config.showLabels ? "1" : "0");
    }

    if (!idListsEqual(config.siteIds, baseConfig.siteIds)) {
        if (config.siteIds.length > 0) {
            params.set("siteIds", config.siteIds.join(","));
        } else {
            params.set("siteIds", "");
        }
    }

    if (!idListsEqual(config.labelIds, baseConfig.labelIds)) {
        if (config.labelIds.length > 0) {
            params.set("labelIds", config.labelIds.join(","));
        } else {
            params.set("labelIds", "");
        }
    }

    return params;
}

export function buildLauncherPath(orgId: string, params: URLSearchParams) {
    const query = params.toString();
    return query ? `/${orgId}?${query}` : `/${orgId}`;
}
