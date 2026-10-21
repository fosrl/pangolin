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

export type DeleteResourceMtlsCertificateResponse = {
    // true when removing the last CA certificate forced mTLS off
    mtlsDisabled: boolean;
};

export type CreateResourceMtlsCertificateResponse = {
    certificates: {
        mtlsCertificateId: number;
        resourceId: number;
        name: string | null;
        subject: string | null;
        issuer: string | null;
        serialNumber: string | null;
        fingerprint: string | null;
        notBefore: number | null;
        notAfter: number | null;
        createdAt: number;
    }[];
};

export type ListResourceMtlsCertificatesResponse = {
    certificates: {
        mtlsCertificateId: number;
        resourceId: number;
        name: string | null;
        subject: string | null;
        issuer: string | null;
        serialNumber: string | null;
        fingerprint: string | null;
        notBefore: number | null;
        notAfter: number | null;
        createdAt: number;
    }[];
};
