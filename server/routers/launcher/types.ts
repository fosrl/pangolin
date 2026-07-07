import { z } from "zod";

export const LAUNCHER_UNLABELED_GROUP_KEY = "unlabeled";
export const LAUNCHER_NO_SITE_GROUP_KEY = "no-site";
export const LAUNCHER_FLAT_GROUP_KEY = "__all__";

export const launcherViewConfigSchema = z.object({
    groupBy: z.enum(["site", "label", "none"]).default("site"),
    layout: z.enum(["grid", "list"]).default("grid"),
    sortBy: z.literal("name").default("name"),
    order: z.enum(["asc", "desc"]).default("asc"),
    showLabels: z.boolean().default(true),
    showSiteTags: z.boolean().default(true),
    showRecents: z.boolean().default(false).optional(),
    siteIds: z.array(z.number()).default([]),
    labelIds: z.array(z.number()).default([]),
    query: z.string().default("")
});

export type LauncherViewConfig = z.infer<typeof launcherViewConfigSchema>;

export const defaultLauncherViewConfig: LauncherViewConfig =
    launcherViewConfigSchema.parse({});

export type LauncherLabel = {
    labelId: number;
    name: string;
    color: string;
};

export type LauncherSiteInfo = {
    siteId: number;
    name: string;
    type: string;
    online?: boolean;
};

export type LauncherResource = {
    launcherResourceKey: string;
    resourceType: "public" | "site";
    resourceId: number;
    siteResourceId?: number;
    niceId: string;
    name: string;
    accessDisplay: string;
    accessCopyValue: string;
    accessUrl: string | null;
    iconUrl: string | null;
    enabled: boolean;
    mode: string;
    labels: LauncherLabel[];
    site?: LauncherSiteInfo;
};

export type LauncherGroup = {
    groupKey: string;
    name: string;
    groupType: "site" | "label";
    itemCount: number;
    siteType?: string;
    siteOnline?: boolean;
    labelColor?: string;
};

export type ListLauncherGroupsResponse = {
    groups: LauncherGroup[];
    pagination: {
        total: number;
        page: number;
        pageSize: number;
    };
};

export type ListLauncherResourcesResponse = {
    resources: LauncherResource[];
    pagination: {
        total: number;
        page: number;
        pageSize: number;
    };
};

export type LauncherViewRecord = {
    viewId: number;
    orgId: string;
    userId: string | null;
    name: string;
    config: LauncherViewConfig;
    createdAt: string;
    updatedAt: string;
    isOrgWide: boolean;
    isDefault: boolean;
};

export type LauncherDefaultViewOverrides = {
    personal: LauncherViewRecord | null;
    orgWide: LauncherViewRecord | null;
};

export function getEffectiveDefaultLauncherConfig(
    overrides: LauncherDefaultViewOverrides
): LauncherViewConfig {
    if (overrides.personal) {
        return overrides.personal.config;
    }

    if (overrides.orgWide) {
        return overrides.orgWide.config;
    }

    return defaultLauncherViewConfig;
}

export type ListLauncherViewsResponse = {
    views: LauncherViewRecord[];
    defaultViewOverrides: LauncherDefaultViewOverrides;
};

export const launcherFilterListQuerySchema = z.strictObject({
    pageSize: z.coerce
        .number()
        .int()
        .positive()
        .optional()
        .catch(20)
        .default(20),
    page: z.coerce.number().int().min(1).optional().catch(1).default(1),
    query: z.string().optional().default("")
});

export type LauncherFilterListQuery = z.infer<
    typeof launcherFilterListQuerySchema
>;

export type ListLauncherSitesResponse = {
    sites: LauncherSiteInfo[];
    pagination: {
        total: number;
        page: number;
        pageSize: number;
    };
};

export type ListLauncherLabelsResponse = {
    labels: LauncherLabel[];
    pagination: {
        total: number;
        page: number;
        pageSize: number;
    };
};

export const launcherListQuerySchema = z.strictObject({
    pageSize: z.coerce
        .number()
        .int()
        .positive()
        .optional()
        .catch(20)
        .default(20),
    page: z.coerce.number().int().min(1).optional().catch(1).default(1),
    query: z.string().optional().default(""),
    groupBy: z.enum(["site", "label", "none"]).optional().default("site"),
    groupKey: z.string().optional(),
    siteIds: z.string().optional(),
    labelIds: z.string().optional(),
    sort_by: z.literal("name").optional().default("name"),
    order: z.enum(["asc", "desc"]).optional().default("asc")
});

export type LauncherListQuery = z.infer<typeof launcherListQuerySchema>;

export function parseIdListParam(value: string | undefined): number[] {
    if (!value?.trim()) {
        return [];
    }
    return value
        .split(",")
        .map((part) => Number.parseInt(part.trim(), 10))
        .filter((id) => Number.isFinite(id));
}

export const DEFAULT_LAUNCHER_VIEW_ID = "default" as const;

export type LauncherViewSelection =
    | { type: "default" }
    | { type: "saved"; viewId: number };

export type LauncherScaleCapabilities = {
    allowSiteGrouping: boolean;
    allowLabelGrouping: boolean;
    requireSearchOrFilter: boolean;
};

export type LauncherScaleInfo = {
    mode: "full" | "compact";
    resourceCount: number;
    siteGroupCount: number;
    labelGroupCount: number;
    capabilities: LauncherScaleCapabilities;
};

export type ListLauncherScaleResponse = {
    scale: LauncherScaleInfo;
};

export const launcherScaleQuerySchema = z.strictObject({
    query: z.string().optional().default(""),
    groupBy: z.enum(["site", "label", "none"]).optional().default("site"),
    siteIds: z.string().optional(),
    labelIds: z.string().optional(),
    sort_by: z.literal("name").optional().default("name"),
    order: z.enum(["asc", "desc"]).optional().default("asc")
});

export type LauncherScaleQuery = z.infer<typeof launcherScaleQuerySchema>;
