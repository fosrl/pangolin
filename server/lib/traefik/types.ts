import { Target } from "@server/db";

// Extended target type with site information, shared between the OSS and
// private getTraefikConfig implementations.
export type TargetWithSite = Target & {
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
