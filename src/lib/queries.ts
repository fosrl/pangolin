import { build } from "@server/build";
import type { ListAlertRulesResponse } from "@server/routers/alertRule/types";
import type { QueryRequestAnalyticsResponse } from "@server/routers/auditLogs";
import type {
    QueryAccessAuditLogResponse,
    QueryActionAuditLogResponse,
    QueryConnectionAuditLogResponse,
    QueryRequestAuditLogResponse
} from "@server/routers/auditLogs/types";
import type { ListClientsResponse } from "@server/routers/client";
import type {
    GetDNSRecordsResponse,
    ListDomainsResponse
} from "@server/routers/domain";
import type { GetDomainResponse } from "@server/routers/domain/getDomain";
import type {
    GetResourceWhitelistResponse,
    GetResourcePoliciesResponse,
    ListResourceNamesResponse,
    ListResourcesResponse,
    ListResourceRolesResponse,
    ListResourceRulesResponse,
    ListResourceUsersResponse
} from "@server/routers/resource";
import type { ListRolesResponse } from "@server/routers/role";
import type { ListSitesResponse } from "@server/routers/site";
import type {
    ListSiteResourceClientsResponse,
    ListSiteResourceRolesResponse,
    ListSiteResourceUsersResponse
} from "@server/routers/siteResource";
import type { ListTargetsResponse } from "@server/routers/target";
import type { ListUsersResponse } from "@server/routers/user";
import type ResponseT from "@server/types/Response";
import {
    infiniteQueryOptions,
    keepPreviousData,
    queryOptions
} from "@tanstack/react-query";
import type { AxiosResponse } from "axios";
import z from "zod";
import { remote } from "./api";
import { durationToMs } from "./durationToMs";
import type { ListOrgLabelsResponse } from "@server/routers/labels/types";
import { ListHealthChecksResponse } from "@server/routers/healthChecks/types";
import { StatusHistoryResponse } from "@server/lib/statusHistory";
import type { ListResourcePoliciesResponse } from "@server/routers/resource/types";
import type { GetResourcePolicyResponse } from "@server/routers/policy";
import type {
    ListLauncherGroupsResponse,
    ListLauncherLabelsResponse,
    ListLauncherResourcesResponse,
    ListLauncherScaleResponse,
    ListLauncherSitesResponse,
    ListLauncherViewsResponse,
    LauncherListQuery,
    LauncherResource,
    LauncherViewConfig
} from "@server/routers/launcher/types";
import type { GetResourceResponse } from "@server/routers/resource/getResource";
import type { GetResourceAuthInfoResponse } from "@server/routers/resource/getResourceAuthInfo";
import type { GetSiteResourceResponse } from "@server/routers/siteResource/getSiteResource";
import type { LauncherQueryFilters } from "@app/lib/launcherSearchParams";
import { buildLauncherSearchParams } from "@app/lib/launcherSearchParams";

export type { LauncherQueryFilters } from "@app/lib/launcherSearchParams";
export { buildLauncherSearchParams } from "@app/lib/launcherSearchParams";

export type ProductUpdate = {
    link: string | null;
    build: "enterprise" | "oss" | "saas" | null;
    id: number;
    type: "Update" | "Important" | "New" | "Warning";
    title: string;
    contents: string;
    publishedAt: Date;
    showUntil: Date;
};

export type LatestVersionResponse = {
    pangolin: {
        latestVersion: string;
        releaseNotes: string;
    };
    newt: {
        latestVersion: string;
        releaseNotes: string;
    };
    cli: {
        latestVersion: string;
        releaseNotes: string;
    };
    "panglin-node": {
        latestVersion: string;
        releaseNotes: string;
    };
    windows: {
        latestVersion: string;
        releaseNotes: string;
    };
    android: {
        latestVersion: string;
        releaseNotes: string;
    };
    mac: {
        latestVersion: string;
        releaseNotes: string;
    };
    ios: {
        latestVersion: string;
        releaseNotes: string;
    };
};

export const productUpdatesQueries = {
    list: (enabled: boolean, version?: string) =>
        queryOptions({
            queryKey: ["PRODUCT_UPDATES"] as const,
            queryFn: async ({ signal }) => {
                const sp = new URLSearchParams({
                    build,
                    ...(version ? { version } : {})
                });
                const data = await remote.get<ResponseT<ProductUpdate[]>>(
                    `/product-updates?${sp.toString()}`,
                    { signal }
                );
                return data.data;
            },
            refetchInterval: (query) => {
                if (query.state.data) {
                    return durationToMs(5, "minutes");
                }
                return false;
            },
            enabled
        }),
    latestVersion: (enabled: boolean) =>
        queryOptions({
            queryKey: ["LATEST_VERSION"] as const,
            queryFn: async ({ signal }) => {
                const data = await remote.get<ResponseT<LatestVersionResponse>>(
                    "/versions",
                    { signal }
                );
                return data.data;
            },
            placeholderData: keepPreviousData,
            refetchInterval: (query) => {
                if (query.state.data) {
                    return durationToMs(30, "minutes");
                }
                return false;
            },
            enabled: enabled && build !== "saas" // disabled in cloud version
            // because we don't need to listen for new versions there
        })
};

export const orgQueries = {
    machineClients: ({
        orgId,
        query,
        perPage = 10_000
    }: {
        orgId: string;
        query?: string;
        perPage?: number;
    }) =>
        queryOptions({
            queryKey: ["ORG", orgId, "CLIENTS", { query, perPage }] as const,
            queryFn: async ({ signal, meta }) => {
                const sp = new URLSearchParams({
                    pageSize: perPage.toString()
                });

                if (query?.trim()) {
                    sp.set("query", query);
                }

                const res = await meta!.api.get<
                    AxiosResponse<ListClientsResponse>
                >(`/org/${orgId}/clients?${sp.toString()}`, { signal });

                return res.data.data.clients;
            }
        }),
    users: ({
        orgId,
        query,
        perPage = 10_000
    }: {
        orgId: string;
        query?: string;
        perPage?: number;
    }) =>
        queryOptions({
            queryKey: ["ORG", orgId, "USERS", { query, perPage }] as const,
            queryFn: async ({ signal, meta }) => {
                const sp = new URLSearchParams({
                    pageSize: perPage.toString()
                });

                if (query?.trim()) {
                    sp.set("query", query);
                }

                const res = await meta!.api.get<
                    AxiosResponse<ListUsersResponse>
                >(`/org/${orgId}/users?${sp.toString()}`, { signal });

                return res.data.data.users;
            }
        }),
    roles: ({
        orgId,
        query,
        perPage = 10_000
    }: {
        orgId: string;
        query?: string;
        perPage?: number;
    }) =>
        queryOptions({
            queryKey: ["ORG", orgId, "ROLES", { query, perPage }] as const,
            queryFn: async ({ signal, meta }) => {
                const sp = new URLSearchParams({
                    pageSize: perPage.toString()
                });

                if (query?.trim()) {
                    sp.set("query", query);
                }

                const res = await meta!.api.get<
                    AxiosResponse<ListRolesResponse>
                >(`/org/${orgId}/roles?${sp.toString()}`, { signal });

                return res.data.data.roles;
            }
        }),

    sites: ({
        orgId,
        query,
        perPage = 10_000
    }: {
        orgId: string;
        query?: string;
        perPage?: number;
    }) =>
        queryOptions({
            queryKey: ["ORG", orgId, "SITES", { query, perPage }] as const,
            queryFn: async ({ signal, meta }) => {
                const sp = new URLSearchParams({
                    pageSize: perPage.toString(),
                    status: "approved"
                });

                if (query?.trim()) {
                    sp.set("query", query);
                }

                const res = await meta!.api.get<
                    AxiosResponse<ListSitesResponse>
                >(`/org/${orgId}/sites?${sp.toString()}`, { signal });
                return res.data.data.sites;
            }
        }),

    labels: ({
        orgId,
        query,
        perPage = 10_000
    }: {
        orgId: string;
        query?: string;
        perPage?: number;
    }) =>
        queryOptions({
            queryKey: ["ORG", orgId, "LABELS", { query, perPage }] as const,
            queryFn: async ({ signal, meta }) => {
                const sp = new URLSearchParams({
                    pageSize: perPage.toString()
                });

                if (query?.trim()) {
                    sp.set("query", query);
                }

                const res = await meta!.api.get<
                    AxiosResponse<ListOrgLabelsResponse>
                >(`/org/${orgId}/labels?${sp.toString()}`, { signal });
                return res.data.data.labels;
            }
        }),

    domains: ({ orgId }: { orgId: string }) =>
        queryOptions({
            queryKey: ["ORG", orgId, "DOMAINS"] as const,
            queryFn: async ({ signal, meta }) => {
                const res = await meta!.api.get<
                    AxiosResponse<ListDomainsResponse>
                >(`/org/${orgId}/domains`, { signal });
                return res.data.data.domains;
            }
        }),
    identityProviders: ({
        orgId,
        useOrgOnlyIdp
    }: {
        orgId: string;
        useOrgOnlyIdp?: boolean;
    }) =>
        queryOptions({
            queryKey: ["ORG", orgId, "IDPS"] as const,
            queryFn: async ({ signal, meta }) => {
                const res = await meta!.api.get<
                    AxiosResponse<{
                        idps: { idpId: number; name: string }[];
                    }>
                >(
                    build === "saas" || useOrgOnlyIdp
                        ? `/org/${orgId}/idp`
                        : "/idp",
                    { signal }
                );
                return res.data.data.idps;
            }
        }),

    resources: ({
        orgId,
        query,
        perPage = 10_000
    }: {
        orgId: string;
        query?: string;
        perPage?: number;
    }) =>
        queryOptions({
            queryKey: ["ORG", orgId, "RESOURCES", { query, perPage }] as const,
            queryFn: async ({ signal, meta }) => {
                const sp = new URLSearchParams({
                    pageSize: perPage.toString()
                });

                if (query?.trim()) {
                    sp.set("query", query);
                }

                const res = await meta!.api.get<
                    AxiosResponse<ListResourcesResponse>
                >(`/org/${orgId}/resources?${sp.toString()}`, { signal });

                return res.data.data.resources;
            }
        }),

    healthChecks: ({
        orgId,
        perPage = 10_000
    }: {
        orgId: string;
        perPage?: number;
    }) =>
        queryOptions({
            queryKey: ["ORG", orgId, "HEALTH_CHECKS", { perPage }] as const,
            queryFn: async ({ signal, meta }) => {
                const sp = new URLSearchParams({
                    limit: perPage.toString(),
                    offset: "0"
                });
                const res = await meta!.api.get<
                    AxiosResponse<ListHealthChecksResponse>
                >(`/org/${orgId}/health-checks?${sp.toString()}`, { signal });
                return res.data.data.healthChecks;
            }
        }),

    alertRules: ({
        orgId,
        limit = 20,
        offset = 0,
        query,
        siteId,
        resourceId,
        healthCheckId,
        sortBy,
        order,
        enabled
    }: {
        orgId: string;
        limit?: number;
        offset?: number;
        query?: string;
        siteId?: number;
        resourceId?: number;
        healthCheckId?: number;
        sortBy?: string;
        order?: string;
        enabled?: string;
    }) =>
        queryOptions({
            queryKey: [
                "ORG",
                orgId,
                "ALERT_RULES",
                {
                    limit,
                    offset,
                    query,
                    siteId,
                    resourceId,
                    healthCheckId,
                    sortBy,
                    order,
                    enabled
                }
            ] as const,
            queryFn: async ({ signal, meta }) => {
                const sp = new URLSearchParams();
                sp.set("limit", String(limit));
                sp.set("offset", String(offset));
                if (query) sp.set("query", query);
                if (siteId != null) sp.set("siteId", String(siteId));
                if (resourceId != null)
                    sp.set("resourceId", String(resourceId));
                if (healthCheckId != null)
                    sp.set("healthCheckId", String(healthCheckId));
                if (sortBy) {
                    sp.set("sort_by", sortBy);
                    if (order) sp.set("order", order);
                }
                if (enabled) sp.set("enabled", enabled);
                const res = await meta!.api.get<
                    AxiosResponse<ListAlertRulesResponse>
                >(`/org/${orgId}/alert-rules?${sp.toString()}`, { signal });
                return {
                    alertRules: res.data.data.alertRules,
                    pagination: res.data.data.pagination
                };
            }
        }),

    alertRulesForSource: ({
        orgId,
        siteId,
        resourceId,
        healthCheckId
    }: {
        orgId: string;
        siteId?: number;
        resourceId?: number;
        healthCheckId?: number;
    }) =>
        queryOptions({
            queryKey: [
                "ORG",
                orgId,
                "ALERT_RULES",
                { siteId, resourceId, healthCheckId }
            ] as const,
            queryFn: async ({ signal, meta }) => {
                const sp = new URLSearchParams();
                if (siteId != null && siteId !== undefined)
                    sp.set("siteId", String(siteId));
                if (resourceId != null && resourceId !== undefined)
                    sp.set("resourceId", String(resourceId));
                if (healthCheckId != null && healthCheckId !== undefined)
                    sp.set("healthCheckId", String(healthCheckId));
                const res = await meta!.api.get<
                    AxiosResponse<ListAlertRulesResponse>
                >(`/org/${orgId}/alert-rules?${sp.toString()}`, { signal });
                return res.data.data.alertRules;
            }
        }),

    standaloneHealthChecks: ({
        orgId,
        limit = 20,
        offset = 0,
        query,
        hcMode,
        siteId,
        resourceId,
        hcHealth,
        hcEnabled
    }: {
        orgId: string;
        limit?: number;
        offset?: number;
        query?: string;
        hcMode?: "http" | "tcp" | "snmp" | "ping";
        siteId?: number;
        resourceId?: number;
        hcHealth?: "healthy" | "unhealthy" | "unknown";
        hcEnabled?: "true" | "false";
    }) =>
        queryOptions({
            queryKey: [
                "ORG",
                orgId,
                "STANDALONE_HEALTH_CHECKS",
                {
                    limit,
                    offset,
                    query,
                    hcMode,
                    siteId,
                    resourceId,
                    hcHealth,
                    hcEnabled
                }
            ] as const,
            queryFn: async ({ signal, meta }) => {
                const sp = new URLSearchParams();
                sp.set("limit", String(limit));
                sp.set("offset", String(offset));
                if (query) sp.set("query", query);
                if (hcMode) sp.set("hcMode", hcMode);
                if (siteId != null) sp.set("siteId", String(siteId));
                if (resourceId != null)
                    sp.set("resourceId", String(resourceId));
                if (hcHealth) sp.set("hcHealth", hcHealth);
                if (hcEnabled) sp.set("hcEnabled", hcEnabled);
                const res = await meta!.api.get<
                    AxiosResponse<{
                        healthChecks: {
                            targetHealthCheckId: number;
                            name: string;
                            siteId: number | null;
                            siteName: string | null;
                            siteNiceId: string | null;
                            hcEnabled: boolean;
                            hcHealth: "unknown" | "healthy" | "unhealthy";
                            hcMode: string | null;
                            hcHostname: string | null;
                            hcPort: number | null;
                            hcPath: string | null;
                            hcScheme: string | null;
                            hcMethod: string | null;
                            hcInterval: number | null;
                            hcUnhealthyInterval: number | null;
                            hcTimeout: number | null;
                            hcHeaders: string | null;
                            hcFollowRedirects: boolean | null;
                            hcStatus: number | null;
                            hcTlsServerName: string | null;
                            hcHealthyThreshold: number | null;
                            hcUnhealthyThreshold: number | null;
                            resourceId: number | null;
                            resourceName: string | null;
                            resourceNiceId: string | null;
                        }[];
                        pagination: {
                            total: number;
                            limit: number;
                            offset: number;
                        };
                    }>
                >(`/org/${orgId}/health-checks?${sp.toString()}`, { signal });
                return {
                    healthChecks: res.data.data.healthChecks,
                    pagination: res.data.data.pagination
                };
            }
        }),
    siteStatusHistory: ({
        siteId,
        days = 90
    }: {
        siteId: number;
        days?: number;
    }) =>
        queryOptions({
            queryKey: ["SITE_STATUS_HISTORY", siteId, days] as const,
            queryFn: async ({ signal, meta }) => {
                const res = await meta!.api.get<
                    AxiosResponse<StatusHistoryResponse>
                >(`/site/${siteId}/status-history?days=${days}`, { signal });
                return res.data.data;
            }
        }),

    resourceStatusHistory: ({
        resourceId,
        days = 90
    }: {
        resourceId?: number;
        days?: number;
    }) =>
        queryOptions({
            queryKey: ["RESOURCE_STATUS_HISTORY", resourceId, days] as const,
            queryFn: async ({ signal, meta }) => {
                const res = await meta!.api.get<
                    AxiosResponse<StatusHistoryResponse>
                >(`/resource/${resourceId}/status-history?days=${days}`, {
                    signal
                });
                return res.data.data;
            }
        }),

    healthCheckStatusHistory: ({
        orgId,
        healthCheckId,
        days = 90
    }: {
        orgId: string;
        healthCheckId: number;
        days?: number;
    }) =>
        queryOptions({
            queryKey: [
                "HC_STATUS_HISTORY",
                orgId,
                healthCheckId,
                days
            ] as const,
            queryFn: async ({ signal, meta }) => {
                const res = await meta!.api.get<
                    AxiosResponse<StatusHistoryResponse>
                >(
                    `/org/${orgId}/health-check/${healthCheckId}/status-history?days=${days}`,
                    { signal }
                );
                return res.data.data;
            }
        }),

    policies: ({ orgId, query }: { orgId: string; query?: string }) =>
        queryOptions({
            queryKey: ["ORG", orgId, "RESOURCES_POLICIES", query] as const,
            queryFn: async ({ signal, meta }) => {
                const sp = new URLSearchParams({
                    pageSize: "10"
                });

                if (query) {
                    sp.set("query", query);
                }

                const res = await meta!.api.get<
                    AxiosResponse<ListResourcePoliciesResponse>
                >(`/org/${orgId}/resource-policies?${sp.toString()}`, {
                    signal
                });

                return res.data.data.policies;
            }
        }),

    resourcePolicy: ({ resourcePolicyId }: { resourcePolicyId: number }) =>
        queryOptions({
            queryKey: ["RESOURCE_POLICY", resourcePolicyId] as const,
            queryFn: async ({ signal, meta }) => {
                const res = await meta!.api.get<
                    AxiosResponse<GetResourcePolicyResponse>
                >(`/resource-policy/${resourcePolicyId}`, { signal });

                return res.data.data;
            }
        })
};

export const logAnalyticsFiltersSchema = z.object({
    timeStart: z
        .string()
        .refine((val) => !isNaN(Date.parse(val)), {
            error: "timeStart must be a valid ISO date string"
        })
        .optional()
        .catch(undefined),
    timeEnd: z
        .string()
        .refine((val) => !isNaN(Date.parse(val)), {
            error: "timeEnd must be a valid ISO date string"
        })
        .optional()
        .catch(undefined),
    resourceId: z.coerce.number().optional().catch(undefined)
});

export type LogAnalyticsFilters = z.output<typeof logAnalyticsFiltersSchema>;

export const httpLogsFiltersSchema = z.object({
    timeStart: z
        .string()
        .refine((val) => !isNaN(Date.parse(val)), {
            error: "timeStart must be a valid ISO date string"
        })
        .optional()
        .catch(undefined),
    timeEnd: z
        .string()
        .refine((val) => !isNaN(Date.parse(val)), {
            error: "timeEnd must be a valid ISO date string"
        })
        .optional()
        .catch(undefined),
    page: z.coerce.number().optional().catch(0).default(0),
    pageSize: z.coerce.number().optional().catch(20).default(20),
    resourceId: z.coerce.number().optional().catch(undefined),
    action: z.string().optional().catch(undefined),
    host: z.string().optional().catch(undefined),
    location: z.string().optional().catch(undefined),
    actor: z.string().optional().catch(undefined),
    method: z.string().optional().catch(undefined),
    reason: z.string().optional().catch(undefined),
    path: z.string().optional().catch(undefined)
});

export type HttpLogFilters = z.output<typeof httpLogsFiltersSchema>;

export const accessLogsFiltersSchema = z.object({
    timeStart: z
        .string()
        .refine((val) => !isNaN(Date.parse(val)), {
            error: "timeStart must be a valid ISO date string"
        })
        .optional()
        .catch(undefined),
    timeEnd: z
        .string()
        .refine((val) => !isNaN(Date.parse(val)), {
            error: "timeEnd must be a valid ISO date string"
        })
        .optional()
        .catch(undefined),
    page: z.coerce.number().optional().catch(0).default(0),
    pageSize: z.coerce.number().optional().catch(20).default(20),
    resourceId: z.coerce.number().optional().catch(undefined),
    action: z.string().optional().catch(undefined),
    location: z.string().optional().catch(undefined),
    actor: z.string().optional().catch(undefined),
    type: z.string().optional().catch(undefined)
});

export type AccessLogFilters = z.output<typeof accessLogsFiltersSchema>;

export const actionLogsFiltersSchema = z.object({
    timeStart: z
        .string()
        .refine((val) => !isNaN(Date.parse(val)), {
            error: "timeStart must be a valid ISO date string"
        })
        .optional()
        .catch(undefined),
    timeEnd: z
        .string()
        .refine((val) => !isNaN(Date.parse(val)), {
            error: "timeEnd must be a valid ISO date string"
        })
        .optional()
        .catch(undefined),
    page: z.coerce.number().optional().catch(0).default(0),
    pageSize: z.coerce.number().optional().catch(20).default(20),
    action: z.string().optional().catch(undefined),
    actor: z.string().optional().catch(undefined)
});

export type ActionLogFilters = z.output<typeof actionLogsFiltersSchema>;

export const connectionLogsFiltersSchema = z.object({
    timeStart: z
        .string()
        .refine((val) => !isNaN(Date.parse(val)), {
            error: "timeStart must be a valid ISO date string"
        })
        .optional()
        .catch(undefined),
    timeEnd: z
        .string()
        .refine((val) => !isNaN(Date.parse(val)), {
            error: "timeEnd must be a valid ISO date string"
        })
        .optional()
        .catch(undefined),
    page: z.coerce.number().optional().catch(0).default(0),
    pageSize: z.coerce.number().optional().catch(20).default(20),
    protocol: z.string().optional().catch(undefined),
    destAddr: z.string().optional().catch(undefined),
    clientId: z.coerce.number().optional().catch(undefined),
    siteResourceId: z.coerce.number().optional().catch(undefined),
    userId: z.string().optional().catch(undefined)
});

export type ConnectionLogFilters = z.output<typeof connectionLogsFiltersSchema>;

export const logQueries = {
    requestAnalytics: ({
        orgId,
        filters
    }: {
        orgId: string;
        filters: LogAnalyticsFilters;
    }) =>
        queryOptions({
            queryKey: ["REQUEST_LOGS", orgId, "ANALYTICS", filters] as const,
            queryFn: async ({ signal, meta }) => {
                const res = await meta!.api.get<
                    AxiosResponse<QueryRequestAnalyticsResponse>
                >(`/org/${orgId}/logs/analytics`, {
                    params: filters,
                    signal
                });
                return res.data.data;
            },
            refetchInterval: (query) => {
                if (query.state.data) {
                    return durationToMs(30, "seconds");
                }
                return false;
            }
        }),

    requests: ({
        orgId,
        filters
    }: {
        orgId: string;
        filters: HttpLogFilters;
    }) =>
        queryOptions({
            queryKey: ["REQUEST_LOGS", orgId, "ALL", filters] as const,
            queryFn: async ({ signal, meta }) => {
                const { page, pageSize, ...rest } = filters;
                const res = await meta!.api.get<
                    AxiosResponse<QueryRequestAuditLogResponse>
                >(`/org/${orgId}/logs/request`, {
                    params: {
                        ...rest,
                        limit: pageSize,
                        offset: page * pageSize
                    },
                    signal
                });
                return res.data.data;
            },
            refetchInterval: (query) => {
                if (query.state.data) {
                    return durationToMs(30, "seconds");
                }
                return false;
            }
        }),

    access: ({
        orgId,
        filters
    }: {
        orgId: string;
        filters: AccessLogFilters;
    }) =>
        queryOptions({
            queryKey: ["ACCESS_LOGS", orgId, "ALL", filters] as const,
            queryFn: async ({ signal, meta }) => {
                const { page, pageSize, ...rest } = filters;
                const res = await meta!.api.get<
                    AxiosResponse<QueryAccessAuditLogResponse>
                >(`/org/${orgId}/logs/access`, {
                    params: {
                        ...rest,
                        limit: pageSize,
                        offset: page * pageSize
                    },
                    signal
                });
                return res.data.data;
            },
            refetchInterval: (query) => {
                if (query.state.data) {
                    return durationToMs(30, "seconds");
                }
                return false;
            }
        }),

    action: ({
        orgId,
        filters
    }: {
        orgId: string;
        filters: ActionLogFilters;
    }) =>
        queryOptions({
            queryKey: ["ACTION_LOGS", orgId, "ALL", filters] as const,
            queryFn: async ({ signal, meta }) => {
                const { page, pageSize, ...rest } = filters;
                const res = await meta!.api.get<
                    AxiosResponse<QueryActionAuditLogResponse>
                >(`/org/${orgId}/logs/action`, {
                    params: {
                        ...rest,
                        limit: pageSize,
                        offset: page * pageSize
                    },
                    signal
                });
                return res.data.data;
            },
            refetchInterval: (query) => {
                if (query.state.data) {
                    return durationToMs(30, "seconds");
                }
                return false;
            }
        }),

    connection: ({
        orgId,
        filters
    }: {
        orgId: string;
        filters: ConnectionLogFilters;
    }) =>
        queryOptions({
            queryKey: ["CONNECTION_LOGS", orgId, "ALL", filters] as const,
            queryFn: async ({ signal, meta }) => {
                const { page, pageSize, ...rest } = filters;
                const res = await meta!.api.get<
                    AxiosResponse<QueryConnectionAuditLogResponse>
                >(`/org/${orgId}/logs/connection`, {
                    params: {
                        ...rest,
                        limit: pageSize,
                        offset: page * pageSize
                    },
                    signal
                });
                return res.data.data;
            },
            refetchInterval: (query) => {
                if (query.state.data) {
                    return durationToMs(30, "seconds");
                }
                return false;
            }
        })
};

export const resourceQueries = {
    resourceUsers: ({ resourceId }: { resourceId: number }) =>
        queryOptions({
            queryKey: ["RESOURCES", resourceId, "USERS"] as const,
            queryFn: async ({ signal, meta }) => {
                const res = await meta!.api.get<
                    AxiosResponse<ListResourceUsersResponse>
                >(`/resource/${resourceId}/users`, { signal });
                return res.data.data.users;
            }
        }),
    resourceRoles: ({ resourceId }: { resourceId: number }) =>
        queryOptions({
            queryKey: ["RESOURCES", resourceId, "ROLES"] as const,
            queryFn: async ({ signal, meta }) => {
                const res = await meta!.api.get<
                    AxiosResponse<ListResourceRolesResponse>
                >(`/resource/${resourceId}/roles`, { signal });

                return res.data.data.roles;
            }
        }),
    resourceRules: ({ resourceId }: { resourceId: number }) =>
        queryOptions({
            queryKey: ["RESOURCES", resourceId, "RULES"] as const,
            queryFn: async ({ signal, meta }) => {
                const res = await meta!.api.get<
                    AxiosResponse<ListResourceRulesResponse>
                >(`/resource/${resourceId}/rules`, { signal });

                return res.data.data.rules;
            }
        }),
    siteResourceUsers: ({ siteResourceId }: { siteResourceId: number }) =>
        queryOptions({
            queryKey: ["SITE_RESOURCES", siteResourceId, "USERS"] as const,
            queryFn: async ({ signal, meta }) => {
                const res = await meta!.api.get<
                    AxiosResponse<ListSiteResourceUsersResponse>
                >(`/site-resource/${siteResourceId}/users`, { signal });
                return res.data.data.users;
            }
        }),
    siteResourceRoles: ({ siteResourceId }: { siteResourceId: number }) =>
        queryOptions({
            queryKey: ["SITE_RESOURCES", siteResourceId, "ROLES"] as const,
            queryFn: async ({ signal, meta }) => {
                const res = await meta!.api.get<
                    AxiosResponse<ListSiteResourceRolesResponse>
                >(`/site-resource/${siteResourceId}/roles`, { signal });

                return res.data.data.roles;
            }
        }),
    siteResourceClients: ({ siteResourceId }: { siteResourceId: number }) =>
        queryOptions({
            queryKey: ["SITE_RESOURCES", siteResourceId, "CLIENTS"] as const,
            queryFn: async ({ signal, meta }) => {
                const res = await meta!.api.get<
                    AxiosResponse<ListSiteResourceClientsResponse>
                >(`/site-resource/${siteResourceId}/clients`, { signal });

                return res.data.data.clients;
            }
        }),
    resourceTargets: ({ resourceId }: { resourceId: number }) =>
        queryOptions({
            queryKey: ["RESOURCES", resourceId, "TARGETS"] as const,
            queryFn: async ({ signal, meta }) => {
                const res = await meta!.api.get<
                    AxiosResponse<ListTargetsResponse>
                >(`/resource/${resourceId}/targets`, { signal });

                return res.data.data.targets;
            }
        }),
    resourceWhitelist: ({ resourceId }: { resourceId: number }) =>
        queryOptions({
            queryKey: ["RESOURCES", resourceId, "WHITELISTS"] as const,
            queryFn: async ({ signal, meta }) => {
                const res = await meta!.api.get<
                    AxiosResponse<GetResourceWhitelistResponse>
                >(`/resource/${resourceId}/whitelist`, { signal });

                return res.data.data.whitelist;
            }
        }),
    policies: ({ resourceId }: { resourceId: number }) =>
        queryOptions({
            queryKey: ["RESOURCES", resourceId, "POLICIES"] as const,
            queryFn: async ({ signal, meta }) => {
                const res = await meta!.api.get<
                    AxiosResponse<GetResourcePoliciesResponse>
                >(`/resource/${resourceId}/policies`, { signal });

                return res.data.data;
            }
        }),
    listNamesPerOrg: (orgId: string) =>
        queryOptions({
            queryKey: ["RESOURCES_NAMES", orgId] as const,
            queryFn: async ({ signal, meta }) => {
                const res = await meta!.api.get<
                    AxiosResponse<ListResourceNamesResponse>
                >(`/org/${orgId}/resource-names`, {
                    signal
                });
                return res.data.data;
            }
        })
};

export const approvalFiltersSchema = z.object({
    approvalState: z
        .enum(["pending", "approved", "denied", "all"])
        .default("pending")
        .catch("pending")
});

export type ApprovalItem = {
    approvalId: number;
    orgId: string;
    clientId: number | null;
    niceId: string | null;
    decision: "pending" | "approved" | "denied";
    type: "user_device";
    user: {
        name: string | null;
        userId: string;
        username: string;
        email: string | null;
    };
    deviceName: string | null;
    fingerprint: {
        platform: string | null;
        osVersion: string | null;
        kernelVersion: string | null;
        arch: string | null;
        deviceModel: string | null;
        serialNumber: string | null;
        username: string | null;
        hostname: string | null;
    } | null;
};

export const approvalQueries = {
    listApprovals: (
        orgId: string,
        filters: z.infer<typeof approvalFiltersSchema>
    ) =>
        infiniteQueryOptions({
            queryKey: ["APPROVALS", orgId, filters] as const,
            queryFn: async ({ signal, pageParam, meta }) => {
                const sp = new URLSearchParams();

                if (filters.approvalState) {
                    sp.set("approvalState", filters.approvalState);
                }
                if (pageParam) {
                    sp.set("cursorPending", pageParam.cursorPending.toString());
                    sp.set(
                        "cursorTimestamp",
                        pageParam.cursorTimestamp.toString()
                    );
                }

                const res = await meta!.api.get<
                    AxiosResponse<{
                        approvals: ApprovalItem[];
                        pagination: {
                            total: number;
                            limit: number;
                            cursorPending: number | null;
                            cursorTimestamp: number | null;
                        };
                    }>
                >(`/org/${orgId}/approvals?${sp.toString()}`, {
                    signal
                });
                return res.data.data;
            },
            initialPageParam: null as {
                cursorPending: number;
                cursorTimestamp: number;
            } | null,
            placeholderData: keepPreviousData,
            getNextPageParam: ({ pagination }) =>
                pagination.cursorPending != null &&
                pagination.cursorTimestamp != null
                    ? {
                          cursorPending: pagination.cursorPending,
                          cursorTimestamp: pagination.cursorTimestamp
                      }
                    : null
        }),
    pendingCount: (orgId: string) =>
        queryOptions({
            queryKey: ["APPROVALS", orgId, "COUNT", "pending"] as const,
            queryFn: async ({ signal, meta }) => {
                const res = await meta!.api.get<
                    AxiosResponse<{ count: number }>
                >(`/org/${orgId}/approvals/count?approvalState=pending`, {
                    signal
                });
                return res.data.data.count;
            },
            refetchInterval: (query) => {
                if (query.state.data) {
                    return durationToMs(30, "seconds");
                }
                return false;
            }
        })
};

export const domainQueries = {
    getDomain: ({ orgId, domainId }: { orgId: string; domainId: string }) =>
        queryOptions({
            queryKey: ["ORG", orgId, "DOMAIN", domainId] as const,
            queryFn: async ({ signal, meta }) => {
                const res = await meta!.api.get<
                    AxiosResponse<GetDomainResponse>
                >(`/org/${orgId}/domain/${domainId}`, { signal });
                return res.data.data;
            },
            refetchInterval: durationToMs(10, "seconds")
        }),
    getDNSRecords: ({ orgId, domainId }: { orgId: string; domainId: string }) =>
        queryOptions({
            queryKey: [
                "ORG",
                orgId,
                "DOMAIN",
                domainId,
                "DNS_RECORDS"
            ] as const,
            queryFn: async ({ signal, meta }) => {
                const res = await meta!.api.get<
                    AxiosResponse<GetDNSRecordsResponse>
                >(`/org/${orgId}/domain/${domainId}/dns-records`, { signal });
                return res.data.data;
            },
            refetchInterval: durationToMs(10, "seconds")
        })
};

export const launcherQueries = {
    views: (orgId: string) =>
        queryOptions({
            queryKey: ["ORG", orgId, "LAUNCHER", "VIEWS"] as const,
            queryFn: async ({ signal, meta }) => {
                const res = await meta!.api.get<
                    AxiosResponse<ListLauncherViewsResponse>
                >(`/org/${orgId}/launcher/views`, { signal });
                return res.data.data;
            }
        }),
    sites: ({
        orgId,
        query,
        perPage = 20
    }: {
        orgId: string;
        query?: string;
        perPage?: number;
    }) =>
        queryOptions({
            queryKey: [
                "ORG",
                orgId,
                "LAUNCHER",
                "SITES",
                { query, perPage }
            ] as const,
            queryFn: async ({ signal, meta }) => {
                const sp = new URLSearchParams({
                    pageSize: perPage.toString()
                });

                if (query?.trim()) {
                    sp.set("query", query);
                }

                const res = await meta!.api.get<
                    AxiosResponse<ListLauncherSitesResponse>
                >(`/org/${orgId}/launcher/sites?${sp.toString()}`, { signal });
                return res.data.data.sites;
            }
        }),
    labels: ({
        orgId,
        query,
        perPage = 20
    }: {
        orgId: string;
        query?: string;
        perPage?: number;
    }) =>
        queryOptions({
            queryKey: [
                "ORG",
                orgId,
                "LAUNCHER",
                "LABELS",
                { query, perPage }
            ] as const,
            queryFn: async ({ signal, meta }) => {
                const sp = new URLSearchParams({
                    pageSize: perPage.toString()
                });

                if (query?.trim()) {
                    sp.set("query", query);
                }

                const res = await meta!.api.get<
                    AxiosResponse<ListLauncherLabelsResponse>
                >(`/org/${orgId}/launcher/labels?${sp.toString()}`, {
                    signal
                });
                return res.data.data.labels;
            }
        }),
    groups: (orgId: string, filters: LauncherQueryFilters) =>
        infiniteQueryOptions({
            queryKey: ["ORG", orgId, "LAUNCHER", "GROUPS", filters] as const,
            queryFn: async ({ pageParam = 1, signal, meta }) => {
                const sp = buildLauncherSearchParams(filters, pageParam);
                const res = await meta!.api.get<
                    AxiosResponse<ListLauncherGroupsResponse>
                >(`/org/${orgId}/launcher/groups?${sp.toString()}`, { signal });
                return res.data.data;
            },
            initialPageParam: 1,
            placeholderData: keepPreviousData,
            getNextPageParam: (lastPage) => {
                const { page, pageSize, total } = lastPage.pagination;
                const nextPage = page + 1;
                return page * pageSize < total ? nextPage : undefined;
            }
        }),
    resources: (
        orgId: string,
        filters: LauncherQueryFilters & { groupKey: string }
    ) =>
        infiniteQueryOptions({
            queryKey: ["ORG", orgId, "LAUNCHER", "RESOURCES", filters] as const,
            queryFn: async ({ pageParam = 1, signal, meta }) => {
                const sp = buildLauncherSearchParams(filters, pageParam);
                const res = await meta!.api.get<
                    AxiosResponse<ListLauncherResourcesResponse>
                >(`/org/${orgId}/launcher/resources?${sp.toString()}`, {
                    signal
                });
                return res.data.data;
            },
            initialPageParam: 1,
            placeholderData: keepPreviousData,
            getNextPageParam: (lastPage) => {
                const { page, pageSize, total } = lastPage.pagination;
                const nextPage = page + 1;
                return page * pageSize < total ? nextPage : undefined;
            }
        }),
    scale: (orgId: string, filters: LauncherQueryFilters) =>
        queryOptions({
            queryKey: ["ORG", orgId, "LAUNCHER", "SCALE", filters] as const,
            queryFn: async ({ signal, meta }) => {
                const sp = buildLauncherSearchParams(filters, 1);
                sp.delete("page");
                sp.delete("pageSize");
                sp.delete("groupKey");
                const res = await meta!.api.get<
                    AxiosResponse<ListLauncherScaleResponse>
                >(`/org/${orgId}/launcher/scale?${sp.toString()}`, { signal });
                return res.data.data.scale;
            }
        }),
    resourceDetail: (orgId: string, resource: LauncherResource | null) =>
        queryOptions({
            queryKey: [
                "ORG",
                orgId,
                "LAUNCHER",
                "RESOURCE_DETAIL",
                resource?.launcherResourceKey ?? null
            ] as const,
            enabled: resource != null,
            queryFn: async ({ signal, meta }) => {
                if (!resource) {
                    throw new Error("Resource is required");
                }

                if (resource.resourceType === "public") {
                    const res = await meta!.api.get<
                        AxiosResponse<GetResourceResponse>
                    >(`/org/${orgId}/resource/${resource.niceId}`, { signal });
                    const resourceData = res.data.data;
                    const authRes = await meta!.api.get<
                        AxiosResponse<GetResourceAuthInfoResponse>
                    >(`/resource/${resourceData.resourceGuid}/auth`, {
                        signal
                    });
                    return {
                        resourceType: "public" as const,
                        data: resourceData,
                        authInfo: authRes.data.data
                    };
                }

                const siteResourceId =
                    resource.siteResourceId ?? resource.resourceId;
                const res = await meta!.api.get<
                    AxiosResponse<GetSiteResourceResponse>
                >(`/org/${orgId}/site-resource/${siteResourceId}`, { signal });
                return {
                    resourceType: "site" as const,
                    data: res.data.data
                };
            }
        })
};
