import type { Domain, Resource, Target } from "@server/db";

// Target subset with site information, shared between the OSS and
// private getTraefikConfig implementations.
export type TargetWithSite = {
    resourceId: number;
    targetId: number;
    ip: string | null;
    method: string | null;
    port: number | null;
    internalPort: number | null;
    enabled: boolean;
    health: string | null;
    site: {
        siteId: number;
        type: string;
        subnet: string | null;
        exitNodeId: number | null;
        online: boolean;
    };
};

// A resource grouped with its targets for router/service generation. Every
// target in a group shares the same path/rewrite config, so those columns
// live on the resource rather than on each target.
export type ResourceWithTargets = Pick<
    Resource,
    | "resourceId"
    | "fullDomain"
    | "ssl"
    | "proxyPort"
    | "subdomain"
    | "domainId"
    | "enabled"
    | "stickySession"
    | "tlsServerName"
    | "setHostHeader"
    | "enableProxy"
    | "requestHeaders"
    | "responseHeaders"
    | "proxyProtocol"
    | "wildcard"
    | "mode"
    | "maintenanceModeEnabled"
    | "maintenanceModeType"
    | "maintenanceTitle"
    | "maintenanceMessage"
    | "maintenanceEstimatedTime"
> &
    Pick<
        Target,
        "path" | "pathMatchType" | "rewritePath" | "rewritePathType"
    > & {
        /** Sanitized resource name used in router/service names */
        name: string;
        /** Sanitized resourceId + path config, unique per router */
        key: string;
        priority: number;
        proxyProtocolVersion: number;
        // Left-joined from the resource's domain, so absent when there is none
        domainCertResolver: Domain["certResolver"] | null;
        preferWildcardCert: Domain["preferWildcardCert"] | null;
        targets: TargetWithSite[];
    };
