import {
    getAiBudgetScopeListPath,
    type AiBudgetScope
} from "@app/lib/aiBudgetScope";
import type { AiProviderType } from "@app/lib/aiProviderDefaults";
import type { LauncherQueryFilters } from "@app/lib/launcherSearchParams";
import { buildLauncherSearchParams } from "@app/lib/launcherSearchParams";
import { build } from "@server/build";
import {
    StatusHistoryResponse,
    type BatchedStatusHistoryResponse
} from "@server/lib/statusHistory";
import type { ListAiBudgetsByScopeResponse } from "@server/routers/aiBudget/types";
import type {
    ListAiModelsResponse,
    ListAiProvidersResponse,
    ListCatalogModelsResponse
} from "@server/routers/aiProvider/types";
import type { ListAlertRulesResponse } from "@server/routers/alertRule/types";
import type {
    QueryAiUsageFilterOptionsResponse,
    QueryAiUsageOverviewResponse,
    QueryAiUsageProvidersResponse,
    QueryAiUsageResourcesResponse,
    QueryAiUsageUsersRolesResponse,
    QueryAiUsageVirtualApiKeysResponse,
    QueryRequestAnalyticsResponse
} from "@server/routers/auditLogs";
import type {
    QueryAccessAuditLogResponse,
    QueryActionAuditLogResponse,
    QueryAiSessionLogResponse,
    QueryConnectionAuditLogResponse,
    QueryRequestAuditLogResponse
} from "@server/routers/auditLogs/types";
import type { GetCertificateResponse } from "@server/routers/certificates/types";
import type {
    ListClientsResponse,
    ListUserDevicesResponse
} from "@server/routers/client";
import type {
    GetDNSRecordsResponse,
    ListDomainsResponse
} from "@server/routers/domain";
import type { GetDomainResponse } from "@server/routers/domain/getDomain";
import { ListHealthChecksResponse } from "@server/routers/healthChecks/types";
import type { ListOrgLabelsResponse } from "@server/routers/labels/types";
import type { ListLauncherAiModelsResponse } from "@server/routers/launcher/listLauncherAiModels";
import type {
    LauncherResource,
    ListLauncherGroupsResponse,
    ListLauncherLabelsResponse,
    ListLauncherResourcesResponse,
    ListLauncherScaleResponse,
    ListLauncherSitesResponse,
    ListLauncherViewsResponse
} from "@server/routers/launcher/types";
import type { GetResourcePolicyResponse } from "@server/routers/policy";
import type { ListRemoteExitNodesResponse } from "@server/routers/remoteExitNode/types";
import type {
    GetResourcePoliciesResponse,
    GetResourceWhitelistResponse,
    ListResourceAiModelsResponse,
    ListResourceNamesResponse,
    ListResourceRolesResponse,
    ListResourceRulesResponse,
    ListResourcesResponse,
    ListResourceUsersResponse
} from "@server/routers/resource";
import type { GetResourceResponse } from "@server/routers/resource/getResource";
import type { GetResourceAuthInfoResponse } from "@server/routers/resource/getResourceAuthInfo";
import type { ListResourcePoliciesResponse } from "@server/routers/resource/types";
import type { ListRolesResponse } from "@server/routers/role";
import type { ListSitesResponse } from "@server/routers/site";
import type {
    ListAllSiteResourcesByOrgResponse,
    ListSiteResourceAiModelsResponse,
    ListSiteResourceClientsResponse,
    ListSiteResourceRolesResponse,
    ListSiteResourceUsersResponse
} from "@server/routers/siteResource";
import type { GetSiteResourceResponse } from "@server/routers/siteResource/getSiteResource";
import type { ListTargetsResponse } from "@server/routers/target";
import type { ListUsersResponse } from "@server/routers/user";
import type { ListMyVirtualApiKeysResponse } from "@server/routers/virtualApiKey/types";
import type ResponseT from "@server/types/Response";
import {
    infiniteQueryOptions,
    keepPreviousData,
    queryOptions
} from "@tanstack/react-query";
import { isAxiosError, type AxiosResponse } from "axios";
import z from "zod";
import { remote } from "./api";
import { durationToMs } from "./durationToMs";

export { buildLauncherSearchParams } from "@app/lib/launcherSearchParams";
export type { LauncherQueryFilters } from "@app/lib/launcherSearchParams";

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
    userDevices: ({
        orgId,
        query,
        perPage = 10_000
    }: {
        orgId: string;
        query?: string;
        perPage?: number;
    }) =>
        queryOptions({
            queryKey: [
                "ORG",
                orgId,
                "USER_DEVICES",
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
                    AxiosResponse<ListUserDevicesResponse>
                >(`/org/${orgId}/user-devices?${sp.toString()}`, { signal });

                return res.data.data.devices;
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

    remoteExitNodes: ({ orgId }: { orgId: string }) =>
        queryOptions({
            queryKey: ["ORG", orgId, "REMOTE_EXIT_NODES"] as const,
            queryFn: async ({ signal, meta }) => {
                const res = await meta!.api.get<
                    AxiosResponse<ListRemoteExitNodesResponse>
                >(`/org/${orgId}/remote-exit-nodes`, { signal });
                return res.data.data.remoteExitNodes;
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

    proxyResources: ({
        orgId,
        query,
        perPage = 10_000,
        protocol
    }: {
        orgId: string;
        query?: string;
        perPage?: number;
        protocol?: string;
    }) =>
        queryOptions({
            queryKey: [
                "ORG",
                orgId,
                "PROXY_RESOURCES",
                { query, perPage, protocol }
            ] as const,
            queryFn: async ({ signal, meta }) => {
                const sp = new URLSearchParams({
                    pageSize: perPage.toString()
                });

                if (query?.trim()) {
                    sp.set("query", query);
                }

                if (protocol) {
                    sp.set("protocol", protocol);
                }

                const res = await meta!.api.get<
                    AxiosResponse<ListResourcesResponse>
                >(`/org/${orgId}/resources?${sp.toString()}`, { signal });

                return res.data.data.resources;
            }
        }),

    privateResources: ({
        orgId,
        query,
        perPage = 10_000
    }: {
        orgId: string;
        query?: string;
        perPage?: number;
    }) =>
        queryOptions({
            queryKey: [
                "ORG",
                orgId,
                "PRIVATE_RESOURCES",
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
                    AxiosResponse<ListAllSiteResourcesByOrgResponse>
                >(`/org/${orgId}/site-resources?${sp.toString()}`, { signal });

                return res.data.data.siteResources;
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
    batchedSiteStatusHistory: ({
        siteIds,
        orgId,
        days = 90
    }: {
        orgId: string;
        siteIds: number[];
        days?: number;
    }) =>
        queryOptions({
            queryKey: [
                "ORG",
                orgId,
                "BATCHED_SITE_STATUS_HISTORY",
                siteIds,
                days
            ] as const,
            queryFn: async ({ signal, meta }) => {
                // Negated because getTimezoneOffset() returns UTC - local,
                // while the API expects minutes to add to UTC to get local
                const tzOffsetMinutes = -new Date().getTimezoneOffset();
                const sp = new URLSearchParams([
                    ["days", days.toString()],
                    ["tzOffsetMinutes", tzOffsetMinutes.toString()],
                    ...siteIds.map((id) => ["siteIds", id.toString()])
                ]);

                const res = await meta!.api.get<
                    AxiosResponse<BatchedStatusHistoryResponse>
                >(`/org/${orgId}/site-status-histories?${sp.toString()}`, {
                    signal
                });
                return res.data.data;
            },
            staleTime: durationToMs(5, "seconds")
        }),
    batchedHealthCheckStatusHistory: ({
        healthCheckIds,
        orgId,
        days = 90
    }: {
        orgId: string;
        healthCheckIds: number[];
        days?: number;
    }) =>
        queryOptions({
            queryKey: [
                "ORG",
                orgId,
                "BATCHED_HEALTH_CHECK_STATUS_HISTORY",
                healthCheckIds,
                days
            ] as const,
            queryFn: async ({ signal, meta }) => {
                // Negated because getTimezoneOffset() returns UTC - local,
                // while the API expects minutes to add to UTC to get local
                const tzOffsetMinutes = -new Date().getTimezoneOffset();
                const sp = new URLSearchParams([
                    ["days", days.toString()],
                    ["tzOffsetMinutes", tzOffsetMinutes.toString()],
                    ...healthCheckIds.map((id) => [
                        "healthCheckIds",
                        id.toString()
                    ])
                ]);

                const res = await meta!.api.get<
                    AxiosResponse<BatchedStatusHistoryResponse>
                >(
                    `/org/${orgId}/health-check-status-histories?${sp.toString()}`,
                    { signal }
                );
                return res.data.data;
            },
            staleTime: durationToMs(5, "seconds")
        }),
    batchedDomainCertificates: ({
        domains,
        orgId
    }: {
        orgId: string;
        domains: string[];
    }) =>
        queryOptions({
            queryKey: ["ORG", orgId, "BATCHED_CERTIFICATES", domains] as const,
            queryFn: async ({ signal, meta }) => {
                // Negated because getTimezoneOffset() returns UTC - local,
                // while the API expects minutes to add to UTC to get local
                const sp = new URLSearchParams([
                    ...domains.map((domain) => ["domains", domain.toString()])
                ]);

                const res = await meta!.api.get<
                    AxiosResponse<BatchedStatusHistoryResponse>
                >(`/org/${orgId}/batched-certificates?${sp.toString()}`, {
                    signal
                });
                return res.data.data;
            },
            staleTime: durationToMs(5, "seconds")
        }),
    batchedResourceStatusHistory: ({
        resourceIds,
        orgId,
        days = 90
    }: {
        orgId: string;
        resourceIds: number[];
        days?: number;
    }) =>
        queryOptions({
            queryKey: [
                "ORG",
                orgId,
                "BATCHED_RESOURCE_STATUS_HISTORY",
                resourceIds,
                days
            ] as const,
            queryFn: async ({ signal, meta }) => {
                // Negated because getTimezoneOffset() returns UTC - local,
                // while the API expects minutes to add to UTC to get local
                const tzOffsetMinutes = -new Date().getTimezoneOffset();
                const sp = new URLSearchParams([
                    ["days", days.toString()],
                    ["tzOffsetMinutes", tzOffsetMinutes.toString()],
                    ...resourceIds.map((id) => ["resourceIds", id.toString()])
                ]);

                const res = await meta!.api.get<
                    AxiosResponse<BatchedStatusHistoryResponse>
                >(`/org/${orgId}/resource-status-histories?${sp.toString()}`, {
                    signal
                });
                return res.data.data;
            },
            staleTime: durationToMs(5, "seconds")
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
            staleTime: durationToMs(5, "seconds"),
            queryFn: async ({ signal, meta }) => {
                const tzOffsetMinutes = -new Date().getTimezoneOffset();
                const res = await meta!.api.get<
                    AxiosResponse<StatusHistoryResponse>
                >(
                    `/site/${siteId}/status-history?days=${days}&tzOffsetMinutes=${tzOffsetMinutes}`,
                    { signal }
                );
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
            staleTime: durationToMs(5, "seconds"),
            queryFn: async ({ signal, meta }) => {
                const tzOffsetMinutes = -new Date().getTimezoneOffset();
                const res = await meta!.api.get<
                    AxiosResponse<StatusHistoryResponse>
                >(
                    `/resource/${resourceId}/status-history?days=${days}&tzOffsetMinutes=${tzOffsetMinutes}`,
                    { signal }
                );
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
            staleTime: durationToMs(5, "seconds"),
            queryKey: [
                "HC_STATUS_HISTORY",
                orgId,
                healthCheckId,
                days
            ] as const,
            queryFn: async ({ signal, meta }) => {
                const tzOffsetMinutes = -new Date().getTimezoneOffset();
                const res = await meta!.api.get<
                    AxiosResponse<StatusHistoryResponse>
                >(
                    `/org/${orgId}/health-check/${healthCheckId}/status-history?days=${days}&tzOffsetMinutes=${tzOffsetMinutes}`,
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

export const aiUsageAnalyticsFiltersSchema = z.object({
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
    providerId: z.coerce.number().optional().catch(undefined),
    model: z.string().optional().catch(undefined),
    resourceId: z.coerce.number().optional().catch(undefined),
    roleId: z.coerce.number().optional().catch(undefined),
    userId: z.string().optional().catch(undefined),
    virtualApiKeyId: z.string().optional().catch(undefined)
});

export type AiUsageAnalyticsFilters = z.output<
    typeof aiUsageAnalyticsFiltersSchema
>;

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
    path: z.string().optional().catch(undefined),
    ip: z.array(z.string()).optional().catch(undefined)
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
    type: z.string().optional().catch(undefined),
    ip: z.array(z.string()).optional().catch(undefined)
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

export const aiSessionLogsFiltersSchema = z.object({
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
    providerId: z.string().optional().catch(undefined),
    capability: z.string().optional().catch(undefined),
    resourceId: z.string().optional().catch(undefined),
    actor: z.string().optional().catch(undefined),
    virtualApiKeyId: z.string().optional().catch(undefined),
    model: z.string().optional().catch(undefined),
    isStream: z.string().optional().catch(undefined)
});

export type AiSessionLogFilters = z.output<typeof aiSessionLogsFiltersSchema>;

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
                const { page, pageSize, ip, ...rest } = filters;
                const sp = new URLSearchParams(
                    (ip ?? []).map((ip) => ["ip", ip])
                );
                const res = await meta!.api.get<
                    AxiosResponse<QueryRequestAuditLogResponse>
                >(`/org/${orgId}/logs/request?${sp.toString()}`, {
                    params: {
                        ...rest,
                        limit: pageSize,
                        offset: page * pageSize
                    },
                    signal
                });
                return res.data.data;
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
                const { page, pageSize, ip, ...rest } = filters;
                const sp = new URLSearchParams(
                    (ip ?? []).map((ip) => ["ip", ip])
                );
                const res = await meta!.api.get<
                    AxiosResponse<QueryAccessAuditLogResponse>
                >(`/org/${orgId}/logs/access?${sp.toString()}`, {
                    params: {
                        ...rest,
                        limit: pageSize,
                        offset: page * pageSize
                    },
                    signal
                });
                return res.data.data;
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
            }
        }),

    aiSessions: ({
        orgId,
        filters
    }: {
        orgId: string;
        filters: AiSessionLogFilters;
    }) =>
        queryOptions({
            queryKey: ["AI_SESSION_LOGS", orgId, "ALL", filters] as const,
            queryFn: async ({ signal, meta }) => {
                const { page, pageSize, ...rest } = filters;
                const res = await meta!.api.get<
                    AxiosResponse<QueryAiSessionLogResponse>
                >(`/org/${orgId}/logs/ai`, {
                    params: {
                        ...rest,
                        limit: pageSize,
                        offset: page * pageSize
                    },
                    signal
                });
                return res.data.data;
            }
        })
};

export const aiUsageAnalyticsQueries = {
    filterOptions: ({
        orgId,
        filters
    }: {
        orgId: string;
        filters: Pick<AiUsageAnalyticsFilters, "timeStart" | "timeEnd">;
    }) =>
        queryOptions({
            queryKey: [
                "AI_USAGE_ANALYTICS",
                orgId,
                "FILTERS",
                filters
            ] as const,
            queryFn: async ({ signal, meta }) => {
                const res = await meta!.api.get<
                    AxiosResponse<QueryAiUsageFilterOptionsResponse>
                >(`/org/${orgId}/logs/ai/usage/filters`, {
                    params: filters,
                    signal
                });
                return res.data.data;
            }
        }),

    overview: ({
        orgId,
        filters
    }: {
        orgId: string;
        filters: AiUsageAnalyticsFilters;
    }) =>
        queryOptions({
            queryKey: [
                "AI_USAGE_ANALYTICS",
                orgId,
                "OVERVIEW",
                filters
            ] as const,
            queryFn: async ({ signal, meta }) => {
                const res = await meta!.api.get<
                    AxiosResponse<QueryAiUsageOverviewResponse>
                >(`/org/${orgId}/logs/ai/usage/overview`, {
                    params: filters,
                    signal
                });
                return res.data.data;
            }
        }),

    providers: ({
        orgId,
        filters
    }: {
        orgId: string;
        filters: AiUsageAnalyticsFilters;
    }) =>
        queryOptions({
            queryKey: [
                "AI_USAGE_ANALYTICS",
                orgId,
                "PROVIDERS",
                filters
            ] as const,
            queryFn: async ({ signal, meta }) => {
                const res = await meta!.api.get<
                    AxiosResponse<QueryAiUsageProvidersResponse>
                >(`/org/${orgId}/logs/ai/usage/providers`, {
                    params: filters,
                    signal
                });
                return res.data.data;
            }
        }),

    resources: ({
        orgId,
        filters
    }: {
        orgId: string;
        filters: AiUsageAnalyticsFilters;
    }) =>
        queryOptions({
            queryKey: [
                "AI_USAGE_ANALYTICS",
                orgId,
                "RESOURCES",
                filters
            ] as const,
            queryFn: async ({ signal, meta }) => {
                const res = await meta!.api.get<
                    AxiosResponse<QueryAiUsageResourcesResponse>
                >(`/org/${orgId}/logs/ai/usage/resources`, {
                    params: filters,
                    signal
                });
                return res.data.data;
            }
        }),

    usersRoles: ({
        orgId,
        filters
    }: {
        orgId: string;
        filters: AiUsageAnalyticsFilters;
    }) =>
        queryOptions({
            queryKey: [
                "AI_USAGE_ANALYTICS",
                orgId,
                "USERS_ROLES",
                filters
            ] as const,
            queryFn: async ({ signal, meta }) => {
                const res = await meta!.api.get<
                    AxiosResponse<QueryAiUsageUsersRolesResponse>
                >(`/org/${orgId}/logs/ai/usage/users-roles`, {
                    params: filters,
                    signal
                });
                return res.data.data;
            }
        }),

    virtualApiKeys: ({
        orgId,
        filters
    }: {
        orgId: string;
        filters: AiUsageAnalyticsFilters;
    }) =>
        queryOptions({
            queryKey: [
                "AI_USAGE_ANALYTICS",
                orgId,
                "VIRTUAL_API_KEYS",
                filters
            ] as const,
            queryFn: async ({ signal, meta }) => {
                const res = await meta!.api.get<
                    AxiosResponse<QueryAiUsageVirtualApiKeysResponse>
                >(`/org/${orgId}/logs/ai/usage/virtual-api-keys`, {
                    params: filters,
                    signal
                });
                return res.data.data;
            }
        })
};

export const aiProviderQueries = {
    providerTargets: ({ providerId }: { providerId: number }) =>
        queryOptions({
            queryKey: ["AI_PROVIDERS", providerId, "TARGETS"] as const,
            queryFn: async ({ signal, meta }) => {
                const res = await meta!.api.get<
                    AxiosResponse<ListTargetsResponse>
                >(`/ai-provider/${providerId}/targets`, { signal });

                return res.data.data.targets;
            }
        }),
    providerModels: ({ providerId }: { providerId: number }) =>
        queryOptions({
            queryKey: ["AI_PROVIDERS", providerId, "MODELS"] as const,
            queryFn: async ({ signal, meta }) => {
                const res = await meta!.api.get<
                    AxiosResponse<ListAiModelsResponse>
                >(`/ai-provider/${providerId}/models`, {
                    params: { page: 1, pageSize: 1000 },
                    signal
                });
                return res.data.data.models;
            }
        }),
    catalogModels: ({ providerId }: { providerId: number }) =>
        queryOptions({
            queryKey: ["AI_PROVIDERS", providerId, "CATALOG_MODELS"] as const,
            queryFn: async ({ signal, meta }) => {
                const res = await meta!.api.get<
                    AxiosResponse<ListCatalogModelsResponse>
                >(`/ai-provider/${providerId}/catalog-models`, { signal });
                return res.data.data.models;
            }
        }),
    catalogModelsByType: ({
        orgId,
        type
    }: {
        orgId: string;
        type: AiProviderType;
    }) =>
        queryOptions({
            queryKey: ["AI_PROVIDERS", orgId, "CATALOG_MODELS", type] as const,
            queryFn: async ({ signal, meta }) => {
                const res = await meta!.api.get<
                    AxiosResponse<ListCatalogModelsResponse>
                >(`/org/${orgId}/ai-catalog-models`, {
                    params: { type },
                    signal
                });
                return res.data.data.models;
            }
        }),
    orgProviders: ({ orgId, query }: { orgId: string; query?: string }) =>
        queryOptions({
            queryKey: ["AI_PROVIDERS", orgId, "LIST", query ?? ""] as const,
            queryFn: async ({ signal, meta }) => {
                const res = await meta!.api.get<
                    AxiosResponse<ListAiProvidersResponse>
                >(`/org/${orgId}/ai-providers`, {
                    params: {
                        page: 1,
                        pageSize: 100,
                        ...(query ? { query } : {})
                    },
                    signal
                });
                return res.data.data.providers;
            }
        })
};

export const aiBudgetQueries = {
    scoped: ({ scope }: { scope: AiBudgetScope }) =>
        queryOptions({
            queryKey: ["AI_BUDGETS", scope.type, scope.id] as const,
            queryFn: async ({ signal, meta }) => {
                const res = await meta!.api.get<
                    AxiosResponse<ListAiBudgetsByScopeResponse>
                >(getAiBudgetScopeListPath(scope), { signal });
                return res.data.data.budgets;
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
    siteResourceAiProviders: ({ siteResourceId }: { siteResourceId: number }) =>
        queryOptions({
            queryKey: [
                "SITE_RESOURCES",
                siteResourceId,
                "AI_PROVIDERS"
            ] as const,
            queryFn: async ({ signal, meta }) => {
                const res = await meta!.api.get<
                    AxiosResponse<{
                        providers: Array<{
                            providerId: number;
                            niceId: string;
                            name: string;
                            type: string;
                            enabled: boolean;
                            providerEnabled: boolean;
                            accessMode: "inherit" | "select";
                        }>;
                    }>
                >(`/site-resource/${siteResourceId}/ai-providers`, {
                    signal
                });
                return res.data.data.providers;
            }
        }),
    resourceAiProviders: ({ resourceId }: { resourceId: number }) =>
        queryOptions({
            queryKey: ["RESOURCES", resourceId, "AI_PROVIDERS"] as const,
            queryFn: async ({ signal, meta }) => {
                const res = await meta!.api.get<
                    AxiosResponse<{
                        providers: Array<{
                            providerId: number;
                            niceId: string;
                            name: string;
                            type: string;
                            enabled: boolean;
                            providerEnabled: boolean;
                            accessMode: "inherit" | "select";
                        }>;
                    }>
                >(`/resource/${resourceId}/ai-providers`, {
                    signal
                });
                return res.data.data.providers;
            }
        }),
    resourceAiModels: ({ resourceId }: { resourceId: number }) =>
        queryOptions({
            queryKey: ["RESOURCES", resourceId, "AI_MODELS"] as const,
            queryFn: async ({ signal, meta }) => {
                const res = await meta!.api.get<
                    AxiosResponse<ListResourceAiModelsResponse>
                >(`/resource/${resourceId}/ai-models`, { signal });
                return res.data.data.models;
            }
        }),
    siteResourceAiModels: ({ siteResourceId }: { siteResourceId: number }) =>
        queryOptions({
            queryKey: ["SITE_RESOURCES", siteResourceId, "AI_MODELS"] as const,
            queryFn: async ({ signal, meta }) => {
                const res = await meta!.api.get<
                    AxiosResponse<ListSiteResourceAiModelsResponse>
                >(`/site-resource/${siteResourceId}/ai-models`, { signal });
                return res.data.data.models;
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
                    return durationToMs(1.5, "minutes");
                }
                return false;
            }
        })
};

export const domainQueries = {
    getCertificate: ({
        orgId,
        domainId,
        domain
    }: {
        orgId: string;
        domainId: string;
        domain: string;
    }) =>
        queryOptions({
            queryKey: [
                "ORG",
                orgId,
                "DOMAIN",
                domainId,
                "CERTIFICATE",
                domain
            ] as const,
            queryFn: async ({ signal, meta }) => {
                try {
                    const res = await meta!.api.get<
                        AxiosResponse<GetCertificateResponse | null>
                    >(`/org/${orgId}/certificate/${domainId}/${domain}`, {
                        signal
                    });
                    return res.data.data;
                } catch (error) {
                    // the endpoint 404s when the domain has no certificate yet
                    if (isAxiosError(error) && error.response?.status === 404) {
                        return null;
                    }
                    throw error;
                }
            },
            retry: (failureCount, error) =>
                isAxiosError(error) &&
                error.response != null &&
                error.response.status < 500
                    ? false
                    : failureCount < 2,
            staleTime: durationToMs(1, "minutes")
        }),
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
        }),
    aiModels: (
        orgId: string,
        params:
            | {
                  resourceType: "public";
                  resourceId: number;
              }
            | {
                  resourceType: "site";
                  siteResourceId: number;
              }
            | null
    ) =>
        queryOptions({
            queryKey: ["ORG", orgId, "LAUNCHER", "AI_MODELS", params] as const,
            enabled: params != null,
            queryFn: async ({ signal, meta }) => {
                if (!params) {
                    throw new Error("Resource params are required");
                }

                if (params.resourceType === "public") {
                    const res = await meta!.api.get<
                        AxiosResponse<ListLauncherAiModelsResponse>
                    >(
                        `/org/${orgId}/launcher/resource/${params.resourceId}/ai-models`,
                        { signal }
                    );
                    return res.data.data;
                }

                const res = await meta!.api.get<
                    AxiosResponse<ListLauncherAiModelsResponse>
                >(
                    `/org/${orgId}/launcher/site-resource/${params.siteResourceId}/ai-models`,
                    { signal }
                );
                return res.data.data;
            }
        }),
    myVirtualApiKeys: (orgId: string, resourceGuid: string | null) =>
        queryOptions({
            queryKey: [
                "ORG",
                orgId,
                "LAUNCHER",
                "MY_VIRTUAL_API_KEYS",
                resourceGuid
            ] as const,
            enabled: Boolean(resourceGuid),
            queryFn: async ({ signal, meta }) => {
                if (!resourceGuid) {
                    throw new Error("resourceGuid is required");
                }

                const res = await meta!.api.get<
                    AxiosResponse<ListMyVirtualApiKeysResponse>
                >(
                    `/org/${orgId}/my-virtual-api-keys?resourceGuid=${encodeURIComponent(resourceGuid)}`,
                    { signal }
                );
                return res.data.data;
            }
        })
};
