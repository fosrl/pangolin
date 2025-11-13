export type GetMaintenanceInfoResponse = {
    resourceId: number;
    name: string;
    fullDomain: string | null;
    maintenanceModeEnabled: boolean;
    maintenanceModeType: "forced" | "automatic" | null;
    maintenanceTitle: string | null;
    maintenanceMessage: string | null;
    maintenanceEstimatedTime: string | null;
}