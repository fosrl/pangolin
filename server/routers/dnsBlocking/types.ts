export type DnsBlockListSummary = {
    dnsBlockListId: number;
    name: string;
    description: string | null;
    domainCount: number;
    updatedAt: number;
};

export type DnsBlockListDetail = DnsBlockListSummary & {
    domains: string; // newline separated
};

export type ListDnsBlockListsResponse = {
    lists: DnsBlockListSummary[];
};

export type GetDnsBlockListResponse = DnsBlockListDetail;
export type CreateDnsBlockListResponse = DnsBlockListDetail;
export type UpdateDnsBlockListResponse = DnsBlockListDetail;

export type DnsBlockCategoryInfo = {
    id: string;
    domainCount: number;
    // false for categories that need a license the org does not have
    available: boolean;
};

export type ListDnsBlockCategoriesResponse = {
    categories: DnsBlockCategoryInfo[];
    // whether the org can add its own block lists to roles
    customListsAvailable: boolean;
};

export type RoleDnsBlockingValues = {
    enabled: boolean;
    categories: string[];
    listIds: number[];
};

export type GetRoleDnsBlockingResponse = RoleDnsBlockingValues;
export type UpdateRoleDnsBlockingResponse = RoleDnsBlockingValues;

// Limits shared by the API and the dashboard.
export const DNS_BLOCK_LIST_MAX_DOMAINS = 100_000;

export type DnsBlockAnalyticsResponse = {
    totalBlocked: number;
    uniqueDomains: number;
    activeClients: number;
    topDomains: { domain: string; count: number }[];
    topUsers: {
        userId: string | null;
        username: string | null;
        count: number;
    }[];
    timeSeries: { day: string; count: number }[];
};

export type DnsBlockLogRow = {
    domain: string;
    count: number;
    lastBlocked: number;
    userId: string | null;
    username: string | null;
    clientId: number | null;
    clientName: string | null;
};

export type QueryDnsBlockLogsResponse = {
    rows: DnsBlockLogRow[];
    pagination: { total: number; limit: number; offset: number };
};
