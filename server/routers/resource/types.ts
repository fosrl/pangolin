import type { Resource, ResourcePolicy } from "@server/db";
import type { PaginatedResponse } from "@server/types/Pagination";

export type GetMaintenanceInfoResponse = {
    resourceId: number;
    name: string;
    fullDomain: string | null;
    maintenanceModeEnabled: boolean;
    maintenanceModeType: "forced" | "automatic" | null;
    maintenanceTitle: string | null;
    maintenanceMessage: string | null;
    maintenanceEstimatedTime: string | null;
};

export type AttachedResource = Pick<
    Resource,
    "resourceId" | "niceId" | "name" | "fullDomain"
>;

export type ResourcePolicyWithResources = Pick<
    ResourcePolicy,
    "resourcePolicyId" | "niceId" | "name" | "orgId"
> & {
    resources: Array<AttachedResource>;
};

export type ListResourcePoliciesResponse = PaginatedResponse<{
    policies: Array<ResourcePolicyWithResources>;
}>;
